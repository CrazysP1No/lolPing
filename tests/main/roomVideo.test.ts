import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager, type RemoteEmote } from '../../src/main/roomManager';
import { open, packetLimit, type RoomKeys } from '../../src/main/roomCrypto';
import { decodeMessage } from '../../src/shared/roomProtocol';
import { makeRoomCode } from '../../src/shared/roomCode';
import { FakeTransport } from './fixtures/fakeTransport';

const keys: RoomKeys = { msgKey: Buffer.alloc(32, 1), relayTopic: 'video-test' };
const code = makeRoomCode(new Uint8Array(9).fill(1));
const ref = `c:${'a'.repeat(32)}`;
const bytes = Buffer.alloc(100_000, 7);
const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
const rooms: RoomManager[] = [];
beforeEach(() => vi.useFakeTimers({ now: 1_780_000_000_000 }));
afterEach(() => { rooms.splice(0).forEach((r) => r.quit()); vi.useRealTimers(); });

async function pair(kind: 'lan' | 'internet') {
  const transports = [new FakeTransport(kind), new FakeTransport(kind)];
  const art: RemoteEmote[] = [];
  const saved = new Map<string, string>();
  const saveVideo = vi.fn(async (h: string, b: Uint8Array) => {
    expect(b).toEqual(bytes); const url = `lolping://emotes/${h}.video`; saved.set(h, url); return url;
  });
  const peers = transports.map((t, i) => new RoomManager({
    transports: [t], now: Date.now, randomBytes: (n) => new Uint8Array(n).fill(i + 1), deriveKeys: async () => keys,
    appVersion: '0.5.2', profile: () => ({ name: `P${i}`, color: i, limit: 0 }),
    resolveTarget: () => ({ displayId: 1, width: 1200, height: 800 }), customEmotes: () => i === 0 ? [ref] : [],
    readVideo: () => i === 0 ? bytes : null, cachedVideo: (h) => i === 1 ? saved.get(h) ?? null : null,
    saveVideo: i === 1 ? saveVideo : async () => null,
  }));
  rooms.push(...peers); peers[1].on('remoteEmote', (e) => art.push(e));
  const cursors = [0, 0];
  const pump = () => {
    for (let turn = 0; turn < 100; turn++) {
      let sent = false;
      transports.forEach((t, i) => {
        while (cursors[i] < t.sent.length) {
          const p = t.sent[cursors[i]++].packet;
          expect(p.length).toBeLessThanOrEqual(packetLimit(p));
          expect(decodeMessage(open(keys.msgKey, p)!)).not.toBeNull();
          transports[1 - i].deliver(`${kind}:${i}`, p); sent = true;
        }
      });
      if (!sent) return;
    }
    throw new Error('packets did not settle');
  };
  await peers[0].join(code); await peers[1].join(code); pump();
  return { peers, transports, art, saved, saveVideo, pump };
}

describe('room video playback', () => {
  it.each(['lan', 'internet'] as const)('receives the original video over %s and resolves playable remote art', async (kind) => {
    const p = await pair(kind);
    p.peers[0].sendEmote(ref, { d: 1, x: .5, y: .5 }); p.pump();
    expect(p.art.at(-1)?.art?.kind).toBe('video-loading');
    for (let i = 0; i < 20 && !p.saved.has(hash); i++) { await vi.advanceTimersByTimeAsync(1000); p.pump(); }
    await Promise.resolve();
    expect(p.art.at(-1)).toMatchObject({ ref, art: { kind: 'video', url: `lolping://emotes/${hash}.video` } });
    expect(p.saveVideo).toHaveBeenCalledTimes(1);
    p.peers[0].sendEmote(ref, { d: 1, x: .5, y: .5 }); p.pump();
    expect(p.art.at(-1)?.art?.kind).toBe('video');
    expect(p.saveVideo).toHaveBeenCalledTimes(1);
  });
  it('does not play a video arriving after the sender has sent a different emote', async () => {
    const p = await pair('lan');
    p.peers[0].sendEmote(ref, { d: 1, x: .5, y: .5 }); p.pump();
    p.peers[0].sendEmote('facepalm', { d: 1, x: .5, y: .5 }); p.pump();
    for (let i = 0; i < 20; i++) { await vi.advanceTimersByTimeAsync(1000); p.pump(); }
    expect(p.art.at(-1)?.ref).toBe('facepalm');
    expect(p.art.filter((e) => e.art?.kind === 'video')).toEqual([]);
  });
  it('clears a playing remote video immediately when the room is muted', async () => {
    const p = await pair('lan'); const cleared: string[] = [];
    p.peers[1].on('clearEmote', (peer) => cleared.push(peer));
    p.peers[0].sendEmote(ref, { d: 1, x: .5, y: .5 }); p.pump();
    for (let i = 0; i < 20 && !p.saved.has(hash); i++) { await vi.advanceTimersByTimeAsync(1000); p.pump(); }
    await Promise.resolve(); expect(p.art.at(-1)?.art?.kind).toBe('video');
    cleared.length = 0; p.peers[1].setStatusFlags({ paused: false, roomMuted: true });
    expect(cleared).toContain(p.peers[0].self);
  });
  it('sends cancellation while paused and stops the sender before any video chunks go out', async () => {
    const p = await pair('lan');
    p.peers[0].sendEmote(ref, { d: 1, x: .5, y: .5 }); p.pump();
    p.peers[1].setStatusFlags({ paused: true, roomMuted: false }); p.pump();
    const controls = p.transports[1].sent.map((p) => decodeMessage(open(keys.msgKey, p.packet)!));
    expect(controls.some((m) => m?.t === 'vwant' && m.need === null)).toBe(true);
    for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(1000); p.pump(); }
    const sent = p.transports[0].sent.map((p) => decodeMessage(open(keys.msgKey, p.packet)!));
    expect(sent.filter((m) => m?.t === 'vchunk')).toEqual([]);
  });
});
