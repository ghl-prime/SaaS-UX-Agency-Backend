import { Schema, model, type InferSchemaType } from 'mongoose';

const folderSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 240, default: '' },
    order: { type: Number, default: 100 },
    /** Seeded page folders: can be renamed but not deleted. */
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type Folder = InferSchemaType<typeof folderSchema>;
export const FolderModel = model('Folder', folderSchema);
