import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { ensureUploadRoot } from './modules/media/media.storage.js';
import { syncSiteMedia } from './modules/media/site-media.sync.js';
import { bootstrapData } from './scripts/bootstrap.js';

async function main() {
  await connectDatabase();
  await ensureUploadRoot();
  await bootstrapData();
  const synced = await syncSiteMedia();
  if (synced.added || synced.removed) console.log(`Website images synced: ${synced.added} added, ${synced.removed} removed`);

  const server = createApp().listen(env.PORT, () => {
    console.log(`SaaX API listening on http://localhost:${env.PORT}`);
    console.log(`Uploads are written to ${env.uploadRoot}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
