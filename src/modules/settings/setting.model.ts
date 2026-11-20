import crypto from 'node:crypto';
import { Schema, model } from 'mongoose';
import { env } from '../../config/env.js';

/** Key/value store for site-wide settings edited in the admin (e.g. `smtp`). */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true, minimize: false },
);

export const SettingModel = model('Setting', settingSchema);

export async function getSetting<T extends object>(key: string): Promise<(T & { updatedAt?: Date }) | null> {
  const doc = await SettingModel.findOne({ key }).lean();
  return doc ? ({ ...(doc.value as T), updatedAt: doc.updatedAt } as T & { updatedAt?: Date }) : null;
}

export async function putSetting(key: string, value: object, updatedBy?: unknown) {
  await SettingModel.updateOne({ key }, { $set: { value, updatedBy } }, { upsert: true });
}

// ───────── Secret encryption (AES-256-GCM) ─────────

const KEY = crypto.createHash('sha256').update(env.SETTINGS_SECRET ?? `settings:${env.JWT_SECRET}`).digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** Returns `null` if the value can't be decrypted (e.g. the secret changed). */
export function decryptSecret(stored: string | undefined | null): string | null {
  if (!stored) return null;
  try {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
