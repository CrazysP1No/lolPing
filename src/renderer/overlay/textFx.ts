import type { PingTag } from '../../shared/ipc';
import { TAG_COLORS } from '../../shared/roomColors';

const TEXT_DURATION_MS = 5000;

export function spawnText(layer: HTMLElement, text: string, x: number, y: number, tag?: PingTag): void {
  const root = document.createElement('div');
  root.className = 'text-pop';
  root.style.left = `${x}px`;
  root.style.top = `${y}px`;
  if (tag) root.style.setProperty('--tag', TAG_COLORS[tag.color] ?? TAG_COLORS[0]);
  const body = document.createElement('div');
  body.className = 'text-body';
  body.textContent = text;
  root.append(body);
  if (tag) {
    const name = document.createElement('div');
    name.className = 'text-name';
    name.textContent = tag.name;
    root.append(name);
  }
  layer.append(root);
  setTimeout(() => root.remove(), TEXT_DURATION_MS);
}
