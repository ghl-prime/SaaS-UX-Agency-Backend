import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/** Filter chips on the Our Work page. Keep in sync with the frontend `PROJECT_FILTERS`. */
export const PROJECT_FILTERS = ['SaaS & Web Apps', 'Mobile Apps', 'Websites', 'UX Research', 'Design System', 'Branding Design'] as const;

export const PROJECT_STATUSES = ['published', 'draft'] as const;

const image = new Schema(
  {
    src: { type: String, default: '' },
    alt: { type: String, default: '' },
    fit: { type: String, enum: ['cover', 'contain'], default: undefined },
    position: { type: String, default: undefined },
    background: { type: String, default: undefined },
  },
  { _id: false },
);

const point = new Schema({ title: { type: String, default: '' }, description: { type: String, default: '' } }, { _id: false });

const projectSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    status: { type: String, enum: PROJECT_STATUSES, default: 'draft', index: true },
    order: { type: Number, default: 0, index: true },
    /** Shown in the home page "Selected Work" section. */
    featured: { type: Boolean, default: false },
    /** Optional cover used only on the home page (falls back to `image`). */
    homeImage: { type: String, default: '' },
    /** Card cover on the Our Work grid. */
    image: { type: String, default: '' },
    tags: { type: [String], default: [] },
    filters: { type: [String], default: [] },
    hero: {
      badge: { type: String, default: '' },
      title: { type: String, default: 'Project Details' },
      description: { type: String, default: '' },
      meta: { type: [new Schema({ label: String, value: String }, { _id: false })], default: [] },
      image: { type: image, default: () => ({}) },
    },
    overview: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      image: { type: image, default: () => ({}) },
      gallery: { type: image, default: null },
    },
    problem: {
      title: { type: String, default: 'Problem Statement' },
      description: { type: String, default: '' },
      items: { type: [point], default: [] },
      images: { type: [image], default: () => [{}, {}] },
    },
    solution: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      items: { type: [point], default: [] },
      image: { type: image, default: () => ({}) },
    },
    process: {
      title: { type: String, default: '' },
      steps: { type: [point], default: [] },
      image: { type: image, default: () => ({}) },
    },
    related: {
      type: [new Schema({ title: String, image: String, tags: [String], href: String }, { _id: false })],
      default: [],
    },
    seo: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      keywords: { type: [String], default: [] },
      ogImage: { type: String, default: '' },
      noindex: { type: Boolean, default: false },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true, minimize: false },
);

export type ProjectRecord = InferSchemaType<typeof projectSchema> & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };
export const ProjectModel = model('Project', projectSchema);
