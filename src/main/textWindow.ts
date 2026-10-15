import { BrowserWindow, ipcMain, screen } from 'electron';
import { TEXT_CH, type Point, type TextAnswer, type TextBoxText } from '../shared/ipc';
import { placeInside } from './coords';
import { loadPage, pageUrl, preloadPath } from './paths';

/** The box's size in DIPs. */
const WIDTH = 420;
const HEIGHT = 64;
/** If the box never gets keyboard focus (another app held it), it closes instead of sitting there unusable. */
const FOCUS_WAIT_MS = 1000;

let win: BrowserWindow | null = null;
let at: Point = { x: 0, y: 0 };
let text: TextBoxText | null = null;
let submit: ((raw: string, at: Point) => TextAnswer) | null = null;
const goneListeners: Array<() => void> = [];

export function onTextWindowGone(cb: () => void): void {
  goneListeners.push(cb);
}

/** `onSubmit` answers what the box typed: 'sent' closes it, anything else keeps it open with that hint. */
export function registerTextWindow(onSubmit: (raw: string, at: Point) => TextAnswer): void {
  submit = onSubmit;
  ipcMain.handle(TEXT_CH.submit, (event, raw: unknown): TextAnswer => {
    if (win?.webContents !== event.sender || typeof raw !== 'string' || !submit) return 'unknown';
    const answer = submit(raw, at);
    if (answer === 'sent') win.close();
    return answer;
  });
  ipcMain.on(TEXT_CH.cancel, (event) => {
    if (win?.webContents === event.sender) win.close();
  });
  ipcMain.handle(TEXT_CH.strings, (event): TextBoxText | null => (win?.webContents === event.sender ? text : null));
}

/** Opens the text box with its top-left corner at `point` (a screen point in DIPs), inside that display's work area. */
export function openTextWindow(point: Point, strings: TextBoxText): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  at = point;
  text = strings;
  const spot = placeInside(point, { width: WIDTH, height: HEIGHT }, screen.getDisplayNearestPoint(point).workArea);
  const w = new BrowserWindow({
    ...spot,
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: preloadPath('text'), spellcheck: false },
  });
  w.setAlwaysOnTop(true, 'screen-saver'); // above the overlay and a game's borderless window
  let focused = false;
  w.on('focus', () => {
    focused = true;
  });
  // Clicking away cancels. Not before the box has had focus once, or showing it would close it.
  w.on('blur', () => {
    if (focused) w.close();
  });
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
    setTimeout(() => {
      if (!w.isDestroyed() && !focused) w.close();
    }, FOCUS_WAIT_MS);
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
}
