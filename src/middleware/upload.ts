import multer from 'multer';
import { ALLOWED_IMAGE_TYPES } from '../config/constants.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Uploads are held in memory just long enough to be validated and optimised by
 * `media.storage.ts`, which writes the final file into the frontend public folder.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 20 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_TYPES[file.mimetype]) cb(null, true);
    else cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`));
  },
});

/** Multer decodes multipart filenames as latin1; recover UTF-8 names. */
export function decodeOriginalName(name: string): string {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}
