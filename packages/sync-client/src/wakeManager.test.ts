import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeManager, WakeTarget, WakeDocumentTarget } from './wakeManager.js';
import { WAKE_PROBE_MS } from '@tether/shared/constants';

class MockEventTarget implements WakeTarget {
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  public addEventListener(event: string, handler: (event?: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  public removeEventListener(event: string, handler: (event?: unknown) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  public dispatchEvent(event: string, payload?: unknown): void {
    this.listeners.get(event)?.forEach((handler) => handler(payload));
  }

  public get listenerCount(): number {
    let count = 0;
    this.listeners.forEach((set) => {
      count += set.size;
    });
    return count;
  }
}

class MockDocumentTarget extends MockEventTarget implements WakeDocumentTarget {
  public visibilityState: string = 'visible';
}

describe('WakeManager', () => {
  let mockWindow: MockEventTarget;
  let mockDocument: MockDocumentTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWindow = new MockEventTarget();
    mockDocument = new MockDocumentTarget();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers onWakePing and starts probe on focus, pageshow, and online events', () => {
    const onWakePing = vi.fn();
    const onWakeTimeout = vi.fn();
    const onOffline = vi.fn();

    const manager = new WakeManager({
      onWakePing,
      onWakeTimeout,
      onOffline,
      target: { window: mockWindow, document: mockDocument },
    });

    // Test focus
    mockWindow.dispatchEvent('focus');
    expect(onWakePing).toHaveBeenCalledTimes(1);
    expect(manager.isProbing).toBe(true);

    // Test pageshow
    mockWindow.dispatchEvent('pageshow');
    expect(onWakePing).toHaveBeenCalledTimes(2);

    // Test online
    mockWindow.dispatchEvent('online');
    expect(onWakePing).toHaveBeenCalledTimes(3);

    manager.destroy();
  });

  it('handles visibilitychange only when document is visible', () => {
    const onWakePing = vi.fn();
    const onWakeTimeout = vi.fn();
    const onOffline = vi.fn();

    const manager = new WakeManager({
      onWakePing,
      onWakeTimeout,
      onOffline,
      target: { window: mockWindow, document: mockDocument },
    });

    // Hidden -> should not wake
    mockDocument.visibilityState = 'hidden';
    mockDocument.dispatchEvent('visibilitychange');
    expect(onWakePing).not.toHaveBeenCalled();
    expect(manager.isProbing).toBe(false);

    // Visible -> triggers wake
    mockDocument.visibilityState = 'visible';
    mockDocument.dispatchEvent('visibilitychange');
    expect(onWakePing).toHaveBeenCalledTimes(1);
    expect(manager.isProbing).toBe(true);

    manager.destroy();
  });

  it('fires onWakeTimeout after probeTimeoutMs (WAKE_PROBE_MS) if not cleared', () => {
    const onWakePing = vi.fn();
    const onWakeTimeout = vi.fn();
    const onOffline = vi.fn();

    const manager = new WakeManager({
      onWakePing,
      onWakeTimeout,
      onOffline,
      probeTimeoutMs: WAKE_PROBE_MS,
      target: { window: mockWindow, document: mockDocument },
    });

    mockWindow.dispatchEvent('focus');
    expect(onWakePing).toHaveBeenCalledTimes(1);
    expect(manager.isProbing).toBe(true);

    // Advance right before timeout
    vi.advanceTimersByTime(WAKE_PROBE_MS - 1);
    expect(onWakeTimeout).not.toHaveBeenCalled();

    // Advance past timeout
    vi.advanceTimersByTime(1);
    expect(onWakeTimeout).toHaveBeenCalledTimes(1);
    expect(manager.isProbing).toBe(false);

    manager.destroy();
  });

  it('cancels probe when clearProbe is called before timeout', () => {
    const onWakePing = vi.fn();
    const onWakeTimeout = vi.fn();
    const onOffline = vi.fn();

    const manager = new WakeManager({
      onWakePing,
      onWakeTimeout,
      onOffline,
      probeTimeoutMs: 2000,
      target: { window: mockWindow, document: mockDocument },
    });

    mockWindow.dispatchEvent('focus');
    expect(manager.isProbing).toBe(true);

    // Advance 500ms then report pong received
    vi.advanceTimersByTime(500);
    manager.clearProbe();
    expect(manager.isProbing).toBe(false);

    // Advance past original timeout duration
    vi.advanceTimersByTime(2000);
    expect(onWakeTimeout).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('triggers onOffline and clears probe on offline event', () => {
    const onWakePing = vi.fn();
    const onWakeTimeout = vi.fn();
    const onOffline = vi.fn();

    const manager = new WakeManager({
      onWakePing,
      onWakeTimeout,
      onOffline,
      target: { window: mockWindow, document: mockDocument },
    });

    mockWindow.dispatchEvent('focus');
    expect(manager.isProbing).toBe(true);

    mockWindow.dispatchEvent('offline');
    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(manager.isProbing).toBe(false);

    // Advance past timeout
    vi.advanceTimersByTime(3000);
    expect(onWakeTimeout).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('cleans up all event listeners and active timers on destroy', () => {
    const onWakePing = vi.fn();
    const onWakeTimeout = vi.fn();
    const onOffline = vi.fn();

    const manager = new WakeManager({
      onWakePing,
      onWakeTimeout,
      onOffline,
      target: { window: mockWindow, document: mockDocument },
    });

    expect(mockWindow.listenerCount).toBeGreaterThan(0);
    expect(mockDocument.listenerCount).toBeGreaterThan(0);

    mockWindow.dispatchEvent('focus');
    expect(manager.isProbing).toBe(true);

    manager.destroy();
    expect(manager.isProbing).toBe(false);
    expect(mockWindow.listenerCount).toBe(0);
    expect(mockDocument.listenerCount).toBe(0);

    // Further events should do nothing
    mockWindow.dispatchEvent('focus');
    expect(onWakePing).toHaveBeenCalledTimes(1); // from before destroy
  });
});
