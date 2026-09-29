import { WAKE_PROBE_MS } from '@tether/shared/constants';

export interface WakeTarget {
  addEventListener(event: string, handler: (event?: unknown) => void): void;
  removeEventListener(event: string, handler: (event?: unknown) => void): void;
}

export interface WakeDocumentTarget extends WakeTarget {
  visibilityState?: string;
}

export interface WakeManagerOptions {
  onWakePing: () => void;
  onWakeTimeout: () => void;
  onOffline: () => void;
  probeTimeoutMs?: number;
  target?: {
    window?: WakeTarget;
    document?: WakeDocumentTarget;
  };
}

export class WakeManager {
  private readonly probeTimeoutMs: number;
  private readonly onWakePing: () => void;
  private readonly onWakeTimeout: () => void;
  private readonly onOffline: () => void;
  private readonly windowTarget?: WakeTarget;
  private readonly documentTarget?: WakeDocumentTarget;

  private probeTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  constructor(options: WakeManagerOptions) {
    this.probeTimeoutMs = options.probeTimeoutMs ?? WAKE_PROBE_MS;
    this.onWakePing = options.onWakePing;
    this.onWakeTimeout = options.onWakeTimeout;
    this.onOffline = options.onOffline;

    this.windowTarget =
      options.target?.window ??
      (typeof window !== 'undefined' ? (window as unknown as WakeTarget) : undefined);
    this.documentTarget =
      options.target?.document ??
      (typeof document !== 'undefined'
        ? (document as unknown as WakeDocumentTarget)
        : undefined);

    this.attach();
  }

  private attach(): void {
    if (this.documentTarget) {
      this.documentTarget.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (this.windowTarget) {
      this.windowTarget.addEventListener('focus', this.handleWake);
      this.windowTarget.addEventListener('pageshow', this.handleWake);
      this.windowTarget.addEventListener('online', this.handleWake);
      this.windowTarget.addEventListener('offline', this.handleOffline);
    }
  }

  private handleVisibilityChange = (): void => {
    if (this.documentTarget?.visibilityState === 'visible') {
      this.handleWake();
    }
  };

  public handleWake = (): void => {
    if (this.isDestroyed) return;
    this.onWakePing();
    this.startProbe();
  };

  private handleOffline = (): void => {
    if (this.isDestroyed) return;
    this.clearProbe();
    this.onOffline();
  };

  public startProbe(): void {
    this.clearProbe();
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (!this.isDestroyed) {
        this.onWakeTimeout();
      }
    }, this.probeTimeoutMs);
  }

  public clearProbe(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  public get isProbing(): boolean {
    return this.probeTimer !== null;
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.clearProbe();
    if (this.documentTarget) {
      this.documentTarget.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (this.windowTarget) {
      this.windowTarget.removeEventListener('focus', this.handleWake);
      this.windowTarget.removeEventListener('pageshow', this.handleWake);
      this.windowTarget.removeEventListener('online', this.handleWake);
      this.windowTarget.removeEventListener('offline', this.handleOffline);
    }
  }
}
