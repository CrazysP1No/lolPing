import { createHash } from 'node:crypto';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { customVideoUrl, VIDEO_MAX_BYTES } from '../shared/emotes';
import type { ImportError } from '../shared/emotes';
import { sniffVideo } from '../shared/imageSniff';
import { renameWithRetry } from './settingsStore';
import { checkVideo } from './videoValidation';

const HASH = /^[0-9a-f]{32}$/;
const CACHE_NAME = /^[0-9a-f]{32}\.video\.(?:mp4|webm)(?:\.tmp)?$/;
const MAX_FILES = 8;
const MAX_BYTES = MAX_FILES * VIDEO_MAX_BYTES;

type VideoValidator = (bytes: Uint8Array) => Promise<ImportError | null> | ImportError | null;
type Entry = { file: string; size: number; generation: number };
type Removed = { hash: string; entry: Entry };

/** Validated room videos kept outside the user's own-emote directory. */
export class RoomVideoCache {
  private readonly entries = new Map<string, Entry>();
  private totalBytes = 0;
  private generation = 0;
  private writing: Promise<void> = Promise.resolve();

  constructor(readonly dir: string, private readonly validateVideo: VideoValidator = checkVideo) {
    this.cleanOnStart();
  }

  /** Returns a URL only for a file this instance has validated and saved. */
  get(hash: string): string | null {
    if (!HASH.test(hash)) return null;
    const entry = this.entries.get(hash);
    if (!entry) return null;
    if (entry.generation !== this.generation) return null;
    try {
      const stat = statSync(entry.file);
      if (!stat.isFile() || stat.size !== entry.size) throw new Error('cache entry changed');
    } catch {
      this.entries.delete(hash);
      this.totalBytes -= entry.size;
      return null;
    }
    this.entries.delete(hash);
    this.entries.set(hash, entry);
    return customVideoUrl(hash);
  }

  /** Validates and atomically saves one received video. Every failure becomes a cache miss. */
  put(hash: string, bytes: Uint8Array): Promise<string | null> {
    const generation = this.generation;
    const operation = this.writing.then(() => this.save(hash, bytes, generation));
    this.writing = operation.then(() => undefined, () => undefined);
    return operation.catch(() => null);
  }

  /** Invalidates this room immediately; an in-flight validation cannot repopulate it. */
  clear(): void {
    this.generation++;
    for (const [hash, entry] of [...this.entries]) {
      try {
        rmSync(entry.file, { force: true });
        this.drop({ hash, entry });
      } catch {
        // Keep failed deletions counted until a later save can remove them.
      }
    }
  }

  private async save(hash: string, bytes: Uint8Array, generation: number): Promise<string | null> {
    if (generation !== this.generation || !HASH.test(hash) || !(bytes instanceof Uint8Array) || bytes.length > VIDEO_MAX_BYTES) return null;
    const type = sniffVideo(bytes);
    if (!type || createHash('sha256').update(bytes).digest('hex').slice(0, 32) !== hash) return null;
    try {
      if ((await this.validateVideo(bytes)) !== null) return null;
    } catch {
      return null;
    }
    if (generation !== this.generation) return null;

    const target = join(this.dir, `${hash}.video.${type}`);
    const temp = `${target}.tmp`;
    const existing = this.entries.get(hash);
    let projectedCount = this.entries.size + (existing ? 0 : 1);
    let projectedBytes = this.totalBytes - (existing?.size ?? 0) + bytes.length;
    const removed: Removed[] = [];
    if (existing && (existing.file !== target || existing.generation !== generation)) removed.push({ hash, entry: existing });
    for (const [oldHash, entry] of this.entries) {
      if (oldHash === hash) continue;
      if (projectedCount <= MAX_FILES && projectedBytes <= MAX_BYTES) break;
      removed.push({ hash: oldHash, entry });
      projectedCount--;
      projectedBytes -= entry.size;
    }
    if (projectedCount > MAX_FILES || projectedBytes > MAX_BYTES) return null;

    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(temp, bytes);
      if (generation !== this.generation) {
        await rm(temp, { force: true });
        return null;
      }
      for (const item of removed) {
        await rm(item.entry.file, { force: true });
        this.drop(item);
      }
      if (generation !== this.generation) {
        await rm(temp, { force: true });
        return null;
      }
      await renameWithRetry(temp, target);
      if (generation !== this.generation) {
        await rm(target, { force: true });
        return null;
      }
      if (existing) this.drop({ hash, entry: existing });
      this.entries.set(hash, { file: target, size: bytes.length, generation });
      this.totalBytes += bytes.length;
      return customVideoUrl(hash);
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
      return null;
    }
  }

  private drop(item: Removed): void {
    if (this.entries.get(item.hash) !== item.entry) return;
    this.entries.delete(item.hash);
    this.totalBytes -= item.entry.size;
  }

  private cleanOnStart(): void {
    try {
      for (const name of readdirSync(this.dir)) {
        if (!CACHE_NAME.test(name)) continue;
        try {
          const file = join(this.dir, name);
          if (statSync(file).isFile()) rmSync(file, { force: true });
        } catch {
          // A locked entry or a directory with a cache-looking name stays untouched.
        }
      }
    } catch {
      // A missing or unreadable cache folder is empty from this instance's point of view.
    }
  }
}
