import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { CONTENT_PERMISSIONS } from './config/permissions.js';
import { permit, requireAdmin, requireDeveloper, requirePermission } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { folderRouter } from './modules/media/folder.routes.js';
import { mediaRouter } from './modules/media/media.routes.js';
import { pageImageRouter, publicPageImageRouter } from './modules/page-images/page-image.routes.js';
import { projectRouter, publicProjectRouter } from './modules/projects/project.routes.js';
import { publicSeoRouter, seoRouter } from './modules/seo/seo.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  if (!env.isProd) app.use(morgan('dev'));

  const api = Router();

  api.get('/health', (_req, res) => {
    res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
  });

  // Public (website) endpoints
  api.use('/public/page-images', publicPageImageRouter);
  api.use('/public/projects', publicProjectRouter);
  api.use('/public/seo', publicSeoRouter);

  // Auth (login, password reset, invitations, own account)
  api.use('/auth', authRouter);

  // Signed-in endpoints. Each area checks the user's permissions; developers pass every check.
  const admin = Router();
  admin.use(requireAdmin);

  // Every image picker browses and uploads to the library, so any content permission can read + upload.
  const libraryRead = (method: string, path: string) => method === 'POST' && path === '/';
  admin.use('/folders', permit({ read: CONTENT_PERMISSIONS, write: ['media'] }));
  admin.use('/folders', folderRouter);
  admin.use('/media', permit({ read: CONTENT_PERMISSIONS, write: ['media'], isRead: libraryRead }));
  admin.use('/media', mediaRouter);

  admin.use('/page-images', permit({ read: ['pageImages', 'media'], write: ['pageImages'] }));
  admin.use('/page-images', pageImageRouter);
  admin.use('/projects', requirePermission('projects'), projectRouter);
  admin.use('/seo', requirePermission('seo'), seoRouter);
  admin.use('/users', requirePermission('users'), usersRouter);
  admin.use('/settings', requireDeveloper, settingsRouter);
  api.use(admin);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
