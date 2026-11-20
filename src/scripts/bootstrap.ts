import { DEFAULT_FOLDERS } from '../config/constants.js';
import { env } from '../config/env.js';
import { DEFAULT_ADMIN_PERMISSIONS } from '../config/permissions.js';
import { AdminModel } from '../modules/auth/admin.model.js';
import { FolderModel } from '../modules/media/folder.model.js';
import { seedProjects } from '../modules/projects/project.seed.js';
import { ensureSeoDefaults } from '../modules/seo/seo.model.js';

/** Idempotently create the page-wise system folders. Runs on every server start. */
export async function ensureDefaultFolders(): Promise<void> {
  for (const f of DEFAULT_FOLDERS) {
    await FolderModel.updateOne(
      { slug: f.slug },
      { $setOnInsert: { name: f.name, description: f.description, order: f.order }, $set: { isSystem: true } },
      { upsert: true },
    );
  }
}

/** Old roles `owner`/`editor` → `developer`/`admin`; accounts from before statuses existed are active. */
export async function migrateAdminRoles(): Promise<void> {
  const col = AdminModel.collection;
  await col.updateMany({ role: 'owner' }, { $set: { role: 'developer', permissions: [] } });
  await col.updateMany({ role: 'editor' }, { $set: { role: 'admin', permissions: DEFAULT_ADMIN_PERMISSIONS } });
  await col.updateMany({ status: { $exists: false } }, { $set: { status: 'active', sessionVersion: 0 } });
}

/** Everything the app needs in the database before serving. Safe to run on every start. */
export async function bootstrapData(): Promise<void> {
  await ensureDefaultFolders();
  await migrateAdminRoles();
  await ensureSeoDefaults();
  const { imported } = await seedProjects();
  if (imported) console.log(`Imported ${imported} projects into MongoDB`);
}

/** Create the developer account from ADMIN_EMAIL / ADMIN_PASSWORD, or reset that account's password. */
export async function ensureAdminUser(): Promise<'created' | 'updated' | 'skipped'> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return 'skipped';
  const passwordHash = await AdminModel.hashPassword(env.ADMIN_PASSWORD);
  const existing = await AdminModel.findOne({ email: env.ADMIN_EMAIL.trim().toLowerCase() });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.status = 'active';
    existing.sessionVersion = (existing.sessionVersion ?? 0) + 1;
    await existing.save();
    return 'updated';
  }
  await AdminModel.create({ email: env.ADMIN_EMAIL.trim(), name: env.ADMIN_NAME, passwordHash, role: 'developer', status: 'active' });
  return 'created';
}
