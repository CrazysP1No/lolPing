import type { PingTag } from '../../shared/ipc';
import { TAG_COLORS } from '../../shared/roomColors';

export function spawnText(layer: HTMLElement, text: string, x: number, y: number, tag?: PingTag): void {
  while (layer.childElementCount >= 12) layer.firstElementChild?.remove();
  const bubble = document.createElement('div');
  bubble.className = 'textBubble';
  const content = document.createElement('div');
  content.textContent = text;
  bubble.append(content);
  if (tag) {
    const name = document.createElement('small');
    name.textContent = tag.name;
    name.style.color = TAG_COLORS[tag.color];
    bubble.append(name);
  }
  layer.append(bubble);
  bubble.style.left = `${Math.max(12, Math.min(x - bubble.offsetWidth / 2, layer.clientWidth - bubble.offsetWidth - 12))}px`;
  bubble.style.top = `${Math.max(12, Math.min(y - bubble.offsetHeight - 16, layer.clientHeight - bubble.offsetHeight - 12))}px`;
  setTimeout(() => bubble.remove(), 5000);
}
