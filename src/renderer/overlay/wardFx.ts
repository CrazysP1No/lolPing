import type { WardSprite } from '../../shared/ipc';
import { textureUrl } from '../../shared/pings';
import { TAG_COLORS } from '../../shared/roomColors';

const div = (cls: string): HTMLDivElement => {
  const el = document.createElement('div');
  el.className = cls;
  return el;
};

/** Persistent room wards live outside the temporary ping layer and its timeout/flood cleanup. */
export class WardStage {
  private readonly live = new Map<string, HTMLElement>();

  constructor(private readonly layer: HTMLElement) {}

  /** Returns how many wards are new, so a position/size update doesn't replay their sound. */
  sync(wards: readonly WardSprite[], sizePx: number): number {
    const keys = new Set(wards.map((ward) => ward.key));
    for (const [key, root] of this.live) {
      if (keys.has(key)) continue;
      root.remove();
      this.live.delete(key);
    }
    let added = 0;
    for (const ward of wards) {
      let root = this.live.get(ward.key);
      if (!root) {
        root = div('ward');
        const art = document.createElement('img');
        art.className = 'ward-art';
        art.alt = '';
        art.draggable = false;
        art.src = textureUrl('ward');
        art.onerror = () => {
          art.onerror = null;
          art.src = textureUrl('enemy_vision');
        };
        const tag = div('tag');
        tag.textContent = ward.tag.name;
        tag.style.setProperty('--tag', TAG_COLORS[ward.tag.color] ?? TAG_COLORS[0]);
        root.append(div('ward-aura'), div('ward-scan'), art, tag);
        this.live.set(ward.key, root);
        this.layer.append(root);
        added++;
      }
      root.style.left = `${ward.x}px`;
      root.style.top = `${ward.y}px`;
      root.style.setProperty('--size', `${sizePx}px`);
    }
    return added;
  }

  /** A successful clear plays once, even if another snapshot or clear arrives during the effect. */
  clear(key: string): boolean {
    const root = this.live.get(key);
    if (!root) return false;
    this.live.delete(key);
    root.className = 'ward cleared';
    const point = div('ward-point');
    point.textContent = '+1';
    root.append(point);
    setTimeout(() => root.remove(), 900);
    return true;
  }
}
