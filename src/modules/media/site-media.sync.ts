import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ALLOWED_IMAGE_TYPES, DEFAULT_FOLDERS, UPLOADS_URL_PREFIX } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { FolderModel } from './folder.model.js';
import { MediaModel } from './media.model.js';

const EXT_TO_MIME = Object.fromEntries(Object.entries(ALLOWED_IMAGE_TYPES).map(([mime, ext]) => [`.${ext}`, mime]));
EXT_TO_MIME['.jpeg'] = 'image/jpeg';

const PAGE_FOLDERS = new Set<string>(DEFAULT_FOLDERS.map((f) => f.slug));

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** `home/hero/tile-01.png` → `Hero · Tile 01` */
function titleFor(storagePath: string): string {
  const parts = storagePath.split('/').slice(1);
  const words = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return parts.map(words).join(' · ');
}

/**
 * Registers the website's built-in images in the Media Library.
 *
 * The site's own images live in `public/uploads/<page-folder>/<section>/…`. Every
 * image file inside a page folder that has no Media record yet becomes a
 * `locked` record in that folder (editable metadata, can't be moved or deleted).
 * Locked records whose files were removed are cleaned up. Admin uploads always
 * have records already, so they're never touched. Safe to run repeatedly.
 */
export async function syncSiteMedia(): Promise<{ added: number; removed: number }> {
  const folders = new Map((await FolderModel.find({ slug: { $in: [...PAGE_FOLDERS] } }).lean()).map((f) => [f.slug, f._id]));
  const known = new Set((await MediaModel.find({}, { storagePath: 1 }).lean()).map((m) => m.storagePath));

  let added = 0;
  for (const file of await walk(env.uploadRoot)) {
    const storagePath = path.relative(env.uploadRoot, file).split(path.sep).join('/');
    const folderSlug = storagePath.split('/')[0];
    const mimeType = EXT_TO_MIME[path.extname(file).toLowerCase()];
    if (!PAGE_FOLDERS.has(folderSlug) || !mimeType || known.has(storagePath)) continue;

    const [stat, meta] = await Promise.all([fs.stat(file), sharp(file).metadata().catch(() => null)]);
    await MediaModel.create({
      filename: path.basename(file),
      originalName: path.basename(file),
      storagePath,
      url: `${UPLOADS_URL_PREFIX}/${storagePath.split('/').map(encodeURIComponent).join('/')}`,
      mimeType,
      size: stat.size,
      originalSize: stat.size,
      width: meta?.width,
      height: meta?.pageHeight ?? meta?.height,
      title: titleFor(storagePath),
      folder: folders.get(folderSlug) ?? null,
      locked: true,
    });
    added++;
  }

  let removed = 0;
  for (const m of await MediaModel.find({ locked: true }, { storagePath: 1 })) {
    const exists = await fs.access(path.join(env.uploadRoot, m.storagePath)).then(() => true, () => false);
    if (!exists) {
      await m.deleteOne();
      removed++;
    }
  }
  return { added, removed };
}
