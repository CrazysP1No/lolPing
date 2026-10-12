export const TEXT_CH = { get: 'text:get', submit: 'text:submit', cancel: 'text:cancel' } as const;

export interface TextInputConfig {
  lang: 'en' | 'zh-CN';
  title: string;
  placeholder: string;
  hint: string;
  send: string;
  cancel: string;
}
