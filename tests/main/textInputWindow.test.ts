import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  windows: [] as any[],
  handlers: new Map<string, (event: any, raw?: unknown) => unknown>(),
  load: vi.fn<() => Promise<void>>(),
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWindow extends EventEmitter {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
    show = vi.fn();
    focus = vi.fn();
    constructor(readonly opts: Record<string, any>) {
      super();
      h.windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    removeMenu() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const display = { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 1024 }, workArea: { x: -1280, y: 24, width: 1280, height: 1000 } };
  return {
    BrowserWindow: FakeWindow, app: { focus: vi.fn() },
    screen: { getCursorScreenPoint: () => ({ x: -10, y: 1000 }), getDisplayNearestPoint: () => display },
    ipcMain: { handle: (channel: string, fn: any) => h.handlers.set(channel, fn) },
  };
});

vi.mock('../../src/main/paths', () => ({
  IS_MAC: false, preloadPath: () => 'text.js',
  pageUrl: () => 'lolping://app/text/index.html', loadPage: () => h.load(),
}));

const config = { lang: 'zh-CN' as const, title: '文字', placeholder: '输入文字', hint: 'Enter', send: '发送', cancel: '取消' };
let input: import('../../src/main/textInputWindow').TextInputWindow;
let send: ReturnType<typeof vi.fn<(text: string, position: import('../../src/main/textInputWindow').TextPosition) => void>>;
let typing: ReturnType<typeof vi.fn<(on: boolean) => void>>;

beforeEach(async () => {
  h.windows.length = 0;
  h.handlers.clear();
  h.load.mockReset().mockResolvedValue();
  vi.resetModules();
  send = vi.fn();
  typing = vi.fn();
  const { TextInputWindow } = await import('../../src/main/textInputWindow');
  input = new TextInputWindow({ config: () => config, send, setTyping: typing });
});

const call = (channel: string, sender: unknown, raw?: unknown) => h.handlers.get(channel)!({ sender, senderFrame: { parent: null } }, raw);

describe('TextInputWindow', () => {
  it('opens once within the display work area and saves the original cursor position', () => {
    input.open();
    input.open();
    expect(h.windows).toHaveLength(1);
    const w = h.windows[0];
    expect(w.opts.x + w.opts.width).toBeLessThanOrEqual(0);
    expect(w.opts.y + w.opts.height).toBeLessThanOrEqual(1024);
    expect(input.isOpen).toBe(true);
    expect(typing).toHaveBeenCalledWith(true);
    w.emit('ready-to-show');
    expect(w.show).toHaveBeenCalledOnce();
    expect(call('text:get', w.webContents)).toEqual(config);
    expect(call('text:submit', w.webContents, '  集合\u202e  ')).toBe(true);
    expect(send).toHaveBeenCalledWith('集合', { displayId: 2, x: 1270, y: 1000 });
    expect(input.isOpen).toBe(false);
    expect(typing.mock.calls).toEqual([[true], [false]]);
  });

  it('rejects unknown senders, subframes and malformed text without closing or sending', () => {
    input.open();
    const w = h.windows[0];
    expect(call('text:get', {})).toBeNull();
    expect(call('text:submit', {}, '集合')).toBe(false);
    h.handlers.get('text:submit')!({ sender: w.webContents, senderFrame: { parent: {} } }, '集合');
    for (const raw of [null, 7, '', '  ', '\u200b', '字'.repeat(121)]) expect(call('text:submit', w.webContents, raw)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(input.isOpen).toBe(true);
    call('text:cancel', w.webContents);
    expect(input.isOpen).toBe(false);
  });

  it.each(['blur', 'closed', 'render-process-gone', 'unresponsive'])('releases input on %s, only once', (reason) => {
    input.open();
    const w = h.windows[0];
    if (reason === 'render-process-gone') w.webContents.emit(reason);
    else if (reason === 'closed') w.destroy();
    else w.emit(reason);
    input.cancel();
    expect(typing.mock.calls).toEqual([[true], [false]]);
    expect(input.isOpen).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('releases input after a page load failure', async () => {
    h.load.mockRejectedValueOnce(new Error('load failed'));
    input.open();
    await Promise.resolve();
    expect(input.isOpen).toBe(false);
    expect(typing.mock.calls).toEqual([[true], [false]]);
  });

  it('blocks navigation and new windows', () => {
    input.open();
    const w = h.windows[0];
    const event = { url: 'https://example.com', preventDefault: vi.fn() };
    w.webContents.emit('will-navigate', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(w.webContents.setWindowOpenHandler.mock.calls[0][0]({ url: event.url })).toEqual({ action: 'deny' });
  });

  it('does not let an old renderer submit or close a newer input', () => {
    input.open();
    const old = h.windows[0];
    input.cancel();
    input.open();
    expect(call('text:submit', old.webContents, 'old')).toBe(false);
    call('text:cancel', old.webContents);
    old.emit('blur');
    expect(input.isOpen).toBe(true);
    expect(send).not.toHaveBeenCalled();
    input.cancel();
  });
});
