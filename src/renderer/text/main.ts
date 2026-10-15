import { MAX_TEXT } from '../../shared/roomProtocol';

const input = document.getElementById('message') as HTMLInputElement;
const button = document.getElementById('send') as HTMLButtonElement;
const zh = /^zh/i.test(navigator.language);

document.documentElement.lang = zh ? 'zh-CN' : 'en';
(document.getElementById('label') as HTMLElement).textContent = zh ? '自定义文本弹出' : 'Custom text popup';
(document.getElementById('hint') as HTMLElement).textContent = zh ? 'Enter 发送 · Esc 取消' : 'Enter to send · Esc to cancel';
button.textContent = zh ? '发送' : 'Send';
input.placeholder = zh ? '输入要显示的文本' : 'Type text to show';

const clamp = (): void => {
  input.value = [...input.value].slice(0, MAX_TEXT).join('');
};
const send = (): void => window.textApi.submit(input.value);

input.addEventListener('input', clamp);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    send();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    window.textApi.submit('');
  }
});
button.addEventListener('click', send);
requestAnimationFrame(() => input.focus());
