import type { TextInputApi } from '../../preload/text';

declare global {
  interface Window {
    textInput: TextInputApi;
  }
}
