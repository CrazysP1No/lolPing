import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmoteStage } from '../../src/renderer/overlay/emoteFx';

/** Just enough of the DOM for EmoteStage: elements with classes, children, text and a src. */
class FakeElement {
  className = '';
  textContent = '';
  src = '';
  alt = '';
  draggable = true;
  muted = false;
  loop = false;
  playsInline = false;
  poster = '';
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  setAttribute(_name: string, _value: string): void {}
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  readonly style: Record<string, unknown> & { setProperty(k: string, v: string): void } = { setProperty: () => undefined };
  constructor(readonly tagName: string) {}
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
  replaceWith(el: FakeElement): void {
    const p = this.parent;
    if (!p) return;
    p.children[p.children.indexOf(this)] = el;
    el.parent = p;
    this.parent = null;
  }
  private readonly listeners = new Map<string, Array<{ fn: () => void; once: boolean }>>();
  addEventListener(type: string, fn: () => void, opts?: { once?: boolean }): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn, once: opts?.once === true }]);
  }
  /** Runs this element's listeners for `type`, dropping the ones registered with `once`. */
  dispatch(type: string): void {
    const all = this.listeners.get(type) ?? [];
    this.listeners.set(type, all.filter((l) => !l.once));
    for (const l of all) l.fn();
  }
  /** Every element under this one with `cls` among its classes. */
  find(cls: string): FakeElement[] {
    return this.children.flatMap((c) => [...(c.className.split(' ').includes(cls) ? [c] : []), ...c.find(cls)]);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EmoteStage', () => {
  const videoArt = { kind: 'video' as const, url: 'lolping://emotes/clip.video', poster: 'lolping://emotes/clip.webp' };
  it('keeps a receiving-video poster visible until it is replaced by the completed video', async () => {
    vi.useFakeTimers();
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement);
    stage.spawn('friend', { kind: 'video-loading', poster: videoArt.poster }, 10, 20, { sizePx: 150 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(layer.find('emote')).toHaveLength(1);
    stage.spawn('friend', videoArt, 10, 20, { sizePx: 150 });
    const video = layer.find('fx')[0].children[0];
    expect(video.tagName).toBe('video');
    video.dispatch('playing'); video.dispatch('ended');
    expect(layer.find('emote')).toHaveLength(0);
  });
  it('keeps a video past three seconds and removes it only after playback ends', async () => {
    vi.useFakeTimers();
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement);
    stage.spawn('self', videoArt, 10, 20, { sizePx: 150 });
    const [video] = layer.find('fx')[0].children;
    expect(video.tagName).toBe('video');
    expect(video.src).toBe(videoArt.url);
    expect(video.poster).toBe(videoArt.poster);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
    video.dispatch('playing');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(layer.find('emote')).toHaveLength(1);
    video.dispatch('ended');
    expect(layer.find('emote')).toHaveLength(0);
    expect(video.pause).toHaveBeenCalled();
    expect(video.src).toBe('');
    expect(video.load).toHaveBeenCalled();
  });

  it('releases a replaced video and ignores its late playback events', () => {
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement);
    stage.spawn('self', videoArt, 10, 20, { sizePx: 150 });
    const old = layer.find('fx')[0].children[0];
    stage.spawn('self', videoArt, 30, 40, { sizePx: 150 });
    expect(old.pause).toHaveBeenCalled();
    old.dispatch('ended');
    old.dispatch('error');
    expect(layer.find('emote')).toHaveLength(1);
    expect(layer.find('fx')[0].children[0]).not.toBe(old);
    stage.clear('self');
  });

  it('shows a short-lived poster when video decoding fails', async () => {
    vi.useFakeTimers();
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement);
    stage.spawn('self', videoArt, 10, 20, { sizePx: 150 });
    const video = layer.find('fx')[0].children[0];
    video.dispatch('error');
    const poster = layer.find('fx')[0].children[0];
    expect(poster.tagName).toBe('img');
    expect(poster.src).toBe(videoArt.poster);
    expect(video.pause).toHaveBeenCalled();
    video.dispatch('ended'); // releasing the failed player must not remove its fallback
    expect(layer.find('emote')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3200);
    expect(layer.find('emote')).toHaveLength(0);
  });
  it('shows the placeholder when a bundled emote’s animation arrives but cannot be decoded', async () => {
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement, () => Promise.resolve(new Blob(['not a webp'])));
    stage.spawn('self', { kind: 'bundled', slug: 'facepalm' }, 10, 20, { sizePx: 150 });
    await flush();
    const [emote] = layer.find('emote');
    const [sheet] = emote.find('sheet');
    expect(sheet.src).toMatch(/^blob:/);
    sheet.dispatch('error'); // the <img> could not decode what it was given
    expect(emote.find('sheet')).toHaveLength(0);
    const [fx] = emote.find('fx'); // the same envelope as a custom emote or a missing file
    expect(fx.find('bubble')).toHaveLength(1);
    expect(layer.find('emote')).toHaveLength(1); // still on screen for its 3 s
    sheet.dispatch('error'); // a second error does not swap again
    expect(emote.find('fx')).toHaveLength(1);
    expect(emote.find('bubble')).toHaveLength(1);
    stage.clear('self');
    expect(layer.find('emote')).toHaveLength(0);
  });

  it('falls back after stalled loading, while an actively playing video has no lifetime timer', async () => {
    vi.useFakeTimers();
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement);
    stage.spawn('self', videoArt, 10, 20, { sizePx: 150 });
    const video = layer.find('fx')[0].children[0];
    video.dispatch('playing');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(layer.find('fx')[0].children[0]).toBe(video);
    video.dispatch('waiting');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(layer.find('fx')[0].children[0].tagName).toBe('img');
    await vi.advanceTimersByTimeAsync(3200);
    expect(layer.find('emote')).toHaveLength(0);
  });

  it('a decode error after the emote was cleared does nothing', async () => {
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement, () => Promise.resolve(new Blob(['x'])));
    stage.spawn('self', { kind: 'bundled', slug: 'facepalm' }, 10, 20, { sizePx: 150 });
    await flush();
    const [emote] = layer.find('emote');
    const [sheet] = emote.find('sheet');
    stage.clear('self');
    sheet.dispatch('error');
    expect(emote.find('fx')).toHaveLength(0);
    expect(emote.find('bubble')).toHaveLength(0);
    expect(layer.find('emote')).toHaveLength(0);
  });

  it('a decode error after a newer emote replaced this one leaves the newer emote alone', async () => {
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement, () => Promise.resolve(new Blob(['x'])));
    stage.spawn('self', { kind: 'bundled', slug: 'facepalm' }, 10, 20, { sizePx: 150 });
    await flush();
    const [old] = layer.find('emote');
    const [oldSheet] = old.find('sheet');
    stage.spawn('self', { kind: 'bundled', slug: 'facepalm' }, 30, 40, { sizePx: 150 });
    await flush();
    oldSheet.dispatch('error');
    const emotes = layer.find('emote');
    expect(emotes).toHaveLength(1);
    expect(emotes[0]).not.toBe(old);
    expect(emotes[0].find('sheet')).toHaveLength(1);
    expect(emotes[0].find('bubble')).toHaveLength(0);
    stage.clear('self');
  });

  it('shows a bundled emote’s baked animation', async () => {
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement, () => Promise.resolve(new Blob(['x'])));
    stage.spawn('self', { kind: 'bundled', slug: 'facepalm' }, 10, 20, { sizePx: 150 });
    await flush();
    const [emote] = layer.find('emote');
    expect(emote.find('sheet')).toHaveLength(1);
    expect(emote.find('sheet')[0].src).toMatch(/^blob:/);
    expect(emote.find('bubble')).toHaveLength(0);
    stage.clear('self');
  });

  it('shows the placeholder when a bundled emote’s animation is missing', async () => {
    const layer = new FakeElement('div');
    const stage = new EmoteStage(layer as unknown as HTMLElement, () => Promise.reject(new Error('404')));
    stage.spawn('self', { kind: 'bundled', slug: 'facepalm' }, 10, 20, { sizePx: 150 });
    await flush();
    const emotes = layer.find('emote');
    expect(emotes).toHaveLength(1); // still on screen for its 3 s
    expect(emotes[0].find('sheet')).toHaveLength(0);
    const [fx] = emotes[0].find('fx'); // the same envelope as a custom emote
    expect(fx.find('bubble')).toHaveLength(1);
    stage.clear('self');
    expect(layer.find('emote')).toHaveLength(0);
  });

  it('a missing animation that arrives after the emote was cleared does nothing', async () => {
    const layer = new FakeElement('div');
    let fail: (e: Error) => void = () => undefined;
    const stage = new EmoteStage(layer as unknown as HTMLElement, () => new Promise((_, reject) => (fail = reject)));
    stage.spawn('self', { kind: 'bundled', slug: 'facepalm' }, 10, 20, { sizePx: 150 });
    stage.clear('self');
    fail(new Error('404'));
    await flush();
    expect(layer.find('emote')).toHaveLength(0);
  });
});
