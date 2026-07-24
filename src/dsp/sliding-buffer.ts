/**
 * Accumulates pushed samples and yields fixed-size overlapping windows,
 * advancing by `hopSize` each time enough new samples have arrived.
 */
export class SlidingBuffer {
  private samples: number[] = [];

  constructor(
    private readonly windowSize: number,
    private readonly hopSize: number,
  ) {
    if (hopSize <= 0 || hopSize > windowSize) {
      throw new Error("SlidingBuffer: hopSize must be in (0, windowSize]");
    }
  }

  push(chunk: Float32Array): void {
    for (let i = 0; i < chunk.length; i++) this.samples.push(chunk[i]);
  }

  /** Pulls every window that's become available, oldest first. */
  drainWindows(): Float64Array[] {
    const windows: Float64Array[] = [];
    while (this.samples.length >= this.windowSize) {
      windows.push(Float64Array.from(this.samples.slice(0, this.windowSize)));
      this.samples.splice(0, this.hopSize);
    }
    return windows;
  }
}
