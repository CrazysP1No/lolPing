import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WardStage } from '../../src/renderer/overlay/wardFx';

class FakeElement {
  className = '';
  textContent = '';
  src = '';
  alt = '';
  draggable = true;
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  readonly style: Record<string, unknown> & { setProperty(k: string, v: string): void } = { setProperty: () => undefined };
  append(...els: FakeElement[]): void {
    for (const el of els) {
      el.remove();
      el.parent = this;
      this.children.push(el);
    }
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  find(cls: string): FakeElement[] {
    return this.children.flatMap((c) => [...(c.className.split(' ').includes(cls) ? [c] : []), ...c.find(cls)]);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WardStage', () => {
  const ward = { key: 'peer:2', x: 10, y: 20, tag: { name: '<b>Alex</b>', color: 2 } };

  it('keeps a transparent ward indefinitely, with its name as plain text', () => {
    const layer = new FakeElement();
    const stage = new WardStage(layer as unknown as HTMLElement);
    expect(stage.sync([ward], 110)).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(layer.find('ward')).toHaveLength(1);
    expect(layer.find('ward-art')[0].src).toBe('../textures/ward.png');
    expect(layer.find('tag')[0].textContent).toBe('<b>Alex</b>');
  });

  it('updates existing wards without respawning them or replaying placement sounds', () => {
    const layer = new FakeElement();
    const stage = new WardStage(layer as unknown as HTMLElement);
    stage.sync([ward], 110);
    const root = layer.find('ward')[0];
    expect(stage.sync([{ ...ward, x: 40, y: 50 }], 150)).toBe(0);
    expect(layer.find('ward')).toEqual([root]);
    expect(root.style.left).toBe('40px');
    expect(root.style.top).toBe('50px');
  });

  it('shows +1 and a clear effect once, then removes that ward', () => {
    const layer = new FakeElement();
    const stage = new WardStage(layer as unknown as HTMLElement);
    stage.sync([ward], 110);
    expect(stage.clear(ward.key)).toBe(true);
    expect(stage.clear(ward.key)).toBe(false);
    expect(layer.find('cleared')).toHaveLength(1);
    expect(layer.find('ward-point')[0].textContent).toBe('+1');
    stage.sync([], 110);
    expect(layer.find('ward-point')).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(layer.find('ward')).toHaveLength(0);
  });

  it('cleans up a room snapshot without awarding points or showing a clear effect', () => {
    const layer = new FakeElement();
    const stage = new WardStage(layer as unknown as HTMLElement);
    stage.sync([ward], 110);
    expect(stage.sync([], 110)).toBe(0);
    expect(layer.find('ward')).toHaveLength(0);
    expect(layer.find('ward-point')).toHaveLength(0);
    expect(stage.clear(ward.key)).toBe(false);
  });
});
