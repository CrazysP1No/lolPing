import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import { sanitizeText } from '../shared/roomProtocol';
import { TEXT_CH, type TextInputConfig } from '../shared/textChannels';
import { IS_MAC, loadPage, pageUrl, preloadPath } from './paths';

export interface TextPosition {
  displayId: number;
  x: number;
  y: number;
}

export class TextInputWindow {
  private win: BrowserWindow | null = null;
  private position: TextPosition | null = null;

  constructor(private readonly deps: {
    config(): TextInputConfig;
    send(text: string, position: TextPosition): void;
    setTyping(on: boolean): void;
  }) {
    ipcMain.handle(TEXT_CH.get, (event) => this.owns(event) ? deps.config() : null);
    ipcMain.handle(TEXT_CH.submit, (event, raw: unknown) => {
      if (!this.owns(event) || !this.position) return false;
      const text = sanitizeText(raw);
      if (!text) return false;
      const position = this.position;
      this.cancel();
      deps.send(text, position);
      return true;
    });
    ipcMain.handle(TEXT_CH.cancel, (event) => { if (this.owns(event)) this.cancel(); });
  }

  get isOpen(): boolean {
    return this.win !== null;
  }

  open(): void {
    if (this.win) return;
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const area = display.workArea;
    const width = Math.min(440, area.width);
    const height = Math.min(184, area.height);
    const w = new BrowserWindow({
      width, height,
      x: Math.round(Math.max(area.x, Math.min(cursor.x - width / 2, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(cursor.y + 16, area.y + area.height - height))),
      title: 'lolPing', show: false, frame: false, resizable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, backgroundColor: '#101c25',
      webPreferences: { preload: preloadPath('text'), spellcheck: false },
    });
    this.win = w;
    this.position = { displayId: display.id, x: cursor.x - display.bounds.x, y: cursor.y - display.bounds.y };
    this.deps.setTyping(true);
    if (!IS_MAC) w.removeMenu();
    // macOS IME candidate panels must be able to appear above this input window.
    w.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver');
    if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const cancel = () => { if (this.win === w) this.cancel(); };
    w.on('blur', cancel);
    w.on('unresponsive', cancel);
    w.webContents.on('render-process-gone', cancel);
    w.on('closed', () => {
      if (this.win !== w) return;
      this.win = null;
      this.position = null;
      this.deps.setTyping(false);
    });
    w.webContents.on('will-navigate', (event) => {
      if (event.url !== pageUrl('text')) event.preventDefault();
    });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.once('ready-to-show', () => {
      if (this.win !== w || w.isDestroyed()) return;
      if (IS_MAC) app.focus({ steal: true });
      w.show();
      w.focus();
    });
    void loadPage(w, 'text').catch(cancel);
  }

  cancel(): void {
    const w = this.win;
    if (w && !w.isDestroyed()) w.destroy();
  }

  private owns(event: IpcMainInvokeEvent): boolean {
    return this.win !== null && !this.win.isDestroyed()
      && event.sender === this.win.webContents && event.senderFrame?.parent === null;
  }
}
