import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt } from 'node:crypto';

/** Every room packet: format byte, nonce, AES-256-GCM ciphertext and tag. Larger packets are never sent or read. */
export const MAX_PACKET = 1200;
export const MAX_VIDEO_PACKET = 32768;
const FORMAT = 0x01;
const VIDEO_FORMAT = 0x02;
const NONCE = 12;
const TAG = 16;
const OVERHEAD = 1 + NONCE + TAG;
const AAD = Buffer.from([FORMAT]);
const VIDEO_AAD = Buffer.from([VIDEO_FORMAT]);

export interface RoomKeys {
  /** Encrypts every room message. Never leaves the main process. */
  msgKey: Buffer;
  /** The relay topic: 64 hex characters that say nothing without the code. */
  relayTopic: string;
}

/** Room code → keys. scrypt makes guessing a code from a relay topic impractical; HKDF gives each key one job. */
export function deriveRoomKeys(canonical: string): Promise<RoomKeys> {
  return new Promise((resolve, reject) => {
    scrypt(canonical, 'lolping/room/v1', 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, master) => {
      if (err) return reject(err);
      const sub = (info: string): Buffer => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
      // "sig-room" dates from a WebRTC design; kept so the keys, and the test vectors, stay the same.
      resolve({ msgKey: sub('msg'), relayTopic: sub('sig-room').toString('hex') });
    });
  });
}

export function seal(key: Buffer, plain: Uint8Array): Buffer {
  return sealFormat(key, plain, FORMAT, MAX_PACKET, 'room message too large');
}

export function sealVideo(key: Buffer, plain: Uint8Array): Buffer {
  return sealFormat(key, plain, VIDEO_FORMAT, MAX_VIDEO_PACKET, 'room video too large');
}

function sealFormat(key: Buffer, plain: Uint8Array, format: number, limit: number, error: string): Buffer {
  if (plain.length + OVERHEAD > limit) throw new Error(error);
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(format === VIDEO_FORMAT ? VIDEO_AAD : AAD);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([format]), nonce, body, cipher.getAuthTag()]);
}

export function packetLimit(packet: Uint8Array): number {
  return packet[0] === VIDEO_FORMAT ? MAX_VIDEO_PACKET : MAX_PACKET;
}

/** The plaintext, or null for anything that isn't a packet sealed with this key. */
export function open(key: Buffer, packet: Uint8Array): Buffer | null {
  const format = packet[0];
  if (packet.length < OVERHEAD || packet.length > packetLimit(packet) || (format !== FORMAT && format !== VIDEO_FORMAT)) return null;
  const buf = Buffer.from(packet.buffer, packet.byteOffset, packet.length);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 1 + NONCE));
    decipher.setAAD(format === VIDEO_FORMAT ? VIDEO_AAD : AAD);
    decipher.setAuthTag(buf.subarray(buf.length - TAG));
    return Buffer.concat([decipher.update(buf.subarray(1 + NONCE, buf.length - TAG)), decipher.final()]);
  } catch {
    return null;
  }
}
