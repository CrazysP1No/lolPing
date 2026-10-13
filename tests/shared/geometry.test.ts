import { describe, expect, it } from 'vitest';
import { WHEEL, pickSlice } from '../../src/shared/geometry';

const at = (deg: number, r = 150) => {
  // deg measured clockwise from straight up (N), screen y points down
  const rad = ((deg - 90) * Math.PI) / 180;
  return pickSlice(r * Math.cos(rad), r * Math.sin(rad));
};

describe('pickSlice', () => {
  it('maps all 16 directions clockwise from N', () => {
    expect(Array.from({ length: 16 }, (_, i) => at(i * 22.5))).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it('returns -1 inside the dead zone and a slice at its edge', () => {
    expect(pickSlice(0, -(WHEEL.innerR - 1))).toBe(-1);
    expect(pickSlice(0, 0)).toBe(-1);
    expect(pickSlice(0, -WHEEL.innerR)).toBe(0);
  });

  it('splits slices at ±11.25° and wraps around N', () => {
    expect(at(11.24)).toBe(0);
    expect(at(11.26)).toBe(1);
    expect(at(-1)).toBe(0);
    expect(at(-11.26)).toBe(15);
    expect(at(359.9)).toBe(0);
  });

  it('honours a custom dead zone', () => {
    expect(pickSlice(0, -50, 40)).toBe(0);
    expect(pickSlice(0, -30, 40)).toBe(-1);
  });
});
