/**
 * Deterministic Pseudo-Random Number Generator using Mulberry32 algorithm.
 * Guarantees cross-platform reproducible float and integer sequences from a 32-bit seed.
 */
export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  /** Return float in [0, 1) */
  public nextFloat(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Return integer in [min, max] inclusive */
  public nextInt(min: number, max: number): number {
    if (min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    const f = this.nextFloat();
    return min + Math.floor(f * (max - min + 1));
  }

  /** Return boolean with specified probability of true (default 0.5) */
  public nextBool(prob = 0.5): boolean {
    return this.nextFloat() < prob;
  }

  /** Pick random item from array */
  public pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    const idx = this.nextInt(0, arr.length - 1);
    return arr[idx]!;
  }

  /** Pick item from weighted array */
  public pickWeighted<T>(items: readonly { item: T; weight: number }[]): T {
    const totalWeight = items.reduce((acc, curr) => acc + curr.weight, 0);
    if (totalWeight <= 0) {
      throw new Error('Total weight must be positive');
    }
    let r = this.nextFloat() * totalWeight;
    for (const entry of items) {
      if (r < entry.weight) {
        return entry.item;
      }
      r -= entry.weight;
    }
    return items[items.length - 1]!.item;
  }
}
