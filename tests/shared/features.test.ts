import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURES, featureOn, normalizeFeatures } from '../../src/shared/features';

describe('features', () => {
  it('turns everything on by default', () => {
    expect(normalizeFeatures(undefined)).toEqual(DEFAULT_FEATURES);
    expect(Object.values(DEFAULT_FEATURES).every((v) => v)).toBe(true);
  });

  it('repairs a broken value key by key', () => {
    const f = normalizeFeatures({ rooms: false, emotes: 1, extra: true });
    expect(f).toEqual({ ...DEFAULT_FEATURES, rooms: false });
    expect('extra' in f).toBe(false);
    expect(normalizeFeatures('yes')).toEqual(DEFAULT_FEATURES);
    expect(normalizeFeatures([true])).toEqual(DEFAULT_FEATURES);
  });

  it('counts a room feature as off while rooms are off', () => {
    const s = { features: { ...DEFAULT_FEATURES, rooms: false } };
    expect(featureOn(s, 'roomText')).toBe(false);
    expect(featureOn(s, 'roomVotes')).toBe(false);
    expect(featureOn(s, 'roomPanel')).toBe(false);
    expect(featureOn(s, 'rooms')).toBe(false);
    expect(featureOn(s, 'emotes')).toBe(true);
  });

  it('keeps a room feature off by its own switch while rooms are on', () => {
    const s = { features: { ...DEFAULT_FEATURES, roomVotes: false } };
    expect(featureOn(s, 'roomVotes')).toBe(false);
    expect(featureOn(s, 'roomText')).toBe(true);
  });
});
