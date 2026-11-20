import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * SEO for the website's fixed pages, plus site-wide defaults under key `global`.
 * Case studies keep their SEO on the project document.
 */
export const SEO_PAGES = [
  {
    key: 'home',
    label: 'Home',
    path: '/',
    defaults: {
      title: 'SaaX — Design Meets Business',
      description: 'We design intuitive digital products, clear interfaces, and consistent user journeys.',
    },
  },
  {
    key: 'works',
    label: 'Our Work',
    path: '/works',
    defaults: { title: 'Our Work — SaaX', description: 'Explore our approach to user journeys, product interfaces, and design systems.' },
  },
  {
    key: 'about',
    label: 'About Us',
    path: '/about',
    defaults: {
      title: 'About Us — SaaX',
      description: 'SaaX designs intuitive, engaging, and user-friendly digital experiences that balance user needs with business goals.',
    },
  },
  {
    key: 'contact',
    label: 'Contact',
    path: '/contact',
    defaults: {
      title: 'Contact — SaaX',
      description: 'Tell us what isn’t working or what you want to build, and we’ll prepare for a meaningful first conversation.',
    },
  },
] as const;

export const SEO_KEYS = ['global', ...SEO_PAGES.map((p) => p.key)] as const;

export const GLOBAL_SEO_DEFAULTS = {
  siteName: 'SaaX',
  siteUrl: 'http://localhost:3000',
  titleTemplate: '%s — SaaX',
  description: 'We design intuitive digital products, clear interfaces, and consistent user journeys.',
  twitterHandle: '',
  allowIndexing: true,
};

const seoSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, enum: SEO_KEYS },
    // Page fields
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    keywords: { type: [String], default: [] },
    ogTitle: { type: String, default: '' },
    ogDescription: { type: String, default: '' },
    ogImage: { type: String, default: '' },
    canonical: { type: String, default: '' },
    noindex: { type: Boolean, default: false },
    // Global-only fields
    siteName: { type: String, default: '' },
    siteUrl: { type: String, default: '' },
    titleTemplate: { type: String, default: '' },
    twitterHandle: { type: String, default: '' },
    allowIndexing: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true },
);

export type SeoRecord = InferSchemaType<typeof seoSchema>;
export const SeoModel = model('Seo', seoSchema);

/** Creates missing SEO records with the metadata the site shipped with. Never overwrites edits. */
export async function ensureSeoDefaults(): Promise<void> {
  await SeoModel.updateOne({ key: 'global' }, { $setOnInsert: { key: 'global', ...GLOBAL_SEO_DEFAULTS } }, { upsert: true });
  for (const p of SEO_PAGES) {
    await SeoModel.updateOne({ key: p.key }, { $setOnInsert: { key: p.key, ...p.defaults } }, { upsert: true });
  }
}
