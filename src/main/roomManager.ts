import { EventEmitter } from 'node:events';
import { customHash, isCustomRef, type EmoteArt, type EmoteRef } from '../shared/emotes';
import type { PingId } from '../shared/pings';
import type { WardSprite } from '../shared/ipc';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { JoinResult, MemberPath, RoomMember, RoomStateCore } from '../shared/room';
import { formatRoomCode, makeRoomCode, parseRoomCode } from '../shared/roomCode';
import {
  decodeMessage, encodeMessage, isOlderThan, EMOTE_MAX_REFS, PROTOCOL_VERSION, sanitizeText, type MemberStatus, type PresenceMsg, type RoomMessage,
} from '../shared/roomProtocol';
import { RateLimiter } from './rateLimiter';
import { EmoteTransfer } from './emoteTransfer';
import { ReplayGuard } from './replayGuard';
import { open, seal, type RoomKeys } from './roomCrypto';
import type { PeerKey, Transport, TransportStatus } from './transport';

export const MAX_MEMBERS = 8;
/** New wards are refused at the cap; an existing ward is only removed by a local Enemy Vision ping or leaving the room. */
export const MAX_WARDS = 32;
const SETTLE_MS = 3000;
/** Relays can take a while to answer: the "room full" check never waits longer than this after joining. */
const SETTLE_CAP_MS = 15_000;
const TICK_MS = 1000;
/** How often presence is re-announced on each transport. */
const PRESENCE_MS: Record<Transport['kind'], number> = { lan: 2000, internet: 10_000 };
/** How long a path counts as alive after the last packet over it. */
const ALIVE_MS: Record<Transport['kind'], number> = { lan: 6000, internet: 25_000 };
/** Silence before a member is dropped: longer once it was heard over the internet, where presence comes every 10 s. */
const DROP_MS: Record<Transport['kind'], number> = { lan: 15_000, internet: 30_000 };
/** Pings and emotes over relays, per sender: one publish reaches everyone, and public relays only tolerate so much (tools/relay-probe). */
export const RELAY_PING_RATE = 5;
export const RELAY_PING_BURST = 10;
/** Presence asked for on a shared transport (a change, a new link, a new member): at most this often. */
const SHARED_PRESENCE_MS = 1000;
/** The first app version that shows emotes. */
const EMOTES_SINCE = '0.5.0';
const UNREACHABLE_MS = 20_000;
const LONELY_MS = 20_000;
const STALE_STRIKES = 3;
/** A housekeeping tick this late means the computer slept: nobody was heard because we weren't listening. */
const SLEEP_GAP_MS = 5000;
/** How long the clock warning stays up after the last stale presence. */
const SKEW_HINT_MS = 30_000;

export interface RemotePing {
  displayId: number;
  x: number;
  y: number;
  id: PingId;
  tag: { name: string; color: number };
}

export interface RemoteWard extends WardSprite {
  displayId: number;
}

export interface RemoteText {
  displayId: number;
  x: number;
  y: number;
  text: string;
  tag: { name: string; color: number };
}

export interface RemoteEmote {
  displayId: number;
  x: number;
  y: number;
  ref: EmoteRef;
  /** The sender, so their earlier emote can be replaced: everyone has one on screen at a time. */
  peer: string;
  tag: { name: string; color: number };
  /** A verified custom still received from the sender. */
  art?: EmoteArt;
}

export type RoomToast =
  | { kind: 'joined' | 'left' | 'disconnected'; name: string }
  | { kind: 'joinedRoom'; code: string }
  | { kind: 'full' };

export interface RoomDeps {
  transports: Transport[];
  now(): number;
  randomBytes(n: number): Uint8Array;
  deriveKeys(canonical: string): Promise<RoomKeys>;
  appVersion: string;
  /** Read on every use, so settings changes apply at once. `limit`: incoming pings per second per member, 0 = unlimited. */
  profile(): { name: string; color: number; limit: number; pingSizePx?: number };
  /** Display number → where a ping for it lands here, or null to drop it. The hook share mode will replace. */
  resolveTarget(d: number): { displayId: number; width: number; height: number } | null;
  customEmotes?(): readonly EmoteRef[];
  readEmote?(hash: string): Uint8Array | null;
}

interface Member {
  peer: string;
  name: string;
  color: number;
  status: MemberStatus;
  needsUpdate: boolean;
  noEmotes: boolean;
  muted: boolean;
  points: number;
  firstSeen: number;
  /** Ever heard over the internet: dropped after the longer silence. */
  viaInternet: boolean;
  /** Per transport kind: the address it was last heard from, and when. */
  paths: Partial<Record<Transport['kind'], { key: PeerKey; seenAt: number }>>;
}

const toHex = (b: Uint8Array): string => [...b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * The room: who is in it, what we send, and what we let through. Talks to the network only through transports,
 * which carry sealed packets. Events: 'state' (RoomStateCore), 'remotePing' (RemotePing), 'remoteEmote' (RemoteEmote), 'toast' (RoomToast),
 * 'saveCode' (canonical code | null: what "rejoin last room" should remember).
 */
export class RoomManager extends EventEmitter {
  /** Our peer ID: random per join, since a peer that said bye stays "gone" to the others for their whole session. */
  self: string;
  private phase: RoomStateCore['phase'] = 'idle';
  private code: string | null = null;
  private keys: RoomKeys | null = null;
  /** Bumped on every join and leave, so a join still deriving keys can tell it was cancelled. */
  private session = 0;
  private seq = 0;
  private members = new Map<string, Member>();
  private readonly wards = new Map<string, { d: number; x: number; y: number; tag: WardSprite['tag'] }>();
  private points = 0;
  private answered = new Set<PeerKey>();
  /** Per peer ID: stale presences seen, and when the last one came. Never turns into a member. */
  private staleStrikes = new Map<string, { count: number; at: number }>();
  private guard: ReplayGuard;
  private readonly limiter: RateLimiter;
  private paused = false;
  private roomMuted = false;
  private aloneSince: number | null = null;
  private lastPresence: Partial<Record<Transport['kind'], number>> = {};
  private ticker: NodeJS.Timeout | null = null;
  private lastTick = 0;
  /** When we last woke from sleep: members count as heard then, so they get a fresh grace period. */
  private wokeAt = 0;
  private settle: NodeJS.Timeout | null = null;
  /** The settle timer has been cut down from the cap to SETTLE_MS. */
  private settleShort = false;
  private joinedAt = 0;
  private lastState = '';
  private internetAllowed = true;
  /** The transports running for this room: all of them, except the internet one while it isn't allowed. */
  private readonly active = new Set<Transport>();
  private readonly relayCap: RateLimiter;
  /** A presence waiting out SHARED_PRESENCE_MS, per shared transport. */
  private readonly sharedTimers = new Map<Transport, NodeJS.Timeout>();
  private readonly emoteTransfer: EmoteTransfer;
  private readonly dataCap: RateLimiter;
  private readonly sentChunks = new Set<string>();
  private readonly pendingEmotes = new Map<string, { emote: RemoteEmote; at: number }>();

  constructor(private readonly deps: RoomDeps) {
    super();
    this.self = toHex(deps.randomBytes(8));
    this.guard = new ReplayGuard(deps.now);
    this.limiter = new RateLimiter(deps.now);
    this.relayCap = new RateLimiter(deps.now);
    this.dataCap = new RateLimiter(deps.now);
    this.emoteTransfer = new EmoteTransfer({
      now: deps.now,
      hashes: () => this.customHashes(),
      read: (h) => deps.readEmote?.(h) ?? null,
      send: (peer, body) => this.sendEmoteData(peer, body),
      ready: (h) => {
        for (const [peer, pending] of this.pendingEmotes) {
          if (customHash(pending.emote.ref) !== h) continue;
          this.pendingEmotes.delete(peer);
          const member = this.members.get(peer);
          if (!member || this.paused || this.roomMuted || member.muted || member.needsUpdate || deps.now() - pending.at > 10_000) continue;
          this.emit('remoteEmote', { ...pending.emote, art: this.emoteTransfer.art(pending.emote.ref) } satisfies RemoteEmote);
        }
      },
    });
    for (const t of deps.transports) {
      t.on('packet', (peer: PeerKey, packet: Uint8Array) => this.onPacket(t, peer, packet));
      t.on('peerGone', (peer: PeerKey) => this.onPeerGone(t, peer));
      t.on('status', (s: TransportStatus) => {
        // A fresh socket: tell everyone now rather than at the next round. Relays say so per relay, with linkUp.
        if (s === 'ok' && !t.shared) this.announce(t);
        this.checkSettle();
        this.emitState();
      });
      t.on('linkUp', () => this.announce(t));
    }
  }

  async create(): Promise<void> {
    await this.start(makeRoomCode(this.deps.randomBytes(9)));
  }

  async join(text: string): Promise<JoinResult> {
    const parsed = parseRoomCode(text);
    if (!parsed.ok) return parsed;
    return (await this.start(parsed.code)) ? { ok: true } : { ok: false, error: 'failed' };
  }

  /** Leaves the room and forgets it, so it isn't rejoined on the next launch. */
  leave(): void {
    if (this.phase === 'idle') return;
    this.stop();
    this.emit('saveCode', null);
  }

  /** Says bye on the way out, but keeps the code for "rejoin last room". */
  quit(): void {
    if (this.phase !== 'idle') this.stop();
  }

  sendPing(ping: PingId, shared: { d: number; x: number; y: number }): void {
    if (ping === 'enemyvision' && this.keys && !this.paused) this.clearWard(shared);
    this.sendShared({ t: 'ping', ping, ...shared });
  }

  /** Re-map persistent wards when a display's size or numbering changes. */
  wardsOnScreen(): RemoteWard[] {
    return [...this.wards].flatMap(([key, ward]) => {
      const target = this.deps.resolveTarget(ward.d);
      return target ? [{ key, displayId: target.displayId, x: ward.x * target.width, y: ward.y * target.height, tag: ward.tag }] : [];
    });
  }

  private clearWard(shared: { d: number; x: number; y: number }): void {
    const target = this.deps.resolveTarget(shared.d);
    if (!target) return;
    const radius = (this.deps.profile().pingSizePx ?? DEFAULT_SETTINGS.pingSizePx) / 2;
    let nearest: RemoteWard | undefined;
    let distance = radius;
    for (const ward of this.wardsOnScreen()) {
      if (ward.displayId !== target.displayId) continue;
      const next = Math.hypot(ward.x - shared.x * target.width, ward.y - shared.y * target.height);
      if (next <= distance) {
        nearest = ward;
        distance = next;
      }
    }
    if (!nearest) return;
    this.wards.delete(nearest.key);
    this.points = Math.min(Number.MAX_SAFE_INTEGER, this.points + 1);
    this.emit('wardCleared', { ...nearest, points: this.points });
    this.emit('wards', this.wardsOnScreen());
    this.announce();
    this.emitState();
  }

  sendEmote(e: EmoteRef, shared: { d: number; x: number; y: number }): void {
    this.sendShared({ t: 'emote', e, ...shared });
  }

  sendText(raw: string, shared: { d: number; x: number; y: number }): void {
    const text = sanitizeText(raw);
    if (text) this.sendShared({ t: 'text', text, ...shared });
  }

  /** A ping or an emote: each member gets it over its own route; shared transports get one send, within the relay cap. */
  private sendShared(body: Record<string, unknown>): void {
    if (this.phase === 'idle' || !this.keys || this.paused) return;
    const packet = this.seal(body);
    const sharedRoutes = new Set<Transport>();
    for (const m of this.members.values()) {
      const route = this.route(m);
      if (!route) continue;
      if (route.transport.shared) sharedRoutes.add(route.transport);
      else route.transport.sendTo(route.key, packet);
    }
    for (const t of sharedRoutes) if (this.relayCap.allow(t.kind, RELAY_PING_RATE, RELAY_PING_BURST)) t.broadcast(packet);
  }

  private customHashes(): string[] {
    return [...new Set((this.deps.customEmotes?.() ?? []).filter(isCustomRef).map(customHash))].slice(0, EMOTE_MAX_REFS);
  }

  /** Transfers use the ordinary room envelope, with five relay tokens reserved for pings and emotes. */
  private sendEmoteData(peer: string, body: Record<string, unknown>): boolean {
    const member = this.members.get(peer);
    if (!this.keys || !member || this.paused || member.needsUpdate) return false;
    const route = this.route(member);
    if (!route) return false;
    const chunk = body.t === 'chunk' ? `${route.transport.kind}:${body.h}:${body.i}` : null;
    if (route.transport.shared) {
      if (chunk && this.sentChunks.has(chunk)) return true; // one relay broadcast fills all requesters' assemblies
      if (!this.relayCap.allow(route.transport.kind, RELAY_PING_RATE, RELAY_PING_BURST, 5)) return false;
      route.transport.broadcast(this.seal(body));
      if (chunk) this.sentChunks.add(chunk);
    } else {
      route.transport.sendTo(route.key, this.seal(body));
    }
    return true;
  }

  setStatusFlags(f: { paused: boolean; roomMuted: boolean }): void {
    if (f.paused === this.paused && f.roomMuted === this.roomMuted) return;
    this.paused = f.paused;
    this.roomMuted = f.roomMuted;
    if (f.paused || f.roomMuted) {
      this.emoteTransfer.clear();
      this.pendingEmotes.clear();
    }
    this.announce();
    this.emitState();
  }

  muteMember(peer: string, on: boolean): void {
    const m = this.members.get(peer);
    if (!m) return;
    m.muted = on;
    if (on) {
      this.emoteTransfer.forget(peer);
      this.pendingEmotes.delete(peer);
    }
    this.emitState();
  }

  /**
   * "Allow internet connections". Turning it off mid-room sends no bye: a bye makes the others ignore our peer ID for
   * their whole session, LAN included. Members only reachable over the internet time out instead.
   */
  setInternetAllowed(on: boolean): void {
    if (on === this.internetAllowed) return;
    this.internetAllowed = on;
    const keys = this.keys;
    if (!keys) return; // idle, or still deriving keys: start() reads the flag
    for (const t of this.deps.transports) {
      if (t.kind !== 'internet') continue;
      if (on) {
        this.active.add(t);
        t.start(keys);
        this.announce(t);
        continue;
      }
      this.active.delete(t);
      this.cancelShared(t);
      t.stop();
      for (const m of this.members.values()) {
        const p = m.paths.internet;
        if (!p) continue;
        this.answered.delete(p.key);
        delete m.paths.internet;
      }
    }
    this.checkSettle();
    this.emitState();
  }

  /** Name or colour changed: tell everyone now. */
  profileChanged(): void {
    this.announce();
    this.emitState();
  }

  state(): RoomStateCore {
    const now = this.deps.now();
    const status = (kind: Transport['kind']): TransportStatus =>
      this.phase === 'idle' ? 'off' : ([...this.active].find((t) => t.kind === kind)?.status ?? 'off');
    const p = this.deps.profile();
    const members: RoomMember[] = this.phase === 'idle' ? [] : [
      { peer: this.self, name: p.name, color: p.color, path: 'lan', status: this.status(), needsUpdate: false, noEmotes: false, muted: false, self: true, points: this.points },
      ...[...this.members.values()].map((m) => ({
        peer: m.peer, name: m.name, color: m.color, path: this.path(m, now), status: m.status,
        needsUpdate: m.needsUpdate, noEmotes: m.noEmotes, muted: m.muted, self: false, points: m.points,
      })),
    ];
    return {
      phase: this.phase,
      code: this.code ? formatRoomCode(this.code) : null,
      members,
      lan: status('lan'),
      internet: status('internet'),
      lonely: this.aloneSince !== null && now - this.aloneSince >= LONELY_MS,
      clockSkew: [...this.staleStrikes.values()].some((s) => s.count >= STALE_STRIKES && now - s.at < SKEW_HINT_MS),
    };
  }

  /** False when the keys couldn't be derived: the room is back to idle. */
  private async start(code: string): Promise<boolean> {
    if (this.phase !== 'idle') this.leave();
    const session = ++this.session;
    this.self = toHex(this.deps.randomBytes(8));
    this.seq = 0;
    this.phase = 'joining';
    this.code = code;
    this.guard = new ReplayGuard(this.deps.now);
    this.aloneSince = this.deps.now();
    this.emitState();
    let keys: RoomKeys;
    try {
      keys = await this.deps.deriveKeys(code);
    } catch {
      if (session === this.session) this.stop();
      return false;
    }
    if (session !== this.session) return true; // left while deriving
    this.keys = keys;
    this.joinedAt = this.lastTick = this.deps.now();
    this.settleShort = false;
    this.settle = setTimeout(() => this.settled(), SETTLE_CAP_MS);
    for (const t of this.deps.transports) if (t.kind !== 'internet' || this.internetAllowed) this.active.add(t);
    for (const t of this.active) t.start(keys);
    this.announce();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.checkSettle();
    this.emitState();
    return true;
  }

  /**
   * "Room full" is judged 3 s after the relays have answered or given up, so members only reachable over the
   * internet count too; never later than SETTLE_CAP_MS after joining.
   */
  private checkSettle(): void {
    if (this.phase !== 'joining' || !this.settle || this.settleShort) return;
    if ([...this.active].some((t) => t.shared && (t.status === 'off' || t.status === 'starting'))) return;
    this.settleShort = true;
    clearTimeout(this.settle);
    this.settle = setTimeout(() => this.settled(), Math.min(SETTLE_MS, this.joinedAt + SETTLE_CAP_MS - this.deps.now()));
  }

  private settled(): void {
    this.settle = null;
    if (this.members.size >= MAX_MEMBERS) {
      this.stop();
      this.emit('toast', { kind: 'full' } satisfies RoomToast);
      return;
    }
    this.phase = 'active';
    this.emit('saveCode', this.code);
    this.emit('toast', { kind: 'joinedRoom', code: formatRoomCode(this.code!) } satisfies RoomToast);
    this.emitState();
  }

  private stop(): void {
    this.session++;
    if (this.keys) {
      const bye = this.seal({ t: 'bye' });
      for (const t of this.active) this.spread(t, bye);
      for (const t of this.active) t.stop();
    }
    this.active.clear();
    for (const t of [...this.sharedTimers.keys()]) this.cancelShared(t);
    if (this.ticker) clearInterval(this.ticker);
    if (this.settle) clearTimeout(this.settle);
    this.ticker = this.settle = null;
    this.phase = 'idle';
    this.code = this.keys = null;
    this.members.clear();
    this.wards.clear();
    this.points = 0;
    this.emit('wards', []);
    this.emoteTransfer.clear();
    this.pendingEmotes.clear();
    this.sentChunks.clear();
    this.dataCap.clear();
    this.answered.clear();
    this.staleStrikes.clear();
    this.lastPresence = {};
    this.aloneSince = null;
    this.emitState();
  }

  private tick(): void {
    const now = this.deps.now();
    if (now - this.lastTick > SLEEP_GAP_MS) this.wokeAt = now;
    this.lastTick = now;
    for (const [peer, s] of this.staleStrikes) if (now - s.at >= SKEW_HINT_MS) this.staleStrikes.delete(peer);
    for (const m of [...this.members.values()]) {
      const heard = Math.max(...Object.values(m.paths).map((p) => p.seenAt), m.firstSeen, this.wokeAt);
      if (now - heard >= DROP_MS[m.viaInternet ? 'internet' : 'lan']) this.remove(m, 'disconnected');
    }
    for (const t of this.active) {
      if (now - (this.lastPresence[t.kind] ?? 0) >= PRESENCE_MS[t.kind]) this.sendPresence(t);
    }
    this.sentChunks.clear();
    this.emoteTransfer.tick();
    for (const [peer, p] of this.pendingEmotes) if (now - p.at > 10_000) this.pendingEmotes.delete(peer);
    this.emitState();
  }

  private onPacket(t: Transport, key: PeerKey, packet: Uint8Array): void {
    if (!this.keys) return;
    const plain = open(this.keys.msgKey, packet);
    const msg = plain && decodeMessage(plain);
    if (!msg || msg.peer === this.self) return;
    const verdict = this.guard.accept(msg.peer, msg.seq, msg.ts);
    if (verdict === 'stale') return this.onStale(msg);
    if (verdict !== 'ok') return;
    this.staleStrikes.delete(msg.peer);

    if (msg.t === 'presence') return this.onPresence(t, key, msg);
    const m = this.members.get(msg.peer);
    if (msg.t === 'bye') {
      this.guard.markGone(msg.peer);
      if (m) this.remove(m, 'left');
      return;
    }
    if (!m) return;
    this.heard(m, t, key);
    // Muting only silences what we hear; peers can still fetch the images we share with them.
    if (msg.t === 'want') {
      if (!this.paused && !m.needsUpdate && msg.to === this.self && this.dataCap.allow(m.peer, 20, 40)) this.emoteTransfer.want(msg);
      return;
    }
    // Pings, emotes and text pass the same gates and share one budget per member.
    if (this.paused || this.roomMuted || m.muted || m.needsUpdate) return;
    if (msg.t === 'chunk') {
      if (!this.dataCap.allow(m.peer, 20, 40)) return;
      this.emoteTransfer.chunk(msg);
      return;
    }
    if (!this.limiter.allow(m.peer, this.deps.profile().limit)) return;
    const target = this.deps.resolveTarget(msg.d);
    if (!target) return;
    const [x, y] = [msg.x * target.width, msg.y * target.height];
    const tag = { name: m.name, color: m.color };
    if (msg.t === 'ping' && msg.ping === 'ward') {
      if (this.wards.size >= MAX_WARDS) return;
      this.wards.set(`${msg.peer}:${msg.seq}`, { d: msg.d, x: msg.x, y: msg.y, tag });
      this.emit('wards', this.wardsOnScreen());
    } else if (msg.t === 'ping') this.emit('remotePing', { displayId: target.displayId, x, y, id: msg.ping, tag } satisfies RemotePing);
    else if (msg.t === 'text') this.emit('remoteText', { displayId: target.displayId, x, y, text: msg.text, tag } satisfies RemoteText);
    else {
      this.pendingEmotes.delete(m.peer);
      if (isCustomRef(msg.e)) this.emoteTransfer.request(m.peer, customHash(msg.e));
      const art = this.emoteTransfer.art(msg.e);
      const emote: RemoteEmote = { displayId: target.displayId, x, y, ref: msg.e, peer: m.peer, tag, ...(art ? { art } : {}) };
      if (isCustomRef(msg.e) && !art) this.pendingEmotes.set(m.peer, { emote, at: this.deps.now() });
      this.emit('remoteEmote', emote);
    }
  }

  private onPresence(t: Transport, key: PeerKey, msg: PresenceMsg): void {
    let m = this.members.get(msg.peer);
    const isNew = !m;
    if (!m) {
      m = {
        peer: msg.peer, name: msg.name, color: msg.color, status: msg.status, needsUpdate: false, noEmotes: false, muted: false, points: 0,
        firstSeen: this.deps.now(), viaInternet: false, paths: {},
      };
      this.members.set(m.peer, m);
      this.aloneSince = null;
    }
    m.name = msg.name;
    m.color = msg.color;
    m.status = msg.status;
    // Presences can arrive out of order; points only increase within a peer's room session.
    m.points = Math.max(m.points, msg.points ?? 0);
    m.needsUpdate = msg.proto !== PROTOCOL_VERSION;
    m.noEmotes = isOlderThan(msg.app, EMOTES_SINCE);
    this.heard(m, t, key);
    if (!this.paused && !this.roomMuted && !m.muted && !m.needsUpdate) this.emoteTransfer.announce(m.peer, [...(msg.em ?? []), ...(msg.emMore ?? [])]);
    if (!this.answered.has(key)) {
      this.answered.add(key);
      if (t.shared) this.announce(t); // everyone hears it anyway, so it's an ordinary presence
      else t.sendTo(key, this.presencePacket());
    }
    if (isNew && this.phase === 'active') this.emit('toast', { kind: 'joined', name: m.name } satisfies RoomToast);
    this.emitState();
  }

  /**
   * Packets more than 10 minutes off our clock. Anyone on the network can replay old ones, so they never create,
   * refresh or reach a member; a few presences only raise the room-level clock warning.
   */
  private onStale(msg: RoomMessage): void {
    if (msg.t !== 'presence') return;
    const s = this.staleStrikes.get(msg.peer) ?? { count: 0, at: 0 };
    this.staleStrikes.set(msg.peer, { count: s.count + 1, at: this.deps.now() });
    this.emitState();
  }

  private onPeerGone(t: Transport, key: PeerKey): void {
    for (const m of this.members.values()) if (m.paths[t.kind]?.key === key) delete m.paths[t.kind];
    this.answered.delete(key);
    this.emitState();
  }

  private heard(m: Member, t: Transport, key: PeerKey): void {
    m.paths[t.kind] = { key, seenAt: this.deps.now() };
    if (t.kind === 'internet') m.viaInternet = true;
  }

  private remove(m: Member, kind: 'left' | 'disconnected'): void {
    this.members.delete(m.peer);
    this.limiter.forget(m.peer);
    this.dataCap.forget(m.peer);
    this.emoteTransfer.forget(m.peer);
    this.pendingEmotes.delete(m.peer);
    for (const p of Object.values(m.paths)) this.answered.delete(p.key);
    if (this.members.size === 0 && this.phase !== 'idle') this.aloneSince = this.deps.now();
    this.emit('toast', { kind, name: m.name } satisfies RoomToast);
    this.emitState();
  }

  /** LAN while it is alive, else internet, else nothing. */
  private route(m: Member): { transport: Transport; key: PeerKey } | null {
    const now = this.deps.now();
    for (const kind of ['lan', 'internet'] as const) {
      const p = m.paths[kind];
      const transport = [...this.active].find((t) => t.kind === kind);
      if (p && transport && now - p.seenAt < ALIVE_MS[kind]) return { transport, key: p.key };
    }
    return null;
  }

  private path(m: Member, now: number): MemberPath {
    const r = this.route(m);
    if (r) return r.transport.kind;
    return now - m.firstSeen < UNREACHABLE_MS ? 'connecting' : 'unreachable';
  }

  private status(): MemberStatus {
    return this.paused ? 'paused' : this.roomMuted ? 'muted' : 'on';
  }

  private presencePacket(): Buffer {
    const p = this.deps.profile();
    const em = this.customHashes();
    return this.seal({ t: 'presence', proto: PROTOCOL_VERSION, app: this.deps.appVersion, name: p.name, color: p.color, status: this.status(), points: this.points,
      ...(em.length ? { em: em.slice(0, 9) } : {}), ...(em.length > 9 ? { emMore: em.slice(9) } : {}) });
  }

  /**
   * Presence on one transport, or on every running one. A shared transport sends at most once a second: the first
   * request goes out at once, later ones in that second become one presence at its end, with the latest state.
   */
  private announce(only?: Transport): void {
    if (!this.keys) return;
    for (const t of only ? [only] : [...this.active]) {
      if (!this.active.has(t)) continue;
      if (!t.shared) {
        this.sendPresence(t);
        continue;
      }
      const wait = (this.lastPresence[t.kind] ?? -Infinity) + SHARED_PRESENCE_MS - this.deps.now();
      if (wait <= 0) this.sendPresence(t);
      else if (!this.sharedTimers.has(t)) {
        this.sharedTimers.set(t, setTimeout(() => {
          this.sharedTimers.delete(t);
          if (this.keys && this.active.has(t)) this.sendPresence(t);
        }, wait));
      }
    }
  }

  private sendPresence(t: Transport): void {
    this.cancelShared(t);
    this.spread(t, this.presencePacket());
    this.lastPresence[t.kind] = this.deps.now();
  }

  private cancelShared(t: Transport): void {
    const timer = this.sharedTimers.get(t);
    if (timer) clearTimeout(timer);
    this.sharedTimers.delete(t);
  }

  /**
   * Broadcast, and on LAN also straight to every member heard there: Wi-Fi broadcast has no retries and some
   * routers filter it, unicast doesn't. Duplicates are dropped by the receiver's replay guard.
   */
  private spread(t: Transport, packet: Uint8Array): void {
    t.broadcast(packet);
    if (t.shared) return; // one send already reached everyone
    for (const m of this.members.values()) {
      const key = m.paths.lan?.key;
      if (key) t.sendTo(key, packet);
    }
  }

  private seal(body: Record<string, unknown>): Buffer {
    const msg = { peer: this.self, seq: ++this.seq, ts: this.deps.now(), ...body } as RoomMessage;
    return seal(this.keys!.msgKey, encodeMessage(msg));
  }

  private emitState(): void {
    const s = this.state();
    const json = JSON.stringify(s);
    if (json === this.lastState) return;
    this.lastState = json;
    this.emit('state', s);
  }
}
