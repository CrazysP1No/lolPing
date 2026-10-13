import { createHash } from 'node:crypto';
import { VIDEO_MAX_BYTES, type SharedVideo } from '../shared/emotes';
import { VIDEO_CHUNK_BYTES, VIDEO_TRANSFER_MS, type VideoChunkMsg, type VideoWantMsg } from '../shared/roomProtocol';

type Body = Omit<VideoWantMsg, 'peer' | 'seq' | 'ts'> | Omit<VideoChunkMsg, 'peer' | 'seq' | 'ts'>;
interface Incoming {
  peer: string; ref: string; video: SharedVideo; parts: (Buffer | undefined)[];
  started: number; last: number; retries: number; saving: boolean; c: number;
}
interface Outgoing { h: string; bytes: Uint8Array; need: Set<number>; started: number; c: number }
export const videoHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 32);

/** Original video transfers are separate from the small, eager poster transfers. */
export class RoomVideoTransfer {
  private readonly incoming = new Map<string, Incoming>();
  private readonly waiting = new Map<string, { ref: string; video: SharedVideo }>();
  private readonly outgoing = new Map<string, Outgoing>();

  constructor(private readonly deps: {
    now(): number;
    chunkBytes?(peer: string): number;
    read(ref: string): Uint8Array | null;
    cached(hash: string): string | null;
    save(hash: string, bytes: Uint8Array): Promise<string | null>;
    send(peer: string, body: Body): boolean;
    ready(peer: string, hash: string, url: string): void;
    failed(peer: string, hash: string): void;
  }) {}

  describe(ref: string): SharedVideo | undefined {
    const bytes = this.deps.read(ref);
    return bytes && bytes.length > 0 && bytes.length <= VIDEO_MAX_BYTES ? { h: videoHash(bytes), size: bytes.length } : undefined;
  }

  request(peer: string, ref: string, video: SharedVideo): string | null {
    const cached = this.deps.cached(video.h);
    if (cached) { this.cancelIncoming(peer); return cached; }
    if (this.incoming.get(peer)?.video.h === video.h) return null;
    this.cancelIncoming(peer);
    if (this.waiting.size >= 8) return null;
    this.waiting.set(peer, { ref, video });
    this.startWaiting();
    return null;
  }

  want(msg: VideoWantMsg): void {
    if (msg.need === null) {
      const q = this.outgoing.get(msg.peer);
      if (q?.h === msg.h && q.c === msg.c) this.outgoing.delete(msg.peer);
      return;
    }
    let q = this.outgoing.get(msg.peer);
    if (!q || q.h !== msg.h || q.c !== msg.c) {
      if (!q && this.outgoing.size >= 8) return;
      const bytes = [...this.outgoing.values()].find((p) => p.h === msg.h)?.bytes ?? this.deps.read(msg.e);
      if (!bytes || bytes.length === 0 || bytes.length > VIDEO_MAX_BYTES || videoHash(bytes) !== msg.h) return;
      q = { h: msg.h, bytes, need: new Set(), started: this.deps.now(), c: msg.c };
      this.outgoing.set(msg.peer, q);
    }
    const count = Math.ceil(q.bytes.length / q.c);
    for (const i of msg.need.length ? msg.need : Array.from({ length: count }, (_, i) => i)) if (i < count) q.need.add(i);
  }

  chunk(msg: VideoChunkMsg): void {
    const a = this.incoming.get(msg.peer);
    if (!a || a.saving || a.video.h !== msg.h || a.parts[msg.i]) return;
    const count = Math.ceil(a.video.size / a.c);
    if (msg.n !== count || msg.i < 0 || msg.i >= count) return;
    const bytes = Buffer.from(msg.b, 'base64');
    if (bytes.length !== Math.min(a.c, a.video.size - msg.i * a.c)) return;
    a.parts[msg.i] = bytes;
    a.last = this.deps.now();
    a.retries = 0;
    if (Array.from({ length: count }, (_, i) => a.parts[i]).some((b) => !b)) return;
    const video = Buffer.concat(a.parts as Buffer[]);
    a.parts = [];
    if (videoHash(video) !== a.video.h) return this.fail(a);
    a.saving = true;
    void this.deps.save(a.video.h, video).then((url) => {
      if (this.incoming.get(a.peer) !== a) return;
      if (!url) return this.fail(a);
      this.incoming.delete(a.peer);
      this.deps.ready(a.peer, a.video.h, url);
      this.startWaiting();
    }).catch(() => { if (this.incoming.get(a.peer) === a) this.fail(a); });
  }

  tick(): void {
    const now = this.deps.now();
    for (const a of this.incoming.values()) {
      const c = this.deps.chunkBytes?.(a.peer) ?? VIDEO_CHUNK_BYTES;
      if (!a.saving && c !== a.c) { this.cancelIncoming(a.peer); this.request(a.peer, a.ref, a.video); continue; }
      if (now - a.started >= VIDEO_TRANSFER_MS || (now - a.last >= 15_000 && a.retries >= 5)) { this.fail(a); continue; }
      if (a.saving || now - a.last < 15_000) continue;
      const count = Math.ceil(a.video.size / a.c);
      const need = Array.from({ length: count }, (_, i) => i).filter((i) => !a.parts[i]).slice(0, 64);
      if (this.deps.send(a.peer, { t: 'vwant', to: a.peer, e: a.ref, h: a.video.h, c: a.c, need })) a.retries++;
      a.last = now;
    }
    for (const [peer, q] of this.outgoing) {
      if (now - q.started >= VIDEO_TRANSFER_MS) { this.outgoing.delete(peer); continue; }
      let sent = 0;
      const n = Math.ceil(q.bytes.length / q.c);
      for (const i of q.need) {
        const b = Buffer.from(q.bytes.subarray(i * q.c, (i + 1) * q.c)).toString('base64');
        if (sent >= 20 || !this.deps.send(peer, { t: 'vchunk', h: q.h, i, n, b })) break;
        q.need.delete(i); sent++;
      }
      if (!q.need.size) this.outgoing.delete(peer);
    }
    this.startWaiting();
  }

  forget(peer: string): void { this.cancelIncoming(peer); this.outgoing.delete(peer); }
  cancel(peer: string): void { this.cancelIncoming(peer); }
  clear(): void {
    for (const peer of this.incoming.keys()) this.cancelIncoming(peer);
    this.waiting.clear(); this.outgoing.clear();
  }

  private cancelIncoming(peer: string): void {
    const a = this.incoming.get(peer);
    if (a) this.deps.send(peer, { t: 'vwant', to: peer, e: a.ref, h: a.video.h, c: a.c, need: null });
    this.incoming.delete(peer); this.waiting.delete(peer);
  }

  private startWaiting(): void {
    for (const [peer, p] of this.waiting) {
      if (this.incoming.size >= 2) break;
      this.waiting.delete(peer);
      const now = this.deps.now();
      const c = this.deps.chunkBytes?.(peer) ?? VIDEO_CHUNK_BYTES;
      this.incoming.set(peer, { peer, ref: p.ref, video: p.video, parts: [], started: now, last: now, retries: 0, saving: false, c });
      this.deps.send(peer, { t: 'vwant', to: peer, e: p.ref, h: p.video.h, c, need: [] });
    }
  }

  private fail(a: Incoming): void {
    this.cancelIncoming(a.peer);
    this.deps.failed(a.peer, a.video.h);
    this.startWaiting();
  }
}
