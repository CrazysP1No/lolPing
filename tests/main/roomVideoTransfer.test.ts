import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RoomVideoTransfer } from '../../src/main/roomVideoTransfer';
import type { SharedVideo } from '../../src/shared/emotes';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 32);
const ref = `c:${'a'.repeat(32)}`;

async function transfer(drop = -1) {
  let now = 0;
  const bytes = new Uint8Array(100_000).fill(7);
  const video: SharedVideo = { h: hash(bytes), size: bytes.length };
  const wire: { side: number; body: Record<string, unknown> }[] = [];
  const ready: string[] = [];
  const cached = new Map<string, string>();
  const peers = [0, 1].map((side) => new RoomVideoTransfer({
    now: () => now, read: (e) => side === 0 && e === ref ? bytes : null,
    cached: (h) => cached.get(h) ?? null,
    save: async (h, b) => {
      expect(b).toEqual(Buffer.from(bytes));
      const url = `lolping://emotes/${h}.video`; cached.set(h, url); return url;
    },
    send: (_peer, body) => { wire.push({ side, body }); return true; },
    ready: (peer, h, url) => ready.push(`${peer}:${h}:${url}`),
    failed: () => undefined,
  }));
  const pump = () => {
    while (wire.length) {
      const { side, body } = wire.shift()!;
      if (body.t === 'vchunk' && body.i === drop) { drop = -1; continue; }
      if (body.t === 'vwant') peers[1 - side].want({ ...body, peer: String(side) } as never);
      else peers[1 - side].chunk({ ...body, peer: String(side) } as never);
    }
  };
  peers[1].request('0', ref, video);
  for (let i = 0; i < 60 && !ready.length; i++) {
    pump(); now += 1000; peers.forEach((p) => p.tick()); await Promise.resolve(); await Promise.resolve();
  }
  pump(); await Promise.resolve(); await Promise.resolve();
  return { peers, ready, video, cached, wire };
}

describe('RoomVideoTransfer', () => {
  it('rejects a corrupted video before saving it', () => {
    const save = vi.fn(async () => 'url'); const failed = vi.fn();
    const bytes = Uint8Array.from([1, 2, 3]); const h = hash(bytes);
    const p = new RoomVideoTransfer({ now: () => 0, read: () => null, cached: () => null, save,
      send: () => true, ready: () => undefined, failed });
    p.request('peer', ref, { h, size: bytes.length });
    p.chunk({ t: 'vchunk', peer: 'peer', seq: 1, ts: 0, h, i: 0, n: 1, b: Buffer.from([9, 2, 3]).toString('base64') });
    expect(save).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledWith('peer', h);
  });
  it('ignores native validation completing after the transfer was cancelled', async () => {
    let finish!: (url: string) => void; const ready = vi.fn();
    const bytes = Uint8Array.from([1, 2, 3]); const h = hash(bytes);
    const p = new RoomVideoTransfer({ now: () => 0, read: () => null, cached: () => null,
      save: () => new Promise((r) => { finish = r; }), send: () => true, ready, failed: () => undefined });
    p.request('peer', ref, { h, size: bytes.length });
    p.chunk({ t: 'vchunk', peer: 'peer', seq: 1, ts: 0, h, i: 0, n: 1, b: Buffer.from(bytes).toString('base64') });
    p.clear(); finish('url'); await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
  });
  it('restarts with smaller chunks when the route changes to LAN', () => {
    let c = 24_000;
    const sent: { t: string; c?: number }[] = [];
    const p = new RoomVideoTransfer({ now: () => 0, chunkBytes: () => c, read: () => null, cached: () => null,
      save: async () => null, send: (_peer, body) => { sent.push(body); return true; }, ready: () => undefined, failed: () => undefined });
    p.request('peer', ref, { h: 'b'.repeat(32), size: 100_000 });
    c = 6000; p.tick();
    expect(sent.at(-1)).toMatchObject({ t: 'vwant', c: 6000 });
  });
  it('transfers the entire original video to a peer with no local copy', async () => {
    const p = await transfer();
    expect(p.ready).toHaveLength(1);
    expect(p.cached.get(p.video.h)).toBe(`lolping://emotes/${p.video.h}.video`);
  });
  it('requests missing chunks and finishes after a dropped packet', async () => {
    expect((await transfer(1)).ready).toHaveLength(1);
  });
  it('uses the verified cache immediately when the same video is sent again', async () => {
    const p = await transfer(); p.wire.length = 0;
    expect(p.peers[1].request('0', ref, p.video)).toBe(p.cached.get(p.video.h));
    expect(p.wire).toEqual([]);
  });
});
