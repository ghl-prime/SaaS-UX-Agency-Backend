import { ProjectModel } from '../projects/project.model.js';
import { SeoModel } from '../seo/seo.model.js';

/**
 * Projects and SEO records reference images by URL (not by media id), so the
 * media library asks here before deleting a file and calls `rewriteContentUrls`
 * after moving one. The data set is small (tens of documents), so scanning the
 * serialised documents is simpler and safer than tracking every image field.
 */

export interface ContentUsage {
  /** Unique per place, e.g. `project:<id>`. */
  key: string;
  page: string;
  section: string;
  label: string;
  /** Admin screen where the image can be changed. */
  href: string;
}

const PAGE_LABELS: Record<string, string> = { global: 'Site-wide defaults', home: 'Home', works: 'Our Work', about: 'About Us', contact: 'Contact' };

function contains(doc: unknown, url: string): boolean {
  // URLs are stored exactly as the library serves them; JSON escaping doesn't touch `/uploads/...` paths.
  return JSON.stringify(doc).includes(`"${url}"`);
}

export async function contentUsage(urls: string[]): Promise<Map<string, ContentUsage[]>> {
  const out = new Map<string, ContentUsage[]>();
  if (!urls.length) return out;
  const [projects, seo] = await Promise.all([
    ProjectModel.find({}, { updatedBy: 0 }).lean(),
    SeoModel.find({ ogImage: { $in: urls } }, { key: 1, ogImage: 1 }).lean(),
  ]);
  const add = (url: string, u: ContentUsage) => {
    if (!out.has(url)) out.set(url, []);
    out.get(url)!.push(u);
  };
  for (const url of urls) {
    for (const p of projects) {
      if (contains(p, url)) add(url, { key: `project:${p._id}`, page: 'Case study', section: p.title, label: 'Project image', href: `/admin/projects/${p._id}` });
    }
  }
  for (const s of seo) {
    add(s.ogImage, { key: `seo:${s.key}`, page: 'SEO', section: PAGE_LABELS[s.key] ?? s.key, label: 'Social share image', href: `/admin/seo?page=${s.key}` });
  }
  return out;
}

/** After a file moves folders its URL changes: point every project and SEO record at the new URL. */
export async function rewriteContentUrls(oldUrl: string, newUrl: string): Promise<number> {
  if (oldUrl === newUrl) return 0;
  let changed = 0;
  for (const p of await ProjectModel.find().lean()) {
    if (!contains(p, oldUrl)) continue;
    const { _id, ...rest } = p;
    const next = JSON.parse(JSON.stringify(rest).split(`"${oldUrl}"`).join(JSON.stringify(newUrl)));
    delete next.createdAt;
    delete next.updatedAt;
    await ProjectModel.updateOne({ _id }, { $set: next });
    changed++;
  }
  const seo = await SeoModel.updateMany({ ogImage: oldUrl }, { $set: { ogImage: newUrl } });
  return changed + seo.modifiedCount;
}
