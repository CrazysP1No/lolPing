import { contextBridge, ipcRenderer } from 'electron';
import type { TextApi } from '../shared/ipc';

const api: TextApi = {
  // Inlined: a sandboxed preload can require electron, but not a generated sibling chunk.
  submit: (text) => ipcRenderer.send('text:submit', text),
};

contextBridge.exposeInMainWorld('textApi', api);
