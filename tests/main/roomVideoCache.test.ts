import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { customVideoUrl, VIDEO_MAX_BYTES } from '../../src/shared/emotes';
import { RoomVideoCache } from '../../src/main/roomVideoCache';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const padded = (head: number[], total: number, fill = 7): Uint8Array => {
  const bytes = new Uint8Array(Math.max(total, head.length)).fill(fill);
  bytes.set(head);
  return bytes;
};
const mp4 = (size = 1000, fill = 7): Uint8Array => padded([0, 0, 0, 24, ...ascii('ftypisom'), 0, 0, 0, 0, ...ascii('isommp42')], size, fill);
const webm = (fill = 7): Uint8Array => padded([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, ...ascii('webm')], 1000, fill);
const hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 32);
const tempDir = (): string => mkdtempSync(join(tmpdir(), 'lolping-room-video-'));
const names = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);
const accepts = async (): Promise<null> => null;

describe('RoomVideoCache', () => {
  it('cleans only strict cache names on startup', () => {
    const dir = tempDir();
    const hash = '0123456789abcdef'.repeat(2);
    const keep = ['not-a-hash.video.mp4', `${hash.toUpperCase()}.video.webm`, `${hash}.video.mov`, 'other.tmp'];
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, `${hash}.video.mp4`), mp4());
    writeFileSync(join(dir, `${hash}.video.webm.tmp`), webm());
    for (const name of keep) writeFileSync(join(dir, name), 'keep');
    const outside = join(dir, '..', `${hash}.video.mp4`);
    writeFileSync(outside, 'outside');

    new RoomVideoCache(dir, accepts);

    expect(names(dir)).toEqual([...keep, 'nested'].sort());
    expect(readFileSync(outside, 'utf8')).toBe('outside');
    rmSync(outside, { force: true });
  });

  it('stores validated mp4 and webm bytes under their content hashes', async () => {
    const validate = vi.fn(accepts);
    const cache = new RoomVideoCache(tempDir(), validate);
    for (const [bytes, suffix] of [[mp4(), 'mp4'], [webm(), 'webm']] as const) {
      const hash = hashOf(bytes);
      expect(await cache.put(hash, bytes)).toBe(customVideoUrl(hash));
      expect(cache.get(hash)).toBe(customVideoUrl(hash));
      expect(readFileSync(join(cache.dir, `${hash}.video.${suffix}`))).toEqual(Buffer.from(bytes));
    }
    expect(validate).toHaveBeenCalledTimes(2);
    expect(names(cache.dir)).toHaveLength(2);
  });

  it('rejects unsafe, oversized, wrong-hash and undecodable payloads without saving', async () => {
    const validate = vi.fn(async () => 'type' as const);
    const cache = new RoomVideoCache(tempDir(), validate);
    const bytes = mp4();
    const validHash = hashOf(bytes);
    const cases: Array<[string, Uint8Array]> = [
      ['bad hash', bytes],
      ['wrong container', new Uint8Array([1, 2, 3])],
      ['oversized', mp4(VIDEO_MAX_BYTES + 1)],
      ['validator failure', bytes],
    ];
    expect(await cache.put('../outside', cases[0][1])).toBeNull();
    expect(await cache.put(validHash, cases[1][1])).toBeNull();
    expect(await cache.put(validHash, cases[2][1])).toBeNull();
    expect(await cache.put(validHash, cases[3][1])).toBeNull();
    expect(cache.get(validHash)).toBeNull();
    expect(names(cache.dir)).toEqual([]);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('requires the validator to return null for success', async () => {
    const bytes = mp4();
    const hash = hashOf(bytes);
    for (const result of [undefined, false]) {
      const validate = vi.fn(async () => result as unknown as null);
      const cache = new RoomVideoCache(tempDir(), validate);
      expect(await cache.put(hash, bytes)).toBeNull();
      expect(cache.get(hash)).toBeNull();
    }
  });

  it('evicts the least recently accessed item at eight files', async () => {
    const cache = new RoomVideoCache(tempDir(), accepts);
    const videos = Array.from({ length: 9 }, (_, i) => mp4(1000, i + 1));
    const hashes = videos.map(hashOf);
    for (const [i, bytes] of videos.slice(0, 8).entries()) expect(await cache.put(hashes[i], bytes)).toBe(customVideoUrl(hashes[i]));
    expect(cache.get(hashes[0])).toBe(customVideoUrl(hashes[0]));
    expect(await cache.put(hashes[8], videos[8])).toBe(customVideoUrl(hashes[8]));
    expect(cache.get(hashes[0])).toBe(customVideoUrl(hashes[0]));
    expect(cache.get(hashes[1])).toBeNull();
    expect(names(cache.dir)).toHaveLength(8);
  });

  it('does not report success when an old file cannot be evicted', async () => {
    const cache = new RoomVideoCache(tempDir(), accepts);
    const videos = Array.from({ length: 9 }, (_, i) => mp4(1000, i + 1));
    const hashes = videos.map(hashOf);
    for (const [i, bytes] of videos.slice(0, 8).entries()) await cache.put(hashes[i], bytes);
    const oldest = join(cache.dir, `${hashes[0]}.video.mp4`);
    rmSync(oldest);
    mkdirSync(oldest);
    expect(await cache.put(hashes[8], videos[8])).toBeNull();
    expect(cache.get(hashes[8])).toBeNull();
    expect(names(cache.dir)).toHaveLength(8);
    rmSync(oldest, { recursive: true, force: true });
    writeFileSync(oldest, videos[0]);
    expect(await cache.put(hashes[8], videos[8])).toBe(customVideoUrl(hashes[8]));
    expect(names(cache.dir)).toHaveLength(8);
    rmSync(oldest, { recursive: true, force: true });
  });

  it('keeps a locked file counted after clear until a later delete succeeds', async () => {
    const cache = new RoomVideoCache(tempDir(), accepts);
    const videos = Array.from({ length: 9 }, (_, i) => mp4(1000, i + 1));
    const hashes = videos.map(hashOf);
    for (const [i, bytes] of videos.slice(0, 8).entries()) await cache.put(hashes[i], bytes);
    const locked = join(cache.dir, `${hashes[0]}.video.mp4`);
    rmSync(locked);
    mkdirSync(locked);

    cache.clear();
    expect(cache.get(hashes[0])).toBeNull();
    const fresh = Array.from({ length: 8 }, (_, i) => mp4(1000, 20 + i));
    const freshHashes = fresh.map(hashOf);
    for (const [i, bytes] of fresh.slice(0, 7).entries()) expect(await cache.put(freshHashes[i], bytes)).toBe(customVideoUrl(freshHashes[i]));
    expect(await cache.put(freshHashes[7], fresh[7])).toBeNull();
    expect(names(cache.dir)).toHaveLength(8);

    rmSync(locked, { recursive: true, force: true });
    writeFileSync(locked, videos[0]);
    expect(await cache.put(freshHashes[7], fresh[7])).toBe(customVideoUrl(freshHashes[7]));
    expect(names(cache.dir)).toHaveLength(8);
    rmSync(locked, { force: true });
  });

  it('invalidates the cache and ignores validation that finishes after clear', async () => {
    let finish!: (result: null) => void;
    const validate = vi.fn(() => new Promise<null>((resolve) => { finish = resolve; }));
    const bytes = mp4();
    const hash = hashOf(bytes);
    const cache = new RoomVideoCache(tempDir(), validate);
    const pending = cache.put(hash, bytes);
    await Promise.resolve();
    cache.clear();
    finish(null);
    expect(await pending).toBeNull();
    expect(cache.get(hash)).toBeNull();
    expect(names(cache.dir)).toEqual([]);
  });
});
