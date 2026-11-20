import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { syncSiteMedia } from '../modules/media/site-media.sync.js';
import { bootstrapData, ensureAdminUser } from './bootstrap.js';

/** `npm run seed` — creates page folders, SEO defaults, projects and the developer account from .env. */
async function seed() {
  await connectDatabase();
  await bootstrapData();
  console.log('Page folders, SEO defaults and projects ready');

  const synced = await syncSiteMedia();
  console.log(`Website images in Media Library: ${synced.added} added, ${synced.removed} removed`);

  const result = await ensureAdminUser();
  if (result === 'skipped') console.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set, no admin account created');
  else console.log(`Developer account ${env.ADMIN_EMAIL} ${result}`);

  await disconnectDatabase();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
