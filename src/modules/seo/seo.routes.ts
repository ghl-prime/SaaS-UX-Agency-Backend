import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../utils/ApiError.js';
import { validate } from '../../utils/validate.js';
import { SEO_KEYS, SEO_PAGES, SeoModel, type SeoRecord } from './seo.model.js';

const str = (max: number) => z.string().trim().max(max);
const keywords = z.array(str(60).min(1)).max(30);

const pageBody = z.object({
  title: str(120),
  description: str(320),
  keywords,
  ogTitle: str(120),
  ogDescription: str(320),
  ogImage: str(600),
  canonical: z.union([z.string().trim().url('Canonical must be a full URL (https://…)').max(600), z.literal('')]),
  noindex: z.boolean(),
});

const globalBody = z.object({
  siteName: str(80).min(1, 'Site name is required'),
  siteUrl: z.string().trim().url('Site URL must be a full URL, e.g. https://saasx.com').max(300),
  titleTemplate: str(120).refine((v) => v === '' || v.includes('%s'), 'The title template must contain %s (where the page title goes)'),
  description: str(320),
  keywords,
  ogImage: str(600),
  twitterHandle: z.union([z.string().trim().regex(/^@?\w{1,15}$/, 'Twitter/X handle looks like @saasx'), z.literal('')]),
  allowIndexing: z.boolean(),
});

type Row = SeoRecord & { updatedAt?: Date };

function serializeGlobal(r: Row | null) {
  return {
    siteName: r?.siteName ?? '',
    siteUrl: r?.siteUrl ?? '',
    titleTemplate: r?.titleTemplate ?? '',
    description: r?.description ?? '',
    keywords: r?.keywords ?? [],
    ogImage: r?.ogImage ?? '',
    twitterHandle: r?.twitterHandle ?? '',
    allowIndexing: r?.allowIndexing ?? true,
    updatedAt: r?.updatedAt ?? null,
  };
}

function serializePage(r: Row | null) {
  return {
    title: r?.title ?? '',
    description: r?.description ?? '',
    keywords: r?.keywords ?? [],
    ogTitle: r?.ogTitle ?? '',
    ogDescription: r?.ogDescription ?? '',
    ogImage: r?.ogImage ?? '',
    canonical: r?.canonical ?? '',
    noindex: r?.noindex ?? false,
    updatedAt: r?.updatedAt ?? null,
  };
}

async function loadAll() {
  const rows = await SeoModel.find().lean<Row[]>();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    global: serializeGlobal(byKey.get('global') ?? null),
    pages: Object.fromEntries(SEO_PAGES.map((p) => [p.key, serializePage(byKey.get(p.key) ?? null)])),
  };
}

/** Admin (behind requirePermission('seo')). */
export const seoRouter = Router();

seoRouter.get('/', async (_req, res) => {
  res.json({ ...(await loadAll()), pageList: SEO_PAGES.map(({ key, label, path }) => ({ key, label, path })) });
});

seoRouter.put('/:key', async (req, res) => {
  const key = req.params.key as string;
  if (!(SEO_KEYS as readonly string[]).includes(key)) throw ApiError.notFound('Unknown page');
  const body = key === 'global' ? validate(globalBody, req.body) : validate(pageBody, req.body);
  if ('twitterHandle' in body && body.twitterHandle && !body.twitterHandle.startsWith('@')) body.twitterHandle = `@${body.twitterHandle}`;
  if ('siteUrl' in body) body.siteUrl = body.siteUrl.replace(/\/+$/, '');

  const update: Record<string, unknown> = { ...body, key, updatedBy: req.admin?._id };
  const row = await SeoModel.findOneAndUpdate({ key: key as SeoRecord["key"] }, update, { upsert: true, new: true }).lean<Row>();
  res.json({ item: key === 'global' ? serializeGlobal(row) : serializePage(row) });
});

/** Public, read-only: everything the website needs to build `<head>` metadata, sitemap and robots. */
export const publicSeoRouter = Router();

publicSeoRouter.get('/', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.json(await loadAll());
});
