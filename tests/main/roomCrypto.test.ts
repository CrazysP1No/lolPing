import { describe, expect, it } from 'vitest';
import { deriveRoomKeys, MAX_PACKET, MAX_VIDEO_PACKET, open, packetLimit, seal, sealVideo } from '../../src/main/roomCrypto';

describe('deriveRoomKeys', () => {
  // Computed once with plain node:crypto (scrypt N=2^15 r=8 p=1, then HKDF-SHA256). Every OS must derive the same keys.
  it('matches the known-answer vectors', async () => {
    const k = await deriveRoomKeys('0000000000');
    expect(k.msgKey.toString('hex')).toBe('2b8ef59047332409e1662fe75774f9383fcd16b655fcb3db975f0e80ad2043da');
    expect(k.relayTopic).toBe('0381782f350540d4639958bed594ae3b2b1a3d11683146e542edb34db89b6910');
    expect(Object.keys(k).sort()).toEqual(['msgKey', 'relayTopic']);
  });

  it('gives different codes different keys', async () => {
    const [a, b] = await Promise.all([deriveRoomKeys('0000000000'), deriveRoomKeys('0000000011')]);
    expect(a.msgKey.equals(b.msgKey)).toBe(false);
  });
});

describe('seal / open', () => {
  const key = Buffer.alloc(32, 7);
  const msg = new TextEncoder().encode('{"t":"bye"}');
  const OVERHEAD = 1 + 12 + 16;

  it('round-trips', () => {
    expect(open(key, seal(key, msg))).toEqual(Buffer.from(msg));
  });

  it('uses a fresh nonce every time', () => {
    expect(seal(key, msg).equals(seal(key, msg))).toBe(false);
  });

  it('rejects any flipped byte', () => {
    const packet = seal(key, msg);
    for (let i = 0; i < packet.length; i++) {
      const bad = Buffer.from(packet);
      bad[i] ^= 1;
      expect(open(key, bad)).toBeNull();
    }
  });

  it('rejects a wrong key, a truncated packet and an oversize packet', () => {
    const packet = seal(key, msg);
    expect(open(Buffer.alloc(32, 8), packet)).toBeNull();
    expect(open(key, packet.subarray(0, 20))).toBeNull();
    expect(open(key, new Uint8Array(0))).toBeNull();
    expect(open(key, Buffer.concat([packet, Buffer.alloc(MAX_PACKET)]))).toBeNull();
  });

  it('refuses to seal more than fits in a packet', () => {
    expect(() => seal(key, new Uint8Array(MAX_PACKET))).toThrow();
  });

  it('round-trips a full-size video packet with its own format and limit', () => {
    const plain = new Uint8Array(MAX_VIDEO_PACKET - OVERHEAD).fill(7);
    const packet = sealVideo(key, plain);
    expect(packet[0]).toBe(0x02);
    expect(packet).toHaveLength(MAX_VIDEO_PACKET);
    expect(packetLimit(packet)).toBe(MAX_VIDEO_PACKET);
    expect(open(key, packet)).toEqual(Buffer.from(plain));
  });

  it('keeps video and control packet limits strict', () => {
    expect(packetLimit(Uint8Array.from([0x01]))).toBe(MAX_PACKET);
    expect(packetLimit(Uint8Array.from([0x02]))).toBe(MAX_VIDEO_PACKET);
    const video = sealVideo(key, new Uint8Array(MAX_PACKET));
    expect(video.length).toBeGreaterThan(MAX_PACKET);
    const mislabeled = Buffer.from(video);
    mislabeled[0] = 0x01;
    expect(open(key, mislabeled)).toBeNull();
    const smallMislabeled = Buffer.from(sealVideo(key, msg));
    smallMislabeled[0] = 0x01;
    expect(open(key, smallMislabeled)).toBeNull();
    expect(() => sealVideo(key, new Uint8Array(MAX_VIDEO_PACKET - OVERHEAD + 1))).toThrow();
  });
});
