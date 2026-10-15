import { BrowserWindow, ipcMain, nativeImage } from 'electron';
import { TEXT_CH } from '../shared/ipc';
import { sanitizeText } from '../shared/roomProtocol';
import { assetPath, IS_MAC, loadPage, pageUrl, preloadPath } from './paths';

let win: BrowserWindow | null = null;
let submit: ((text: string) => void) | null = null;
const goneListeners: Array<() => void> = [];

export function onTextWindowGone(cb: () => void): void {
  goneListeners.push(cb);
}

export function registerTextWindow(onSubmit: (text: string) => void): void {
  submit = onSubmit;
  ipcMain.on(TEXT_CH.submit, (event, raw: unknown) => {
    if (win?.webContents !== event.sender) return;
    const text = typeof raw === 'string' ? sanitizeText(raw) : '';
    if (text) submit?.(text);
    win?.close();
  });
}

export function openTextWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }
  const w = new BrowserWindow({
    width: 460,
    height: 176,
    minWidth: 360,
    minHeight: 150,
    maximizable: false,
    fullscreenable: false,
    resizable: false,
    title: 'lolPing',
    icon: nativeImage.createFromPath(assetPath('textures', 'generic_ping.png')),
    show: false,
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: { preload: preloadPath('text'), spellcheck: false },
  });
  if (!IS_MAC) w.removeMenu();
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
  });
  w.on('closed', () => {
    win = null;
    for (const cb of goneListeners) cb();
  });
  const ownUrl = new URL(pageUrl('text'));
  w.webContents.on('will-navigate', (event) => {
    try {
      const target = new URL(event.url);
      if (target.protocol !== ownUrl.protocol || target.host !== ownUrl.host || target.pathname !== ownUrl.pathname) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void loadPage(w, 'text');
  win = w;
  return w;
}
