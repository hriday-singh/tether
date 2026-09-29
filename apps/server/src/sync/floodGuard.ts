import {
  FLOOD_FRAMES_PER_SEC,
  FLOOD_WINDOW_SEC,
  MAX_FRAME_BYTES,
  WS_CLOSE_CODES,
} from '@tether/shared/constants';

export class FloodGuard {
  private frameTimestamps: number[] = [];
  private windowMs: number;
  private maxFrames: number;
  private clock: () => number;

  constructor(options: {
    framesPerSec?: number;
    windowSec?: number;
    clock?: () => number;
  } = {}) {
    const fps = options.framesPerSec ?? FLOOD_FRAMES_PER_SEC;
    const windowSec = options.windowSec ?? FLOOD_WINDOW_SEC;
    this.windowMs = windowSec * 1000;
    this.maxFrames = fps * windowSec;
    this.clock = options.clock ?? (() => Date.now());
  }

  /**
   * Checks inbound frame. Returns close code if rule violated, or null if allowed.
   */
  public checkFrame(byteLength: number): number | null {
    if (byteLength > MAX_FRAME_BYTES) {
      return WS_CLOSE_CODES.PROTOCOL_VIOLATION; // 4009
    }

    const now = this.clock();
    this.frameTimestamps.push(now);

    const threshold = now - this.windowMs;
    // Prune expired timestamps
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0]! < threshold) {
      this.frameTimestamps.shift();
    }

    if (this.frameTimestamps.length > this.maxFrames) {
      return WS_CLOSE_CODES.FLOOD; // 4029
    }

    return null;
  }
}
