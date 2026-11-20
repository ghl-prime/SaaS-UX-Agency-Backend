import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../../utils/ApiError.js';
import { slugify } from '../../utils/slugify.js';
import { validate } from '../../utils/validate.js';
import { FolderModel } from './folder.model.js';
import { MediaModel } from './media.model.js';
import { UNCATEGORIZED_DIR, moveImage } from './media.storage.js';

export const folderRouter = Router();

const RESERVED = new Set([UNCATEGORIZED_DIR, 'all', 'images', 'videos']);

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
});
const updateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).optional(),
  order: z.number().int().optional(),
});

type FolderLike = { _id: unknown; name: string; slug: string; description?: string | null; order: number; isSystem: boolean };

function serializeFolder(f: FolderLike, count = 0) {
  return {
    id: String(f._id),
    name: f.name,
    slug: f.slug,
    description: f.description ?? '',
    order: f.order,
    isSystem: f.isSystem,
    count,
  };
}

folderRouter.get('/', async (_req, res) => {
  const [folders, counts, total] = await Promise.all([
    FolderModel.find().sort({ order: 1, name: 1 }).lean(),
    MediaModel.aggregate<{ _id: unknown; count: number }>([{ $group: { _id: '$folder', count: { $sum: 1 } } }]),
    MediaModel.countDocuments(),
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json({
    total,
    uncategorized: countOf.get('null') ?? 0,
    items: folders.map((f) => serializeFolder(f, countOf.get(String(f._id)) ?? 0)),
  });
});

folderRouter.post('/', async (req, res) => {
  const { name, description } = validate(createBody, req.body);
  const slug = slugify(name);
  if (!slug || RESERVED.has(slug)) throw ApiError.badRequest('Choose a different folder name');
  if (await FolderModel.exists({ slug })) throw ApiError.conflict('A folder with that name already exists');

  const folder = await FolderModel.create({ name, slug, description: description ?? '' });
  res.status(201).json({ item: serializeFolder(folder) });
});

/** Renaming keeps the slug (and therefore file locations and URLs) stable. */
folderRouter.patch('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const body = validate(updateBody, req.body);
  const folder = await FolderModel.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!folder) throw ApiError.notFound('Folder not found');
  res.json({ item: serializeFolder(folder, await MediaModel.countDocuments({ folder: folder._id })) });
});

/** Deleting a folder keeps its images: they move to Uncategorized. */
folderRouter.delete('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const folder = await FolderModel.findById(req.params.id);
  if (!folder) throw ApiError.notFound('Folder not found');
  if (folder.isSystem) throw ApiError.badRequest('Page folders cannot be deleted');

  const media = await MediaModel.find({ folder: folder._id });
  for (const m of media) {
    const loc = await moveImage(m.storagePath, null);
    m.storagePath = loc.storagePath;
    m.url = loc.url;
    m.folder = null;
    await m.save();
  }
  await folder.deleteOne();
  res.json({ ok: true, moved: media.length });
});
