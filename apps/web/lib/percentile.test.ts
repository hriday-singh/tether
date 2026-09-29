import { percentile } from './utils';

describe('percentile', () => {
  it('uses nearest rank', () => {
    const v = [50, 10, 40, 20, 30];
    expect(percentile(v, 50)).toBe(30);
    expect(percentile(v, 95)).toBe(50);
    expect(percentile([], 50)).toBeNull();
  });
});
