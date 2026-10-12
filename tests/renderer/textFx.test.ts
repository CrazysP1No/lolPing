import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class Element {
  className = '';
  textContent = '';
  style: Record<string, string> = {};
  children: Element[] = [];
  parent: Element | null = null;
  clientWidth = 1000;
  clientHeight = 600;
  offsetWidth = 240;
  offsetHeight = 90;
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  append(...children: Element[]) { for (const child of children) { child.parent = this; this.children.push(child); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: () => new Element() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('text bubbles', () => {
  it('renders markup as text, keeps bubbles within the screen, and removes them after 5 seconds', async () => {
    const { spawnText } = await import('../../src/renderer/overlay/textFx');
    const layer = new Element();
    spawnText(layer as unknown as HTMLElement, '<img onerror=alert(1)>', 990, 599, { name: 'Bob', color: 2 });
    const bubble = layer.children[0];
    expect(bubble.children[0].textContent).toBe('<img onerror=alert(1)>');
    expect(bubble.children[1].textContent).toBe('Bob');
    expect(parseFloat(bubble.style.left) + bubble.offsetWidth).toBeLessThanOrEqual(layer.clientWidth);
    expect(parseFloat(bubble.style.top) + bubble.offsetHeight).toBeLessThanOrEqual(layer.clientHeight);
    await vi.advanceTimersByTimeAsync(4999);
    expect(layer.children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(layer.children).toHaveLength(0);
  });

  it('bounds the number of bubbles under an unlimited room rate', async () => {
    const { spawnText } = await import('../../src/renderer/overlay/textFx');
    const layer = new Element();
    for (let i = 0; i < 30; i++) spawnText(layer as unknown as HTMLElement, String(i), 0, 0);
    expect(layer.children.length).toBeLessThanOrEqual(12);
    expect(layer.children.at(-1)?.children[0].textContent).toBe('29');
  });
});
