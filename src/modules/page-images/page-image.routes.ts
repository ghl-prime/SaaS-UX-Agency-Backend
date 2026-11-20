import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../../utils/ApiError.js';
import { validate } from '../../utils/validate.js';
import { MediaModel, type Media } from '../media/media.model.js';
import { serializeMedia } from '../media/media.routes.js';
import { PageImageModel } from './page-image.model.js';

/** Slot keys look like `home.hero.tile-01` or `project.voltlink.hero`. */
const slotKey = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,119}$/, 'Invalid slot key');

const replaceBody = z.object({
  mediaId: z.string().refine(isValidObjectId, 'Invalid media id'),
  page: z.string().trim().min(1).max(80),
  section: z.string().trim().min(1).max(80),
  label: z.string().trim().max(160).optional(),
});

type PopulatedOverride = {
  key: string;
  page: string;
  section: string;
  label?: string | null;
  media: (Media & { createdAt?: Date; updatedAt?: Date }) | null;
  updatedAt?: Date;
};

/** Admin endpoints (mounted behind `requireAdmin`). */
export const pageImageRouter = Router();

pageImageRouter.get('/', async (_req, res) => {
  const rows = await PageImageModel.find().populate('media').lean<PopulatedOverride[]>();
  res.json({
    items: rows
      .filter((r) => r.media)
      .map((r) => ({
        key: r.key,
        page: r.page,
        section: r.section,
        label: r.label ?? '',
        updatedAt: r.updatedAt,
        media: serializeMedia(r.media!),
      })),
  });
});

pageImageRouter.put('/:key', async (req, res) => {
  const key = validate(slotKey, req.params.key);
  const body = validate(replaceBody, req.body);

  const media = await MediaModel.findById(body.mediaId).lean<Media>();
  if (!media) throw ApiError.badRequest('Media not found');

  const row = await PageImageModel.findOneAndUpdate(
    { key },
    { key, page: body.page, section: body.section, label: body.label ?? '', media: media._id, updatedBy: req.admin?._id },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json({
    item: { key, page: row.page, section: row.section, label: row.label, updatedAt: row.updatedAt, media: serializeMedia(media) },
  });
});

/** Reset a slot to the image that ships with the website. */
pageImageRouter.delete('/:key', async (req, res) => {
  const key = validate(slotKey, req.params.key);
  await PageImageModel.deleteOne({ key });
  res.json({ ok: true, key });
});

/** Public, read-only map consumed by the website: `{ overrides: { [slotKey]: url } }`. */
export const publicPageImageRouter = Router();

publicPageImageRouter.get('/', async (_req, res) => {
  const rows = await PageImageModel.find({}, { key: 1, media: 1 })
    .populate<{ media: Pick<Media, 'url' | 'width' | 'height'> | null }>('media', { url: 1, width: 1, height: 1 })
    .lean();

  const overrides: Record<string, string> = {};
  for (const r of rows) if (r.media?.url) overrides[r.key] = r.media.url;

  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.json({ overrides });
});
