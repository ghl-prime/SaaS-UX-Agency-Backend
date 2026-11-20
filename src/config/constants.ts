/** Cookie that carries the admin session JWT. Shared with the Next.js proxy check. */
export const AUTH_COOKIE = 'saasx_admin';

/** Public URL prefix uploaded files are served from (proxied by the Next.js app). */
export const UPLOADS_URL_PREFIX = '/uploads';

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/**
 * Folders every install starts with — one per website page, plus shared assets.
 * `slug` is stable and referenced by the admin UI (page → default upload folder).
 */
export const DEFAULT_FOLDERS = [
  { slug: 'global', name: 'Global & Brand', description: 'Logos, footer, CTA and textures shown on every page', order: 0 },
  { slug: 'home', name: 'Home', description: 'Images for the landing page', order: 1 },
  { slug: 'about', name: 'About Us', description: 'Images for the About Us page', order: 2 },
  { slug: 'works', name: 'Our Work', description: 'Project cards on the Our Work page', order: 3 },
  { slug: 'projects', name: 'Project Case Studies', description: 'Images for individual case-study pages', order: 4 },
  { slug: 'contact', name: 'Contact', description: 'Images for the Contact page', order: 5 },
] as const;
