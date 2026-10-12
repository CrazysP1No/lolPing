import { MAX_TEXT, sanitizeText } from '../../shared/roomProtocol';
import { textInputAction } from './inputLogic';

const input = document.getElementById('message') as HTMLInputElement;
const sendButton = document.getElementById('send') as HTMLButtonElement;
const count = document.getElementById('count')!;
let composing = false;
let sending = false;

function update(): void {
  if (!composing) input.value = [...input.value].slice(0, MAX_TEXT).join('');
  count.textContent = `${[...input.value].length} / ${MAX_TEXT}`;
  sendButton.disabled = sending || composing || sanitizeText(input.value) === null;
}

async function send(): Promise<void> {
  if (composing || sending) return;
  const text = sanitizeText(input.value);
  if (!text) return;
  sending = true;
  update();
  const sent = await window.textInput.submit(text).catch(() => false);
  if (!sent) { sending = false; update(); }
}

input.addEventListener('input', update);
input.addEventListener('compositionstart', () => { composing = true; update(); });
input.addEventListener('compositionend', () => { composing = false; update(); });
document.addEventListener('keydown', (event) => {
  const action = textInputAction(event, composing);
  if (action === 'ignore') return;
  event.preventDefault();
  if (action === 'send') void send();
  else void window.textInput.cancel();
});
sendButton.addEventListener('click', () => void send());
document.getElementById('cancel')!.addEventListener('click', () => void window.textInput.cancel());
window.addEventListener('focus', () => input.focus());

void window.textInput.getConfig().then((config) => {
  if (!config) return window.textInput.cancel();
  document.documentElement.lang = config.lang;
  document.getElementById('title')!.textContent = config.title;
  input.placeholder = config.placeholder;
  document.getElementById('hint')!.textContent = config.hint;
  sendButton.textContent = config.send;
  document.getElementById('cancel')!.textContent = config.cancel;
  update();
  input.focus();
}).catch(() => window.textInput.cancel());
