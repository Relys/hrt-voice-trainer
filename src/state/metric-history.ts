/** A fixed-length rolling buffer of a metric's recent values; `null` marks a gap (gated/silent frame). */
export class MetricHistory {
  private values: Array<number | null> = [];

  constructor(private readonly maxLength: number) {}

  push(value: number | null): void {
    this.values.push(value);
    if (this.values.length > this.maxLength) this.values.shift();
  }

  getValues(): Array<number | null> {
    return this.values;
  }

  reset(): void {
    this.values = [];
  }
}
