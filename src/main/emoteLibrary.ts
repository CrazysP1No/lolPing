import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ANIM_MAX_BYTES, ANIM_MAX_SIDE, CUSTOM_NAME_MAX, MAX_CUSTOM_EMOTES, STILL_MAX_BYTES, STILL_SIDE, VIDEO_MAX_BYTES, customHash,
  isCustomRef, type CustomEmote, type EmoteFile, type EmoteRef, type ImportError,
} from '../shared/emotes';
import { gifExtent, isAnimatedWebp, sniffImage, sniffVideo, webpSize } from '../shared/imageSniff';
import { sanitizeName } from '../shared/roomProtocol';
import { isFile } from './fileState';
import { renameWithRetry } from './settingsStore';
import { checkVideo } from './videoValidation';

export { resolveEmoteArt } from '../shared/emotes';

export type SaveResult = { ok: true; emote: CustomEmote } | { ok: false; error: ImportError };

const fail = (error: ImportError): SaveResult => ({ ok: false, error });
const longest = (size: { width: number; height: number }): number => Math.max(size.width, size.height);

/** An import as it arrived over IPC, rebuilt from its known fields: a string name and byte arrays. Null for anything else. */
export function emoteFileFrom(raw: unknown): EmoteFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, still, anim, video } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || !(still instanceof Uint8Array)) return null;
  if (video !== undefined) return anim === undefined && video instanceof Uint8Array ? { name, still, video } : null;
  if (anim === undefined) return { name, still };
  return anim instanceof Uint8Array ? { name, still, anim } : null;
}

/** The still the settings window encoded: a still WebP of at most STILL_MAX_BYTES and STILL_SIDE px. */
export function checkStill(b: Uint8Array): ImportError | null {
  if (sniffImage(b) !== 'webp' || isAnimatedWebp(b)) return 'type'; // the still is served as an <img> on every overlay: it must not move
  if (b.length > STILL_MAX_BYTES) return 'size';
  const size = webpSize(b);
  return size && longest(size) <= STILL_SIDE ? null : 'type';
}

/** The original animation: a GIF or WebP, small enough to decode on every emote. */
function checkAnim(b: Uint8Array): ImportError | null {
  const type = sniffImage(b);
  if (type !== 'gif' && type !== 'webp') return 'type';
  if (b.length > ANIM_MAX_BYTES) return 'animSize';
  const size = type === 'gif' ? gifExtent(b) : webpSize(b);
  if (!size) return 'type';
  return longest(size) > ANIM_MAX_SIDE ? 'animSize' : null;
}

/**
 * Imported emotes on disk: `<hash>.webp` plus an optional `.anim.gif|webp` or `.video.mp4|webm` in `dir`.
 * Everything that arrives is checked again here, whatever the settings window already checked, and the id is computed here.
 */
export class EmoteLibrary {
  /** `dir` is <settings folder>/emotes. */
  constructor(readonly dir: string, private readonly validateVideo: (bytes: Uint8Array) => Promise<ImportError | null> = checkVideo) {}

  /** Only a validated, bounded still is shared; original animations never leave this computer. */
  readStill(hash: string): Uint8Array | null {
    if (!/^[0-9a-f]{32}$/.test(hash)) return null;
    try {
      const file = join(this.dir, `${hash}.webp`);
      if (statSync(file).size > STILL_MAX_BYTES) return null;
      const bytes = readFileSync(file);
      return checkStill(bytes) === null ? bytes : null;
    } catch {
      return null;
    }
  }

  async save(file: EmoteFile, existing: readonly CustomEmote[]): Promise<SaveResult> {
    const f = emoteFileFrom(file);
    if (!f) return fail('type');
    const videoType = f.video ? sniffVideo(f.video) : null;
    const error = checkStill(f.still) ?? (f.anim ? checkAnim(f.anim) : null);
    if (error) return fail(error);
    if (f.video && !videoType) return fail('type');
    if (f.video && f.video.length > VIDEO_MAX_BYTES) return fail('videoSize');
    const hash = createHash('sha256').update(f.still).digest('hex').slice(0, 32);
    const id = `c:${hash}`;
    if (existing.some((c) => c.id === id)) return fail('duplicate');
    if (existing.length >= MAX_CUSTOM_EMOTES) return fail('full');
    if (f.video) {
      const videoError = await this.validateVideo(f.video);
      if (videoError) return fail(videoError);
    }

    const animName = f.anim ? `${hash}.anim.${sniffImage(f.anim)}` : null;
    const videoName = videoType ? `${hash}.video.${videoType}` : null;
    const files = [{ name: `${hash}.webp`, data: f.still }, ...(f.anim && animName ? [{ name: animName, data: f.anim }] : []),
      ...(f.video && videoName ? [{ name: videoName, data: f.video }] : [])];
    // Files left by an earlier copy of this image: an animation in the other format would be served instead of this one.
    const stale = [`${hash}.anim.gif`, `${hash}.anim.webp`, `${hash}.video.mp4`, `${hash}.video.webm`].filter((n) => n !== animName && n !== videoName);
    try {
      await this.write(files, stale);
    } catch (err) {
      console.warn('[emotes] import failed:', (err as Error).message);
      return fail('disk');
    }
    // A name with nothing left shows the first characters of its hash, as in normalizeSettings.
    const name = sanitizeName(f.name.slice(0, 256), hash.slice(0, 6), CUSTOM_NAME_MAX);
    return { ok: true, emote: { id, name, animated: f.anim !== undefined || f.video !== undefined, ...(f.video ? { video: true } : {}) } };
  }

  /** Deletes an emote's files. Best effort: a file that can't be deleted is only an orphan, which a later import overwrites. */
  async remove(id: EmoteRef): Promise<void> {
    if (!isCustomRef(id)) return;
    const hash = customHash(id);
    await Promise.all([`${hash}.webp`, `${hash}.anim.gif`, `${hash}.anim.webp`, `${hash}.video.mp4`, `${hash}.video.webm`].map((n) =>
      rm(join(this.dir, n), { force: true }).catch((err: Error) => console.warn('[emotes] could not delete', n, err.message))));
  }

  /**
   * The entries whose still exists (run at launch, before anything reads them). When the folder can't be read at all (no
   * permission, say) nothing is known about its files, so the entries stay rather than the user's list being emptied.
   */
  present(list: readonly CustomEmote[]): CustomEmote[] {
    return list.filter((c) => isCustomRef(c.id) && isFile(join(this.dir, `${customHash(c.id)}.webp`), true));
  }

  /** Every file goes to a temp name first, then all are renamed. On any failure none of them is left behind. */
  private async write(files: readonly { name: string; data: Uint8Array }[], stale: readonly string[]): Promise<void> {
    const paths = files.map((f) => join(this.dir, f.name));
    const temps = paths.map((p) => `${p}.tmp`);
    try {
      await mkdir(this.dir, { recursive: true });
      for (const n of stale) await rm(join(this.dir, n), { force: true });
      for (let i = 0; i < files.length; i++) await writeFile(temps[i], files[i].data);
      for (let i = 0; i < files.length; i++) await renameWithRetry(temps[i], paths[i]);
    } catch (err) {
      await Promise.all([...temps, ...paths].map((p) => rm(p, { force: true }).catch(() => undefined)));
      throw err;
    }
  }
}
