import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * An admin override for one image slot on the website.
 *
 * Slots themselves (keys, labels, default images) are defined in code by the
 * frontend registry, because they map 1:1 to components. Only replacements are
 * stored here; a slot with no document renders its built-in default image.
 */
const pageImageSchema = new Schema(
  {
    /** Stable slot key from the frontend registry, e.g. `home.hero.tile-01`. */
    key: { type: String, required: true, unique: true, trim: true },
    /** Denormalised labels, so the API can report overrides without the registry. */
    page: { type: String, required: true, trim: true, index: true },
    section: { type: String, required: true, trim: true },
    label: { type: String, trim: true, default: '' },
    media: { type: Schema.Types.ObjectId, ref: 'Media', required: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true },
);

export type PageImage = InferSchemaType<typeof pageImageSchema>;
export const PageImageModel = model('PageImage', pageImageSchema);
