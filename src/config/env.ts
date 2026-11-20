import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/saasx'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Upload target. Defaults to the Next.js app's public folder so the frontend serves files locally. */
  UPLOAD_DIR: z.string().default('../Saas/public/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  /** Longest edge (px) an optimised raster image keeps. 3840 = 4K. */
  MAX_IMAGE_DIMENSION: z.coerce.number().int().positive().default(3840),
  /** WebP quality for optimised uploads. */
  IMAGE_QUALITY: z.coerce.number().int().min(1).max(100).default(90),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().default('SaaX Admin'),
  /** Optional comma-separated DNS servers for mongodb+srv lookups, e.g. 1.1.1.1,8.8.8.8 */
  DNS_SERVERS: z.string().default(''),
  /** Public URL of the Next.js app. Used for links in emails (invites, password resets). */
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Encrypts the SMTP app password stored in MongoDB. Defaults to a key derived from JWT_SECRET. */
  SETTINGS_SECRET: z.string().min(16).optional(),
  /** Case-study content imported into MongoDB the first time the server starts with no projects. */
  PROJECTS_SEED_FILE: z.string().default('../Saas/src/data/project-content.json'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  uploadRoot: path.resolve(process.cwd(), raw.UPLOAD_DIR),
  dnsServers: raw.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean),
  maxUploadBytes: Math.round(raw.MAX_UPLOAD_MB * 1024 * 1024),
  appUrl: raw.APP_URL.replace(/\/+$/, ''),
  projectsSeedFile: path.resolve(process.cwd(), raw.PROJECTS_SEED_FILE),
};
