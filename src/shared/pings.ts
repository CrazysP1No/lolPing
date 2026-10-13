export type PingId =
  | 'danger' | 'push' | 'omw' | 'allin' | 'assist' | 'needvision' | 'missing' | 'enemyvision' | 'generic'
  | 'bait' | 'visioncleared' | 'ward'
  | 'orb_gray' | 'orb_blue' | 'orb_gold' | 'orb_prismatic' | 'orb_void';

export const WARD_CLEAR_SOUND = 'ward_clear';

export interface PingDef {
  id: PingId;
  name: string;
  /** Texture on the wheel slice: file in assets/textures without ".png". */
  icon: string;
  /** Textures drawn at the ping location. Two entries = All In's clashing halves. */
  art: string[];
  /** File in assets/sounds without ".wav". */
  sound: string;
  /** Ring and glow colour. */
  color: string;
}

/** Every ping in the settings gallery: standard signals followed by loot orbs. */
export const ALL_PINGS: readonly PingDef[] = [
  { id: 'danger', name: 'Danger', icon: 'pingwheel_retreatrender', art: ['pingwheel_retreatrender'], sound: 'SRP_12', color: '#ff3b55' },
  { id: 'push', name: 'Push', icon: 'push', art: ['pingwheel_pushrender'], sound: 'SRP_9', color: '#35d27a' },
  { id: 'omw', name: 'On My Way', icon: 'omw', art: ['omw'], sound: 'OnMyWay', color: '#2e8bff' },
  { id: 'allin', name: 'All In', icon: 'all_in', art: ['pingwheel_allin_render_01', 'pingwheel_allin_render_02'], sound: 'SRP_4', color: '#f2b320' },
  { id: 'assist', name: 'Assist Me', icon: 'assist_me', art: ['assist_me'], sound: 'ComeHere', color: '#56d43c' },
  { id: 'needvision', name: 'Need Vision', icon: 'need_vision', art: ['need_vision'], sound: 'SRP_7', color: '#56d43c' },
  { id: 'missing', name: 'Enemy Missing', icon: 'enemy_missing', art: ['enemy_missing'], sound: 'MIA', color: '#f2c518' },
  { id: 'enemyvision', name: 'Enemy Vision', icon: 'enemy_vision', art: ['pingwheel_enemyvisionrender'], sound: 'AreaIsWarded', color: '#ff3b55' },
  { id: 'generic', name: 'Generic', icon: 'generic_ping', art: ['pingwheel_basicpingrender'], sound: 'Base', color: '#2e8bff' },
  { id: 'bait', name: 'Bait', icon: 'pingwheel_baitrender', art: ['pingwheel_baitrender'], sound: 'SRP_11', color: '#efbc12' },
  { id: 'visioncleared', name: 'Vision Cleared', icon: 'vision_cleared', art: ['pingwheel_visionclearedrender'], sound: 'SRP_6', color: '#2b80ff' },
  { id: 'ward', name: 'Place Ward', icon: 'ward', art: ['ward'], sound: 'ward_place', color: '#63eea0' },
  { id: 'orb_gray', name: 'Gray Loot Orb', icon: 'orb_gray', art: ['orb_gray'], sound: 'Base', color: '#aab8c8' },
  { id: 'orb_blue', name: 'Blue Loot Orb', icon: 'orb_blue', art: ['orb_blue'], sound: 'Base', color: '#59b8ff' },
  { id: 'orb_gold', name: 'Gold Loot Orb', icon: 'orb_gold', art: ['orb_gold'], sound: 'Base', color: '#ffd66a' },
  { id: 'orb_prismatic', name: 'Prismatic Loot Orb', icon: 'orb_prismatic', art: ['orb_prismatic'], sound: 'Base', color: '#ceb5ff' },
  { id: 'orb_void', name: 'Void Loot Orb', icon: 'orb_void', art: ['orb_void'], sound: 'Base', color: '#a05cff' },
];

/** Original compass slots stay at even indices; the extra slots include the five loot orb styles. */
export const DEFAULT_WHEEL: readonly PingId[] = [
  'danger', 'bait', 'push', 'visioncleared', 'omw', 'orb_prismatic', 'allin', 'ward',
  'assist', 'orb_gray', 'needvision', 'orb_blue', 'missing', 'orb_gold', 'enemyvision', 'orb_void',
];
export const DEFAULT_CLICK_PING: PingId = 'generic';
export const WHEEL_SLOTS = 16;

export const TICK_SOUND = 'button';
export const FALLBACK_TEXTURE = 'generic_ping';

export function pingById(id: string): PingDef | undefined {
  return ALL_PINGS.find((p) => p.id === id);
}

export const isPingId = (v: unknown): v is PingId => typeof v === 'string' && pingById(v) !== undefined;

/** Looks up ids already known to be valid (from normalized settings). */
export const pingsFor = (ids: readonly PingId[]): PingDef[] => ids.map((id) => pingById(id) as PingDef);

export const DEFAULT_WHEEL_PINGS: readonly PingDef[] = pingsFor(DEFAULT_WHEEL);

/** Relative to a renderer page at <root>/<page>/index.html; assets/ is served at <root>/. */
export const textureUrl = (name: string): string => `../textures/${name}.png`;
export const soundUrl = (name: string): string => `../sounds/${name}.wav`;

export function allSoundNames(): string[] {
  return [...new Set([...ALL_PINGS.map((p) => p.sound), TICK_SOUND, WARD_CLEAR_SOUND])];
}

export function allTextureNames(): string[] {
  return [...new Set([...ALL_PINGS.flatMap((p) => [p.icon, ...p.art]), FALLBACK_TEXTURE])];
}
