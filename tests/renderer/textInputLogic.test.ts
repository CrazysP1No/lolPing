import { describe, expect, it } from 'vitest';

describe('text input keys', () => {
  it('sends on Enter and cancels on Escape, while letting the IME handle its own keys', async () => {
    const { textInputAction } = await import('../../src/renderer/text/inputLogic');
    expect(textInputAction({ key: 'Enter' }, false)).toBe('send');
    expect(textInputAction({ key: 'Escape' }, false)).toBe('cancel');
    expect(textInputAction({ key: 'a' }, false)).toBe('ignore');
    for (const key of ['Enter', 'Escape']) {
      expect(textInputAction({ key, isComposing: true }, false)).toBe('ignore');
      expect(textInputAction({ key, keyCode: 229 }, false)).toBe('ignore');
      expect(textInputAction({ key }, true)).toBe('ignore');
    }
  });
});
