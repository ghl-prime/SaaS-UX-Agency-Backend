import { Schema, Types, model, type InferSchemaType } from 'mongoose';

const mediaSchema = new Schema(
  {
    /** Name of the stored file (random, collision-free). */
    filename: { type: String, required: true },
    /** Name the file had on the uploader's machine; used for display and search. */
    originalName: { type: String, required: true, trim: true },
    /** Path relative to the upload root (frontend public/uploads), forward slashes. Mirrors the folder slug. */
    storagePath: { type: String, required: true },
    /** Public URL served by the Next.js app, e.g. `/uploads/home/hero-1a2b3c4d.webp`. */
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    /** Bytes on disk after optimisation. */
    size: { type: Number, required: true },
    /** Bytes as uploaded, before optimisation. */
    originalSize: { type: Number },
    width: Number,
    height: Number,
    title: { type: String, trim: true, maxlength: 160, default: '' },
    alt: { type: String, trim: true, maxlength: 300, default: '' },
    tags: { type: [String], default: [] },
    folder: { type: Schema.Types.ObjectId, ref: 'Folder', default: null, index: true },
    /** Original website image that ships with the site (public/uploads/<page>/<section>/...). Can be edited, not moved or deleted. */
    locked: { type: Boolean, default: false, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true },
);

mediaSchema.index({ createdAt: -1 });
mediaSchema.index({ tags: 1 });

export type Media = InferSchemaType<typeof mediaSchema> & { _id: Types.ObjectId };
export const MediaModel = model('Media', mediaSchema);
