import { contextBridge, ipcRenderer } from 'electron';
import { TEXT_CH, type TextInputConfig } from '../shared/textChannels';

const api = {
  getConfig: (): Promise<TextInputConfig | null> => ipcRenderer.invoke(TEXT_CH.get),
  submit: (text: string): Promise<boolean> => ipcRenderer.invoke(TEXT_CH.submit, text),
  cancel: (): Promise<void> => ipcRenderer.invoke(TEXT_CH.cancel),
};

contextBridge.exposeInMainWorld('textInput', api);
export type TextInputApi = typeof api;
