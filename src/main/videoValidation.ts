import { BrowserWindow } from 'electron';
import { VIDEO_MAX_SIDE, type ImportError } from '../shared/emotes';

/** Decode in a fresh sandboxed renderer so an IPC caller cannot supply its own validation result. */
export async function checkVideo(bytes: Uint8Array): Promise<ImportError | null> {
  let window: BrowserWindow | undefined;
  try {
    window = new BrowserWindow({
      show: false, width: 1, height: 1,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false },
    });
    await window.loadURL('data:text/html,<!doctype html><title>Video validation</title>');
    return await window.webContents.executeJavaScript(`new Promise((resolve) => {
      const video = document.createElement('video');
      const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString('base64'))}), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes]));
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.onloadedmetadata = video.onloadeddata = video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        resolve(error);
      };
      const timer = setTimeout(() => finish('type'), 15000);
      video.muted = true;
      video.preload = 'auto';
      video.onloadedmetadata = () => {
        if (!video.videoWidth || !video.videoHeight) finish('type');
        else if (Math.max(video.videoWidth, video.videoHeight) > ${VIDEO_MAX_SIDE}) finish('videoSize');
      };
      video.onloadeddata = () => finish(null);
      video.onerror = () => finish('type');
      video.src = url;
    })`);
  } catch {
    return 'type';
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
  }
}
