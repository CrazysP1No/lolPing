import { EMOTE_DURATION_S } from '../../shared/emotes';

const div = (cls: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  return d;
};

function image(cls = ''): HTMLImageElement {
  const el = document.createElement('img');
  if (cls) el.className = cls;
  el.alt = '';
  el.draggable = false;
  return el;
}

/** What stands in for an emote whose files are missing. */
export function bubble(): HTMLDivElement {
  const b = div('bubble');
  b.textContent = '?';
  return b;
}

/** The seed for where an emote's ornaments land: hex digits 5–8 of its hash, so the same image always throws the same way. */
function seedFromUrl(url: string): number {
  const hash = /([0-9a-f]{32})\.(?:webp|anim)/.exec(url)?.[1];
  return hash ? Number.parseInt(hash.slice(4, 8), 16) : 0;
}

/** The CSS envelope a custom image or the placeholder plays in: what the baked animation does for a bundled emote. */
export function envelope(child: HTMLElement, variant: number): HTMLDivElement {
  const fx = div(`fx v${variant}`);
  fx.append(child);
  return fx;
}

/**
 * The ornamented effects (only they have entries; the other variants get no ornaments), replaying what the bundled
 * emotes are baked with: the art lands amid large soft blots of
 * light — as big as the art itself, real glow sprites (Kenney's CC0 particle pack) tinted per blot — bursting through
 * a shockwave ring, with a spark flourish. `blobs` are the light, `ring` the landing shockwave, `spark` the sparkle.
 */
interface FxSpec {
  blobs: { sprites: readonly string[]; colors: readonly string[]; count: number; far: number };
  ring: string;
  spark: string;
}

/** Relative to either renderer page: both sit one level under the app root, where Vite publishes assets/. */
const fxSprite = (name: string): string => `../fx/${name}.png`;

/** CSS that turns a white sprite into `color`'d light: sepia gives it pigment, hue-rotate aims it, saturate deepens it. */
function tint(color: string): string {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  const hue = Math.round((Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI);
  const bright = Math.max(r, g, b) / 255;
  const sat = bright === 0 ? 0 : 1 - Math.min(r, g, b) / bright;
  return `brightness(${(0.55 + bright * 0.65).toFixed(2)}) sepia(1) saturate(${(2.2 + sat * 4).toFixed(2)}) hue-rotate(${hue}deg)`;
}

const FX_SPECS: Readonly<Record<number, FxSpec>> = {
  6: {
    blobs: { sprites: ['light_01', 'light_02', 'light_01'], colors: ['#ffd76e', '#fff3c4', '#ffb84d'], count: 3, far: 0.62 }, // the golden bloom
    ring: '#ffd76e',
    spark: 'star_08', // four-point sparkle
  },
  7: {
    blobs: { sprites: ['light_02', 'light_01', 'twirl_01'], colors: ['#7ee787', '#d8ffe0', '#3fbf5a'], count: 3, far: 0.55 }, // the verdant burst
    ring: '#7ee787',
    spark: 'spark_03',
  },
  8: {
    blobs: { sprites: ['flare_01', 'light_02', 'light_01'], colors: ['#ffffff', '#ffe9b8', '#ff9d5c'], count: 4, far: 0.78 }, // the blast
    ring: '#ffedd0',
    spark: 'muzzle_03', // the jagged white-hot muzzle flash
  },
  9: {
    blobs: { sprites: ['light_02', 'twirl_01', 'light_01'], colors: ['#9d7bff', '#d9c8ff', '#5b3fd6'], count: 3, far: 0.5 }, // the warp
    ring: '#9d7bff',
    spark: 'star_08',
  },
  10: {
    blobs: { sprites: ['flare_01', 'spark_03', 'light_01'], colors: ['#fff8d6', '#ffe14d', '#ffb84d'], count: 3, far: 0.6 }, // the thunderclap
    ring: '#ffe97a',
    spark: 'spark_03', // the lightning branch
  },
  11: {
    blobs: { sprites: ['light_01', 'light_02', 'circle_05'], colors: ['#7ad7f0', '#d0f4ff', '#2f9dc4'], count: 4, far: 0.66 }, // the splash
    ring: '#7ad7f0',
    spark: 'light_02', // a droplet's soft round gleam
  },
  12: {
    blobs: { sprites: ['star_05', 'star_08', 'circle_03'], colors: ['#ff6b9d', '#ffd76e', '#7ee787'], count: 5, far: 0.85 }, // the confetti
    ring: '#ffd76e',
    spark: 'star_05',
  },
};

/**
 * The light around the art: tinted glow sprites as wide as `sizePx` * `frac`, staggered and seeded so the same image
 * always paints the same bloom, the landing shockwave, and a twinkling sparkle. Counts are low on purpose — every
 * sprite is a filtered, screen-blended layer for the emote's whole 3 s, and a busy room plays several at once.
 */
function ornaments(variant: number, sizePx: number, seed: number): HTMLElement[] {
  const spec = FX_SPECS[variant];
  if (!spec) return [];
  const out: HTMLElement[] = [];
  const spin = (seed % 10) * (Math.PI / 20);
  const sizes = [0.55, 0.38, 0.3, 0.22, 0.18, 0.16]; // the first glow is over half the art, like the baked ones
  for (let i = 0; i < spec.blobs.count; i++) {
    const ang = spin + i * 2.399963; // golden angle: the glows never line up
    const dist = sizePx * (0.22 + (i % 3) * 0.16) * (spec.blobs.far / 0.62); // far is relative to v6's 0.62
    const b = document.createElement('i');
    b.className = 'blob';
    b.style.width = b.style.height = `${Math.round(sizePx * sizes[i % sizes.length])}px`;
    b.style.setProperty('--dx', `${Math.round(Math.cos(ang) * dist)}px`);
    b.style.setProperty('--dy', `${Math.round(Math.sin(ang) * dist)}px`);
    b.style.setProperty('--dl', `${i * 70}ms`);
    b.style.setProperty('--rot', `${(seed + i * 47) % 360}deg`);
    // The sprites are white-on-transparent: sepia + saturate + hue-rotate tint the glow itself, screen blending
    // lights it onto whatever is behind.
    b.style.backgroundImage = `url(${fxSprite(spec.blobs.sprites[i % spec.blobs.sprites.length])})`;
    b.style.filter = `${tint(spec.blobs.colors[i % spec.blobs.colors.length])} drop-shadow(0 0 10px ${spec.blobs.colors[i % spec.blobs.colors.length]})`;
    out.push(b);
  }
  const ring = document.createElement('i');
  ring.className = 'ring';
  ring.style.setProperty('--ring', spec.ring); // the shockwave sprite is tinted by drop-shadow
  out.push(ring);
  const ang = spin + 1.1;
  const dist = sizePx * 0.52;
  const s = document.createElement('i');
  s.className = 'spark';
  s.style.width = s.style.height = `${Math.round(sizePx * 0.22)}px`;
  s.style.setProperty('--dx', `${Math.round(Math.cos(ang) * dist)}px`);
  s.style.setProperty('--dy', `${Math.round(Math.sin(ang) * dist)}px`);
  s.style.setProperty('--dl', '250ms');
  s.style.setProperty('--rot', `${(seed * 3) % 360}deg`);
  s.style.backgroundImage = `url(${fxSprite(spec.spark)})`;
  s.style.filter = `drop-shadow(0 0 8px ${spec.blobs.colors[0]})`;
  out.push(s);
  return out;
}

/**
 * The `.fx` div playing `variant` on the image at `url`, ornaments and all — what a custom emote shows inside its
 * `.emote` box. The overlay spawns it once per emote; the effect picker's tiles remount it on a timer, which restarts
 * the entrance and keeps the effects looping.
 */
export function emoteFxContent(variant: number, url: string, sizePx: number): HTMLDivElement {
  const img = image();
  img.addEventListener('error', () => img.replaceWith(bubble()), { once: true });
  img.src = url;
  const fx = envelope(img, variant);
  for (const o of ornaments(variant, sizePx, seedFromUrl(url))) fx.append(o);
  return fx;
}

/**
 * Pays what the first effect on a page would otherwise pay mid-gesture: decoding every glow sprite, and painting one
 * off-screen frame of the tint-filter + screen-blend pipeline (a filter chain compiles its shaders the first time it
 * is painted, not loaded). Call once from a page that can show effects; after it, the picker opens and the first
 * ornamented emote lands without the hitch.
 */
export function warmFx(): void {
  const urls = new Set<string>();
  for (const spec of Object.values(FX_SPECS)) {
    for (const s of spec.blobs.sprites) urls.add(fxSprite(s));
    urls.add(fxSprite(spec.spark));
  }
  for (const url of urls) {
    const img = new Image();
    img.src = url;
    void img.decode().catch(() => undefined); // a missing sprite is the placeholder's business, not a crash here
  }
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;opacity:.01;pointer-events:none;';
  const root = document.createElement('div');
  root.className = 'emote';
  root.style.setProperty('--size', '8px');
  root.append(emoteFxContent(6, 'data:,', 8)); // the golden bloom: blobs, ring and spark in one go
  stage.append(root);
  document.body.append(stage);
  requestAnimationFrame(() => requestAnimationFrame(() => stage.remove())); // two frames: one to paint, one to be sure
}
