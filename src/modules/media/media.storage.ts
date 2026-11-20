import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { UPLOADS_URL_PREFIX } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { slugify } from '../../utils/slugify.js';

/** Library items without a folder are stored under this directory. */
export const UNCATEGORIZED_DIR = 'uncategorized';

/** Raster formats re-encoded to WebP. GIF (animation) and SVG (vector) are stored untouched. */
const OPTIMISABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export interface StoredImage {
  filename: string;
  storagePath: string;
  url: string;
  mimeType: string;
  size: number;
  originalSize: number;
  width?: number;
  height?: number;
}

function folderDir(folderSlug: string | null): string {
  return folderSlug || UNCATEGORIZED_DIR;
}

function toUrl(storagePath: string): string {
  return `${UPLOADS_URL_PREFIX}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
}

function absolute(storagePath: string): string {
  const full = path.resolve(env.uploadRoot, storagePath);
  // Never touch anything outside the upload root.
  if (!full.startsWith(env.uploadRoot + path.sep)) throw ApiError.badRequest('Invalid storage path');
  return full;
}

function baseName(originalName: string): string {
  return slugify(path.parse(originalName).name) || 'image';
}

/**
 * Validate and optimise an uploaded image, then write it to
 * `<UPLOAD_DIR>/<folder-slug>/<readable-name>-<random>.<ext>`.
 *
 * Raster images are auto-rotated, capped at MAX_IMAGE_DIMENSION on the longest
 * edge (never upscaled), stripped of metadata and encoded as high-quality WebP.
 * If re-encoding would make the file larger, the original bytes are kept.
 */
export async function storeImage(
  file: { buffer: Buffer; mimetype: string; originalname: string },
  folderSlug: string | null,
): Promise<StoredImage> {
  let data = file.buffer;
  let mimeType = file.mimetype;
  let width: number | undefined;
  let height: number | undefined;

  if (mimeType === 'image/svg+xml') {
    const text = data.toString('utf8');
    if (!/<svg[\s>]/i.test(text)) throw ApiError.badRequest(`${file.originalname} is not a valid SVG`);
    if (/<script[\s>]|\son\w+\s*=|javascript:/i.test(text)) {
      throw ApiError.badRequest(`${file.originalname} contains scripts, which are not allowed in SVG uploads`);
    }
    const meta = await sharp(data).metadata().catch(() => null);
    width = meta?.width;
    height = meta?.height;
  } else {
    let meta: Metadata;
    try {
      meta = await sharp(data, { animated: true }).metadata();
    } catch {
      throw ApiError.badRequest(`${file.originalname} is not a readable image`);
    }

    if (OPTIMISABLE.has(mimeType)) {
      const max = env.MAX_IMAGE_DIMENSION;
      const { data: out, info } = await sharp(data)
        .rotate()
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: env.IMAGE_QUALITY, effort: 5, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });

      const resized = Math.max(meta.width ?? 0, meta.height ?? 0) > max;
      if (out.length < data.length || resized) {
        data = out;
        mimeType = 'image/webp';
        width = info.width;
        height = info.height;
      }
    }
    if (width === undefined) {
      // Kept as-is: report the real displayed orientation.
      const rotated = (meta.orientation ?? 1) >= 5;
      width = rotated ? meta.height : meta.width;
      height = rotated ? meta.width : (meta.pageHeight ?? meta.height);
    }
  }

  const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' }[mimeType]!;
  const dir = folderDir(folderSlug);
  const filename = `${baseName(file.originalname)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const storagePath = `${dir}/${filename}`;

  await fs.mkdir(path.join(env.uploadRoot, dir), { recursive: true });
  await fs.writeFile(absolute(storagePath), data, { flag: 'wx' });

  return {
    filename,
    storagePath,
    url: toUrl(storagePath),
    mimeType,
    size: data.length,
    originalSize: file.buffer.length,
    width,
    height,
  };
}

/** Move a stored file into another folder's directory; returns the new location. */
export async function moveImage(storagePath: string, folderSlug: string | null) {
  const filename = path.posix.basename(storagePath);
  const next = `${folderDir(folderSlug)}/${filename}`;
  if (next === storagePath) return { storagePath, url: toUrl(storagePath) };

  await fs.mkdir(path.join(env.uploadRoot, folderDir(folderSlug)), { recursive: true });
  await fs.rename(absolute(storagePath), absolute(next));
  return { storagePath: next, url: toUrl(next) };
}

export async function deleteImage(storagePath: string): Promise<void> {
  await fs.rm(absolute(storagePath), { force: true });
}

export async function ensureUploadRoot(): Promise<void> {
  await fs.mkdir(env.uploadRoot, { recursive: true });
}
