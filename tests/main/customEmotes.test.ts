import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager, type RemoteEmote } from '../../src/main/roomManager';
import { MAX_PACKET, open, seal, type RoomKeys } from '../../src/main/roomCrypto';
import { STILL_MAX_BYTES } from '../../src/shared/emotes';
import { makeRoomCode } from '../../src/shared/roomCode';
import { decodeMessage, encodeMessage, type RoomMessage } from '../../src/shared/roomProtocol';
import { FakeTransport } from './fixtures/fakeTransport';

const KEYS: RoomKeys = { msgKey: Buffer.alloc(32, 1), relayTopic: 'room' };
const CODE = makeRoomCode(new Uint8Array(9).fill(1));
// Same header-only WebP fixture as the library tests; the transfer must preserve every byte.
function still(size = STILL_MAX_BYTES, width = 160): Buffer {
  const b = Buffer.alloc(size, 7);
  b.write('RIFF');
  b.writeUInt32LE(size - 8, 4);
  b.write('WEBPVP8 ', 8);
  b.writeUInt32LE(size - 20, 16);
  b.set([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a], 20);
  b.writeUInt16LE(width, 26);
  b.writeUInt16LE(120, 28);
  return b;
}
const hashOf = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').slice(0, 32);
const rooms: RoomManager[] = [];
beforeEach(() => vi.useFakeTimers({ now: 1_780_000_000_000 }));
afterEach(() => {
  for (const room of rooms.splice(0)) room.quit();
  vi.useRealTimers();
});

async function pair(kind: 'lan' | 'internet', image = still(), count = 1) {
  const hash = hashOf(image);
  const ref = `c:${hash}`;
  const images = new Map<string, Buffer>(Array.from({ length: count }, (_, i) => {
    const bytes = Buffer.from(image);
    bytes[31] += i;
    return [hashOf(bytes), bytes];
  }));
  const refs = [...images.keys()].map((h) => `c:${h}`);
  const transports = [new FakeTransport(kind), new FakeTransport(kind)];
  const emotes: RemoteEmote[] = [];
  const peers = transports.map((transport, i) => {
    const room = new RoomManager({
      transports: [transport], now: Date.now,
      randomBytes: (n) => new Uint8Array(n).fill(i + 1), deriveKeys: async () => KEYS,
      appVersion: '0.5.1', profile: () => ({ name: `Peer${i}`, color: i, limit: 5 }),
      resolveTarget: () => ({ displayId: 100, width: 1920, height: 1080 }),
      customEmotes: () => i === 0 ? refs : [],
      readEmote: (h) => i === 0 ? images.get(h) ?? null : null,
    });
    rooms.push(room);
    return room;
  });
  peers[1].on('remoteEmote', (e: RemoteEmote) => emotes.push(e));
  const cursors = [0, 0];
  const pump = (drop?: (m: RoomMessage) => boolean): void => {
    for (let turns = 0; turns < 100; turns++) {
      let delivered = false;
      transports.forEach((t, i) => {
        while (cursors[i] < t.sent.length) {
          const packet = t.sent[cursors[i]++].packet;
          expect(packet.length).toBeLessThanOrEqual(MAX_PACKET);
          const message = decodeMessage(open(KEYS.msgKey, packet)!);
          expect(message).not.toBeNull();
          if (!drop?.(message!)) transports[1 - i].deliver(`${kind}:${i}`, packet);
          delivered = true;
        }
      });
      if (!delivered) return;
    }
    throw new Error('room packets did not settle');
  };
  await peers[0].join(CODE);
  await peers[1].join(CODE);
  pump();
  return { peers, transports, emotes, pump, image, hash, ref, refs };
}

describe('custom emotes in rooms', () => {
  it('can share our own images while room mute only silences what we receive', async () => {
    const p = await pair('lan');
    p.peers[0].setStatusFlags({ paused: false, roomMuted: true });
    p.peers[0].sendEmote(p.ref, { d: 1, x: 0.5, y: 0.25 });
    p.pump();
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      p.pump();
    }
    expect(p.emotes.at(-1)).toMatchObject({ ref: p.ref, art: { kind: 'custom' } });
  });

  it('fetches the same image from a healthy second owner when the first cannot provide it', async () => {
    const p = await pair('lan');
    p.peers[0].sendEmote(p.ref, { d: 1, x: 0.5, y: 0.25 });
    p.pump(); // the first owner has not sent any chunks yet
    const peer = '03'.repeat(8);
    let seq = 0;
    const deliver = (body: Record<string, unknown>): void => p.transports[1].deliver('lan:healthy', seal(KEYS.msgKey,
      encodeMessage({ peer, seq: ++seq, ts: Date.now(), ...body } as RoomMessage)));
    deliver({ t: 'presence', proto: 1, app: '0.5.1', name: 'Healthy', color: 2, status: 'on', em: [p.hash] });
    const requests = p.transports[1].sent.map((s) => decodeMessage(open(KEYS.msgKey, s.packet)!));
    expect(requests.some((m) => m?.t === 'want' && m.to === peer && m.h === p.hash)).toBe(true);
    const n = Math.ceil(p.image.length / 750);
    for (let i = 0; i < n; i++) deliver({ t: 'chunk', h: p.hash, i, n, b: p.image.subarray(i * 750, (i + 1) * 750).toString('base64') });
    expect(p.emotes.at(-1)).toMatchObject({ ref: p.ref, peer: p.peers[0].self, art: { kind: 'custom' } });
  });

  it('eventually synchronizes all nine maximum-size wheel and centre stills over relays', async () => {
    const p = await pair('internet', still(), 9);
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      p.pump();
    }
    for (const ref of p.refs) {
      p.peers[0].sendEmote(ref, { d: 1, x: 0.5, y: 0.25 });
      p.pump();
      expect(p.emotes.at(-1)).toMatchObject({ ref, art: { kind: 'custom' } });
      await vi.advanceTimersByTimeAsync(1000);
      p.pump();
    }
  });
  it.each(['lan', 'internet'] as const)('shows the sender’s image on a peer without local files over %s', async (kind) => {
    const p = await pair(kind);
    p.peers[0].sendEmote(p.ref, { d: 1, x: 0.5, y: 0.25 });
    p.pump();
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      p.pump();
    }
    expect(p.emotes.at(-1)).toMatchObject({
      ref: p.ref, x: 960, y: 270, peer: p.peers[0].self,
      art: { kind: 'custom', animated: false, url: `data:image/webp;base64,${p.image.toString('base64')}` },
    });
    p.peers[0].sendEmote(p.ref, { d: 1, x: 0.2, y: 0.3 });
    p.pump();
    expect(p.emotes.at(-1)).toMatchObject({ x: 384, y: 324, art: { kind: 'custom' } });
  });

  it('requests missing chunks after loss and still reconstructs the image', async () => {
    const p = await pair('lan');
    p.peers[0].sendEmote(p.ref, { d: 1, x: 0.5, y: 0.25 });
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      p.pump((m) => i < 2 && m.t === 'chunk' && m.i === 3);
    }
    expect(p.emotes.at(-1)).toMatchObject({ art: { kind: 'custom' } });
    const wants = p.transports[1].sent.map((s) => decodeMessage(open(KEYS.msgKey, s.packet)!)).filter((m) => m?.t === 'want');
    expect(wants.some((m) => m?.t === 'want' && m.need.includes(3))).toBe(true);
  });

  it('does not display a received still whose dimensions exceed the import limit', async () => {
    const p = await pair('lan', still(600, 161));
    p.peers[0].sendEmote(p.ref, { d: 1, x: 0.5, y: 0.25 });
    p.pump();
    await vi.advanceTimersByTimeAsync(4000);
    p.pump();
    expect(p.emotes.every((e) => e.art === undefined)).toBe(true);
  });

  it('does not process images or late display updates from a muted member', async () => {
    const p = await pair('lan');
    p.peers[0].sendEmote(p.ref, { d: 1, x: 0.5, y: 0.25 });
    p.pump();
    p.peers[1].muteMember(p.peers[0].self, true);
    const count = p.emotes.length;
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      p.pump();
    }
    expect(p.emotes).toHaveLength(count);
  });

  it('rejects corrupted bytes even when an announced hash and every chunk index look valid', async () => {
    const p = await pair('lan');
    p.peers[0].sendEmote(p.ref, { d: 1, x: 0.5, y: 0.25 });
    const corrupt = (m: RoomMessage): boolean => {
      if (m.t !== 'chunk' || m.i !== 0) return false;
      const bytes = Buffer.from(m.b, 'base64');
      bytes[bytes.length - 1] ^= 1;
      p.transports[1].deliver('lan:0', seal(KEYS.msgKey, encodeMessage({ ...m, b: bytes.toString('base64') })));
      return true;
    };
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      p.pump(corrupt);
    }
    expect(p.emotes.length).toBeGreaterThan(0);
    expect(p.emotes.every((e) => e.art === undefined)).toBe(true);
  });

  it('ignores unsolicited chunks and forged image hashes', async () => {
    const p = await pair('lan');
    const bytes = still(600);
    const packet = seal(KEYS.msgKey, encodeMessage({
      peer: p.peers[0].self, seq: 999, ts: Date.now(), t: 'chunk',
      h: 'f'.repeat(32), i: 0, n: 1, b: bytes.toString('base64'),
    } as RoomMessage));
    p.transports[1].deliver('lan:0', packet);
    expect(p.emotes).toHaveLength(0);
  });
});
