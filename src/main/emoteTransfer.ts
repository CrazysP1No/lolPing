import { createHash } from 'node:crypto';
import { customHash, isCustomRef, STILL_MAX_BYTES, type EmoteArt } from '../shared/emotes';
import { EMOTE_CHUNK_BYTES, EMOTE_MAX_REFS, type ChunkMsg, type WantMsg } from '../shared/roomProtocol';
import { checkStill } from './emoteLibrary';

type TransferBody = Pick<WantMsg, 't' | 'to' | 'h' | 'need'> | Pick<ChunkMsg, 't' | 'h' | 'i' | 'n' | 'b'>;
interface Assembly {
  peer: string;
  h: string;
  parts: (Buffer | undefined)[];
  n: number;
  bytes: number;
  started: number;
  last: number;
  retries: number;
}
interface Outgoing {
  peer: string;
  h: string;
  chunks: string[];
  need: Set<number>;
  started: number;
}

/** Bounded still cache and reliable chunks over the room's existing encrypted routes. */
export class EmoteTransfer {
  private readonly announced = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Assembly>();
  private readonly outgoing = new Map<string, Outgoing>();
  // shortcut: stills are cached for this room session only; persist them if rejoining needs instant previews.
  private readonly cache = new Map<string, Buffer>();

  constructor(private readonly deps: {
    now(): number;
    hashes(): string[];
    read(hash: string): Uint8Array | null;
    send(peer: string, body: TransferBody): boolean;
    ready(hash: string): void;
  }) {}

  art(ref: string): EmoteArt | undefined {
    const image = isCustomRef(ref) ? this.cache.get(customHash(ref)) : undefined;
    return image ? { kind: 'custom', url: `data:image/webp;base64,${image.toString('base64')}`, animated: false } : undefined;
  }

  announce(peer: string, hashes: string[]): void {
    if (!this.announced.has(peer) && this.announced.size >= 8) return;
    this.announced.set(peer, new Set(hashes));
    for (const [key, a] of this.incoming) if (a.peer === peer && !hashes.includes(a.h)) this.incoming.delete(key);
    for (const h of hashes) this.request(peer, h);
  }

  /** An emote can arrive before its updated presence; its reference also announces the image. */
  request(peer: string, h: string): void {
    if (!this.announced.has(peer) && this.announced.size >= 8) return;
    const hashes = this.announced.get(peer) ?? new Set<string>();
    hashes.add(h);
    if (hashes.size > EMOTE_MAX_REFS) hashes.delete(hashes.values().next().value!);
    this.announced.set(peer, hashes);
    const key = `${peer}:${h}`;
    if (this.cache.has(h) || this.incoming.has(key)) return;
    const local = this.deps.read(h);
    if (local && this.valid(h, local)) {
      this.put(h, Buffer.from(local));
      return;
    }
    // One complete wheel plus centre (17 × 12 KB) fits under the 256 KB assembly budget.
    if (this.incoming.size >= EMOTE_MAX_REFS) return;
    const now = this.deps.now();
    this.incoming.set(key, { peer, h, parts: [], n: 0, bytes: 0, started: now, last: now, retries: 0 });
    this.deps.send(peer, { t: 'want', to: peer, h, need: [] });
  }

  want(msg: WantMsg): void {
    if (!this.deps.hashes().includes(msg.h)) return;
    const key = `${msg.peer}:${msg.h}`;
    let q = this.outgoing.get(key);
    if (!q) {
      if (this.outgoing.size >= 8 * EMOTE_MAX_REFS) return;
      const bytes = this.deps.read(msg.h);
      if (!bytes || !this.valid(msg.h, bytes)) return;
      const chunks: string[] = [];
      for (let at = 0; at < bytes.length; at += EMOTE_CHUNK_BYTES) chunks.push(Buffer.from(bytes.subarray(at, at + EMOTE_CHUNK_BYTES)).toString('base64'));
      q = { peer: msg.peer, h: msg.h, chunks, need: new Set(), started: this.deps.now() };
      this.outgoing.set(key, q);
    }
    for (const i of msg.need.length ? msg.need : q.chunks.map((_, i) => i)) if (i < q.chunks.length) q.need.add(i);
  }

  chunk(msg: ChunkMsg): void {
    const key = `${msg.peer}:${msg.h}`;
    const a = this.incoming.get(key);
    if (!a || !this.announced.get(msg.peer)?.has(msg.h)) return;
    if ((a.n && a.n !== msg.n) || a.parts[msg.i]) return;
    const bytes = Buffer.from(msg.b, 'base64');
    if (a.bytes + bytes.length > STILL_MAX_BYTES) {
      this.incoming.delete(key);
      return;
    }
    a.n = msg.n;
    a.parts[msg.i] = bytes;
    a.bytes += bytes.length;
    a.last = this.deps.now();
    if (Array.from({ length: a.n }, (_, i) => a.parts[i]).some((b) => !b)) return;
    this.incoming.delete(key);
    const image = Buffer.concat(a.parts as Buffer[]);
    if (!this.valid(msg.h, image)) return;
    this.put(msg.h, image);
    this.deps.ready(msg.h);
  }

  tick(): void {
    const now = this.deps.now();
    for (const [key, a] of this.incoming) {
      if (now - a.started >= 60_000 || (now - a.last >= 3000 && a.retries >= 3)) {
        this.incoming.delete(key);
      } else if (now - a.last >= 3000) {
        const need = Array.from({ length: a.n }, (_, i) => i).filter((i) => !a.parts[i]);
        if (this.deps.send(a.peer, { t: 'want', to: a.peer, h: a.h, need })) a.retries++;
        a.last = now;
      }
    }
    const sent = new Map<string, number>();
    for (const [key, q] of this.outgoing) {
      if (now - q.started >= 60_000 || !this.deps.hashes().includes(q.h)) {
        this.outgoing.delete(key);
        continue;
      }
      for (const i of q.need) {
        if ((sent.get(q.peer) ?? 0) >= 20 || !this.deps.send(q.peer, { t: 'chunk', h: q.h, i, n: q.chunks.length, b: q.chunks[i] })) break;
        sent.set(q.peer, (sent.get(q.peer) ?? 0) + 1);
        q.need.delete(i);
      }
      if (!q.need.size) this.outgoing.delete(key);
    }
  }

  forget(peer: string): void {
    this.announced.delete(peer);
    for (const [key, a] of this.incoming) if (a.peer === peer) this.incoming.delete(key);
    for (const [key, q] of this.outgoing) if (q.peer === peer) this.outgoing.delete(key);
  }

  clear(): void {
    this.announced.clear();
    this.incoming.clear();
    this.outgoing.clear();
    this.cache.clear();
  }

  private valid(h: string, bytes: Uint8Array): boolean {
    return checkStill(bytes) === null && createHash('sha256').update(bytes).digest('hex').slice(0, 32) === h;
  }

  private put(h: string, bytes: Buffer): void {
    for (const [key, a] of this.incoming) if (a.h === h) this.incoming.delete(key);
    if (this.cache.size >= 8 * EMOTE_MAX_REFS) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(h, bytes);
  }
}
