import fs from 'node:fs/promises';
import { env } from '../../config/env.js';
import { PageImageModel } from '../page-images/page-image.model.js';
import { ProjectModel } from './project.model.js';

/** Projects that were hard-coded in the home page "Selected Work" section, with their home-only cover defaults. */
const HOME_FEATURED: Record<string, string> = {
  'free-ai-blog': '',
  deenomics: '',
  voltlink: '/uploads/projects/voltlink/overview.png',
  tainc: '',
};

type SeedImage = { src: string; alt?: string };
type SeedProject = {
  slug: string;
  image: string;
  hero: { image: SeedImage };
  overview: { image: SeedImage; gallery?: SeedImage };
  problem: { images: SeedImage[] };
  solution: { image: SeedImage };
  process: { image: SeedImage };
  related: { image: string }[];
  [k: string]: unknown;
};

/**
 * First run only: import the case studies that used to live in
 * `Saas/src/data/project-content.json` into MongoDB, carrying over any images
 * the admin had already replaced on the Page Images screen. Afterwards projects
 * are edited in the admin (Projects) and those page-image slots are retired.
 */
export async function seedProjects(): Promise<{ imported: number }> {
  if ((await ProjectModel.estimatedDocumentCount()) > 0) return { imported: 0 };

  let data: { projects?: SeedProject[] };
  try {
    data = JSON.parse(await fs.readFile(env.projectsSeedFile, 'utf8'));
  } catch {
    console.warn(`No project seed file at ${env.projectsSeedFile}; starting with no projects`);
    return { imported: 0 };
  }
  const list = data.projects ?? [];
  if (!list.length) return { imported: 0 };

  const overrides = await PageImageModel.find({ key: { $regex: /^(project\.|home\.selected-work\.)/ } })
    .populate<{ media: { url: string } | null }>('media', { url: 1 })
    .lean();
  const url = new Map(overrides.filter((o) => o.media?.url).map((o) => [o.key, o.media!.url]));
  const pick = (key: string, fallback: string) => url.get(key) ?? fallback;

  const docs = list.map((p, order) => {
    const k = (f: string) => `project.${p.slug}.${f}`;
    const img = (f: string, i: SeedImage) => ({ ...i, alt: i.alt ?? '', src: pick(k(f), i.src) });
    const featured = p.slug in HOME_FEATURED;
    return {
      ...p,
      order,
      status: 'published',
      featured,
      homeImage: featured ? pick(`home.selected-work.${p.slug}`, HOME_FEATURED[p.slug]) : '',
      image: pick(k('card'), p.image),
      hero: { ...p.hero, image: img('hero', p.hero.image) },
      overview: { ...p.overview, image: img('overview', p.overview.image), gallery: p.overview.gallery ? img('gallery', p.overview.gallery) : null },
      problem: { ...p.problem, images: p.problem.images.map((im, i) => img(`problem-${i + 1}`, im)) },
      solution: { ...p.solution, image: img('solution', p.solution.image) },
      process: { ...p.process, image: img('process', p.process.image) },
      related: p.related.map((r, i) => ({ ...r, image: pick(k(`related-${i + 1}`), r.image) })),
    };
  });

  await ProjectModel.insertMany(docs);
  // These slots no longer exist on the Page Images screen; their images now live on the project.
  if (overrides.length) await PageImageModel.deleteMany({ _id: { $in: overrides.map((o) => o._id) } });
  return { imported: docs.length };
}
