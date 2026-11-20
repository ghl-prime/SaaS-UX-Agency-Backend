import { Router } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { decodeOriginalName, imageUpload } from '../../middleware/upload.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex } from '../../utils/slugify.js';
import { validate } from '../../utils/validate.js';
import { contentUsage, rewriteContentUrls } from '../content/references.js';
import { PageImageModel } from '../page-images/page-image.model.js';
import { FolderModel } from './folder.model.js';
import { MediaModel, type Media } from './media.model.js';
import { deleteImage, moveImage, storeImage } from './media.storage.js';

export const mediaRouter = Router();

type MediaDoc = InstanceType<typeof MediaModel>;
type Usage = { key: string; page: string; section: string; label: string; href?: string };

const objectId = z.string().refine(isValidObjectId, 'Invalid id');
/** `null` / "" / "uncategorized" all mean "no folder". */
const folderRef = z
  .union([objectId, z.literal('uncategorized'), z.literal(''), z.null()])
  .transform((v) => (v && v !== 'uncategorized' ? v : null));

const listQuery = z.object({
  folder: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  type: z.enum(['all', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif']).default('all'),
  sort: z.enum(['newest', 'oldest', 'name', 'largest', 'smallest']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const SORTS: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { originalName: 1 },
  largest: { size: -1 },
  smallest: { size: 1 },
};

async function folderSlugFor(folderId: string | null): Promise<string | null> {
  if (!folderId) return null;
  const folder = await FolderModel.findById(folderId);
  if (!folder) throw ApiError.badRequest('Folder does not exist');
  return folder.slug;
}

/** Website slots, projects and SEO records currently showing each media item. */
async function usageMap(ids: Types.ObjectId[], urls: { id: Types.ObjectId; url: string }[] = []) {
  const [rows, content] = await Promise.all([
    PageImageModel.find({ media: { $in: ids } }, { key: 1, page: 1, section: 1, label: 1, media: 1 }).lean(),
    contentUsage(urls.map((u) => u.url)),
  ]);
  const map = new Map<string, Usage[]>();
  const add = (id: string, u: Usage) => {
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push(u);
  };
  for (const r of rows) add(String(r.media), { key: r.key, page: r.page, section: r.section, label: r.label ?? '' });
  for (const { id, url } of urls) for (const u of content.get(url) ?? []) add(String(id), u);
  return map;
}

const refs = (items: { _id: Types.ObjectId; url: string }[]) => items.map((i) => ({ id: i._id, url: i.url }));

type MediaLike = Media & { createdAt?: Date; updatedAt?: Date };

export function serializeMedia(m: MediaLike, usage: Usage[] = []) {
  return {
    id: String(m._id),
    url: m.url,
    filename: m.filename,
    originalName: m.originalName,
    mimeType: m.mimeType,
    size: m.size,
    originalSize: m.originalSize ?? m.size,
    width: m.width ?? null,
    height: m.height ?? null,
    title: m.title,
    alt: m.alt,
    tags: m.tags,
    folder: m.folder ? String(m.folder) : null,
    locked: Boolean(m.locked),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    usage,
  };
}

// ---------- Listing & stats ----------

mediaRouter.get('/', async (req, res) => {
  const { folder, q, type, sort, page, limit } = validate(listQuery, req.query);
  const filter: Record<string, unknown> = {};

  if (folder === 'uncategorized') filter.folder = null;
  else if (folder && folder !== 'all') {
    if (!isValidObjectId(folder)) throw ApiError.badRequest('Invalid folder');
    filter.folder = new Types.ObjectId(folder);
  }
  if (type !== 'all') filter.mimeType = type === 'svg' ? 'image/svg+xml' : `image/${type}`;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ originalName: rx }, { title: rx }, { alt: rx }, { tags: rx }];
  }

  const [items, total] = await Promise.all([
    MediaModel.find(filter).sort(SORTS[sort]).skip((page - 1) * limit).limit(limit).lean<MediaLike[]>(),
    MediaModel.countDocuments(filter),
  ]);
  const usage = await usageMap(items.map((i) => i._id), refs(items));

  res.json({
    items: items.map((m) => serializeMedia(m, usage.get(String(m._id)))),
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

mediaRouter.get('/stats', async (_req, res) => {
  const [totals] = await MediaModel.aggregate<{ count: number; size: number; originalSize: number }>([
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        size: { $sum: '$size' },
        originalSize: { $sum: { $ifNull: ['$originalSize', '$size'] } },
      },
    },
  ]);
  const byType = await MediaModel.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$mimeType', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const recent = await MediaModel.find().sort({ createdAt: -1 }).limit(8).lean<MediaLike[]>();
  const pageImageOverrides = await PageImageModel.countDocuments();

  res.json({
    count: totals?.count ?? 0,
    size: totals?.size ?? 0,
    originalSize: totals?.originalSize ?? 0,
    byType: byType.map((t) => ({ type: t._id, count: t.count })),
    recent: recent.map((m) => serializeMedia(m)),
    pageImageOverrides,
  });
});

mediaRouter.get('/:id', async (req, res) => {
  const id = validate(objectId, req.params.id);
  const media = await MediaModel.findById(id).lean<MediaLike>();
  if (!media) throw ApiError.notFound('Media not found');
  const usage = await usageMap([media._id], refs([media]));
  res.json({ item: serializeMedia(media, usage.get(id)) });
});

// ---------- Upload ----------

const uploadBody = z.object({ folder: folderRef.optional(), alt: z.string().max(300).optional() });

mediaRouter.post('/', imageUpload.array('files', 20), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw ApiError.badRequest('No files uploaded (field name: "files")');

  const { folder = null, alt } = validate(uploadBody, req.body ?? {});
  const slug = await folderSlugFor(folder);

  const created = [];
  const failed: { name: string; message: string }[] = [];
  for (const file of files) {
    const originalName = decodeOriginalName(file.originalname);
    try {
      const stored = await storeImage({ buffer: file.buffer, mimetype: file.mimetype, originalname: originalName }, slug);
      const doc = await MediaModel.create({
        ...stored,
        originalName,
        title: originalName.replace(/\.[^.]+$/, ''),
        alt: alt ?? '',
        folder,
        uploadedBy: req.admin?._id,
      });
      created.push(serializeMedia(doc.toObject() as MediaLike));
    } catch (err) {
      failed.push({ name: originalName, message: err instanceof ApiError ? err.message : 'Could not process image' });
      if (!(err instanceof ApiError)) console.error(err);
    }
  }

  if (!created.length) throw ApiError.badRequest(failed[0]?.message ?? 'Upload failed', failed);
  res.status(201).json({ items: created, failed });
});

// ---------- Update / move ----------

const updateBody = z.object({
  title: z.string().trim().max(160).optional(),
  alt: z.string().trim().max(300).optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).optional(),
  folder: folderRef.optional(),
});

/** Moving between folders also moves the file on disk, keeping public/uploads organised by page. */
async function moveTo(media: MediaDoc, folder: string | null) {
  if (String(media.folder ?? '') === String(folder ?? '')) return;
  if (media.locked) throw ApiError.badRequest('Website original images stay in their page folder');
  const loc = await moveImage(media.storagePath, await folderSlugFor(folder));
  // Projects and SEO store URLs: keep them pointing at the moved file.
  await rewriteContentUrls(media.url, loc.url);
  media.storagePath = loc.storagePath;
  media.url = loc.url;
  media.folder = folder ? new Types.ObjectId(folder) : null;
}

mediaRouter.patch('/:id', async (req, res) => {
  const id = validate(objectId, req.params.id);
  const body = validate(updateBody, req.body);
  const media = await MediaModel.findById(id);
  if (!media) throw ApiError.notFound('Media not found');

  if (body.title !== undefined) media.title = body.title;
  if (body.alt !== undefined) media.alt = body.alt;
  if (body.tags !== undefined) media.tags = [...new Set(body.tags)];
  if (body.folder !== undefined) await moveTo(media, body.folder);
  await media.save();

  const usage = await usageMap([media._id], refs([media]));
  res.json({ item: serializeMedia(media.toObject() as MediaLike, usage.get(id)) });
});

// ---------- Delete ----------

async function removeMedia(ids: string[], force: boolean) {
  if (await MediaModel.exists({ _id: { $in: ids }, locked: true })) {
    throw ApiError.badRequest('Website original images can’t be deleted. Replace them on Page Images instead.');
  }
  // Projects and SEO have no "original" to fall back to, so those must be changed first.
  const targets = await MediaModel.find({ _id: { $in: ids } }, { url: 1, originalName: 1 }).lean();
  const content = await contentUsage(targets.map((t) => t.url));
  if (content.size) {
    const places = [...new Set([...content.values()].flat().map((u) => `${u.section} (${u.page})`))];
    throw ApiError.badRequest(`Can’t delete: used in ${places.slice(0, 4).join(', ')}${places.length > 4 ? ` and ${places.length - 4} more` : ''}. Choose a different image there first.`);
  }
  const inUse = await PageImageModel.find({ media: { $in: ids } }, { key: 1, label: 1, page: 1, media: 1 }).lean();
  if (inUse.length && !force) {
    throw ApiError.conflict('Some images are used on the website. Reset those slots first, or delete anyway.', {
      usage: inUse.map((u) => ({ media: String(u.media), key: u.key, label: u.label, page: u.page })),
    });
  }
  // Slots that pointed at deleted media fall back to their default image.
  await PageImageModel.deleteMany({ media: { $in: ids } });
  const docs = await MediaModel.find({ _id: { $in: ids } });
  for (const doc of docs) await deleteImage(doc.storagePath);
  await MediaModel.deleteMany({ _id: { $in: ids } });
  return { deleted: docs.length, resetSlots: inUse.map((u) => u.key) };
}

const bulkBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move'), ids: z.array(objectId).min(1).max(200), folder: folderRef }),
  z.object({ action: z.literal('delete'), ids: z.array(objectId).min(1).max(200), force: z.boolean().default(false) }),
]);

mediaRouter.post('/bulk', async (req, res) => {
  const body = validate(bulkBody, req.body);
  if (body.action === 'delete') {
    res.json(await removeMedia(body.ids, body.force));
    return;
  }
  const docs = await MediaModel.find({ _id: { $in: body.ids } });
  const movable = docs.filter((d) => !d.locked);
  for (const doc of movable) {
    await moveTo(doc, body.folder);
    await doc.save();
  }
  res.json({ moved: movable.length, skipped: docs.length - movable.length });
});

mediaRouter.delete('/:id', async (req, res) => {
  const id = validate(objectId, req.params.id);
  const result = await removeMedia([id], req.query.force === 'true');
  if (!result.deleted) throw ApiError.notFound('Media not found');
  res.json(result);
});
