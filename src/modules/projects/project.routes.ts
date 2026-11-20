import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../../utils/ApiError.js';
import { slugify } from '../../utils/slugify.js';
import { validate } from '../../utils/validate.js';
import { PROJECT_FILTERS, PROJECT_STATUSES, ProjectModel, type ProjectRecord } from './project.model.js';

const str = (max: number) => z.string().trim().max(max);
const url = str(600);

const image = z.object({
  src: url.default(''),
  alt: str(300).default(''),
  fit: z.enum(['cover', 'contain']).optional(),
  position: str(40).optional(),
  background: str(40).optional(),
});
const point = z.object({ title: str(160).default(''), description: str(2000).default('') });

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes only (e.g. my-project)')
  .max(80);

const projectBody = z.object({
  slug,
  title: str(200).min(1, 'Title is required'),
  status: z.enum(PROJECT_STATUSES),
  featured: z.boolean(),
  homeImage: url,
  image: url,
  tags: z.array(str(40).min(1)).max(12),
  filters: z.array(z.enum(PROJECT_FILTERS)).max(PROJECT_FILTERS.length),
  hero: z.object({
    badge: str(80),
    title: str(200),
    description: str(3000),
    meta: z.array(z.object({ label: str(60), value: str(120) })).max(8),
    image,
  }),
  overview: z.object({ title: str(200), description: str(4000), image, gallery: image.nullable() }),
  problem: z.object({ title: str(200), description: str(3000), items: z.array(point).max(12), images: z.tuple([image, image]) }),
  solution: z.object({ title: str(200), description: str(3000), items: z.array(point).max(12), image }),
  process: z.object({ title: str(200), steps: z.array(point).max(12), image }),
  related: z.array(z.object({ title: str(200), image: url, tags: z.array(str(40)).max(8), href: str(300).optional() })).max(6),
  seo: z.object({
    title: str(120),
    description: str(320),
    keywords: z.array(str(60).min(1)).max(20),
    ogImage: url,
    noindex: z.boolean(),
  }),
});

type ProjectBody = z.infer<typeof projectBody>;

/** A published case study must have every image the page renders. */
function publishIssues(p: Partial<ProjectBody>): string[] {
  const issues: string[] = [];
  if (!p.image) issues.push('Card cover image');
  if (!p.hero?.image.src) issues.push('Hero image');
  if (!p.overview?.image.src) issues.push('Overview image');
  if (!p.problem?.images[0].src || !p.problem?.images[1].src) issues.push('Both problem images');
  if (!p.solution?.image.src) issues.push('Solution image');
  if (!p.process?.image.src) issues.push('Design process image');
  return issues;
}

function assertPublishable(p: Partial<ProjectBody>) {
  if (p.status !== 'published') return;
  const missing = publishIssues(p);
  if (missing.length) throw ApiError.badRequest(`Add these before publishing: ${missing.join(', ')}. Or save as draft.`, { missing });
}

export function serializeProject(p: ProjectRecord) {
  const { _id, __v, updatedBy, ...rest } = p as ProjectRecord & { __v?: number };
  void __v;
  void updatedBy;
  return { id: String(_id), ...rest, overview: { ...rest.overview, gallery: rest.overview?.gallery?.src ? rest.overview.gallery : null } };
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || 'project';
  for (let i = 0; i < 50; i++) {
    const candidate = i ? `${root}-${i + 1}` : root;
    if (!(await ProjectModel.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

function emptyProject(title: string, slugValue: string, order: number): ProjectBody & { order: number } {
  const img = { src: '', alt: '' };
  return {
    slug: slugValue,
    title,
    order,
    status: 'draft',
    featured: false,
    homeImage: '',
    image: '',
    tags: [],
    filters: [],
    hero: { badge: '', title: 'Project Details', description: '', meta: [{ label: 'Product', value: '' }, { label: 'Category', value: '' }, { label: 'Role', value: '' }, { label: 'Duration', value: '' }], image: img },
    overview: { title, description: '', image: img, gallery: null },
    problem: { title: 'Problem Statement', description: '', items: [], images: [img, img] },
    solution: { title: '', description: '', items: [], image: img },
    process: { title: 'Design Process', steps: [], image: img },
    related: [],
    seo: { title: '', description: '', keywords: [], ogImage: '', noindex: false },
  };
}

// ───────── Admin (behind requirePermission('projects')) ─────────

export const projectRouter = Router();

projectRouter.get('/', async (_req, res) => {
  const items = await ProjectModel.find().sort({ order: 1, createdAt: 1 }).lean<ProjectRecord[]>();
  res.json({ items: items.map(serializeProject), filters: PROJECT_FILTERS });
});

projectRouter.get('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const p = await ProjectModel.findById(req.params.id).lean<ProjectRecord>();
  if (!p) throw ApiError.notFound('Project not found');
  res.json({ item: serializeProject(p), missing: publishIssues(p as unknown as ProjectBody) });
});

projectRouter.post('/', async (req, res) => {
  const body = validate(z.object({ title: str(200).min(1, 'Title is required'), slug: slug.optional() }), req.body);
  const finalSlug = body.slug ? body.slug : await uniqueSlug(body.title);
  if (await ProjectModel.exists({ slug: finalSlug })) throw ApiError.conflict('Another project already uses that URL slug');
  const last = await ProjectModel.findOne().sort({ order: -1 }).select({ order: 1 }).lean();
  const doc = await ProjectModel.create({ ...emptyProject(body.title, finalSlug, (last?.order ?? -1) + 1), updatedBy: req.admin?._id });
  res.status(201).json({ item: serializeProject(doc.toObject() as ProjectRecord) });
});

projectRouter.post('/:id/duplicate', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const src = await ProjectModel.findById(req.params.id).lean<ProjectRecord>();
  if (!src) throw ApiError.notFound('Project not found');
  const { _id, createdAt, updatedAt, ...copy } = src;
  void _id;
  void createdAt;
  void updatedAt;
  const last = await ProjectModel.findOne().sort({ order: -1 }).select({ order: 1 }).lean();
  const doc = await ProjectModel.create({
    ...copy,
    title: `${src.title} (copy)`,
    slug: await uniqueSlug(`${src.slug}-copy`),
    status: 'draft',
    featured: false,
    order: (last?.order ?? 0) + 1,
    updatedBy: req.admin?._id,
  });
  res.status(201).json({ item: serializeProject(doc.toObject() as ProjectRecord) });
});

projectRouter.put('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const body = validate(projectBody, req.body);
  assertPublishable(body);
  if (await ProjectModel.exists({ slug: body.slug, _id: { $ne: req.params.id } })) throw ApiError.conflict('Another project already uses that URL slug');

  const doc = await ProjectModel.findByIdAndUpdate(req.params.id, { ...body, updatedBy: req.admin?._id }, { new: true, runValidators: true }).lean<ProjectRecord>();
  if (!doc) throw ApiError.notFound('Project not found');
  res.json({ item: serializeProject(doc) });
});

/** Quick toggles from the list (publish/unpublish, feature on home). */
projectRouter.patch('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const body = validate(z.object({ status: z.enum(PROJECT_STATUSES).optional(), featured: z.boolean().optional() }), req.body);
  const doc = await ProjectModel.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Project not found');
  if (body.status) {
    assertPublishable({ ...(doc.toObject() as unknown as ProjectBody), status: body.status });
    doc.status = body.status;
  }
  if (body.featured !== undefined) doc.featured = body.featured;
  doc.updatedBy = req.admin?._id ?? null;
  await doc.save();
  res.json({ item: serializeProject(doc.toObject() as ProjectRecord) });
});

projectRouter.post('/reorder', async (req, res) => {
  const { ids } = validate(z.object({ ids: z.array(z.string().refine(isValidObjectId)).min(1).max(500) }), req.body);
  await ProjectModel.bulkWrite(ids.map((id, order) => ({ updateOne: { filter: { _id: id }, update: { $set: { order } } } })));
  res.json({ ok: true });
});

projectRouter.delete('/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const doc = await ProjectModel.findByIdAndDelete(req.params.id);
  if (!doc) throw ApiError.notFound('Project not found');
  res.json({ ok: true });
});

// ───────── Public (website) ─────────

export const publicProjectRouter = Router();

/** Published projects in display order, full content. */
publicProjectRouter.get('/', async (_req, res) => {
  const items = await ProjectModel.find({ status: 'published' }).sort({ order: 1, createdAt: 1 }).lean<ProjectRecord[]>();
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.json({ items: items.map(serializeProject) });
});
