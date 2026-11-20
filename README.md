# saasX-backend

API for the SaaX Admin Portal: auth & team (roles, invites, password reset), email (SMTP), **Projects**, **SEO**, the **Media Library** and **Page Image Management**.
Node.js · TypeScript · Express 5 · MongoDB/Mongoose.

**Uploaded images are stored as local files in the frontend's `Saas/public/uploads/<folder>/`**, not in
this folder. MongoDB stores only metadata (title, alt text, tags, folder, size, dimensions) and which website
image slot uses which file.

## Setup

```bash
cp .env.example .env     # then set MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run seed             # page folders, SEO defaults, projects + the developer account from .env
npm run dev              # http://localhost:5000
```

Run the frontend (`../Saas`, `npm run dev`) and sign in at <http://localhost:3000/admin>.
The frontend proxies `/api/*` to this server (set `BACKEND_URL` in the frontend env if it isn't on
`http://localhost:5000`).

`npm run seed` is safe to re-run: it resets the admin password to `ADMIN_PASSWORD`.

| Script | |
| --- | --- |
| `npm run dev` | Watch mode (tsx) |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | Type-check only |
| `npm run seed` | Page folders + admin user |

## Roles & permissions

| Role | Access |
| --- | --- |
| **Developer** | Everything, including Email (SMTP) settings and managing other developers |
| **Admin** | Only the areas granted: `projects`, `media`, `pageImages`, `seo`, `users` (team) |

Admins with `users` can invite/manage admins but can't grant access they don't have. There's always at least
one active developer. Old roles migrate automatically (`owner` → developer, `editor` → admin).

## Email

Set up in **Admin → Email (SMTP)** by a developer (Gmail: `smtp.gmail.com:465` + a Google *App Password*).
The app password is stored AES-256-GCM encrypted. Without SMTP, invites and reset links are shown in the
admin to share manually; in development, forgot-password links are also printed to the server console.

## Projects & SEO

Case studies live in MongoDB (`projects`). On first start with an empty collection they're imported from
`PROJECTS_SEED_FILE`, carrying over any project images replaced earlier on Page Images. The website reads
`/api/public/projects` and `/api/public/seo` (cached; admin edits expire the cache). Moving a library image
rewrites project/SEO URLs that use it; deleting an image a project uses is blocked.

## Image optimisation

JPEG/PNG/WebP/AVIF uploads are auto-rotated, stripped of metadata, capped at `MAX_IMAGE_DIMENSION`
(default 3840 px, 4K) on the longest edge without upscaling, and encoded as WebP at `IMAGE_QUALITY`
(default 90). If re-encoding would make a file bigger, the original is kept. SVG (scripts rejected) and GIF
(animation) are stored as-is. Next.js `<Image>` then serves responsive sizes from these files.

## Structure

```
src/
  app.ts                 Express app; mounts routers (new admin modules go behind requireAdmin)
  server.ts              DB connect, default folders, listen
  config/                env (zod-validated), db, constants (default page folders, file types)
  middleware/            auth (JWT cookie / Bearer), upload (multer), error handler
  modules/
    auth/                Admin model, login/logout/me
    media/               Folder + Media models, file storage/optimisation, routes
    page-images/         Slot overrides (slot key -> media) + public read endpoint
  scripts/               bootstrap helpers + seed
```

## API

All admin routes need the `saasx_admin` httpOnly cookie (set by login) or `Authorization: Bearer <jwt>`.

| Method | Path | |
| --- | --- | --- |
| POST | `/api/auth/login` · `/api/auth/logout` | Session |
| GET/PATCH | `/api/auth/me` | Current user (+ `mailConfigured`) / rename |
| POST | `/api/auth/me/password` | Change own password (signs out other sessions) |
| POST | `/api/auth/forgot-password` · `/api/auth/reset-password` | Email a reset link / set password with token |
| GET | `/api/auth/reset-password/:token` · `/api/auth/invite/:token` | Validate a link |
| POST | `/api/auth/invite/accept` | Accept invitation (name + password) |
| GET/POST | `/api/users` | Team list / add (`mode: "invite"` or `"password"`) — `users` |
| PATCH/DELETE | `/api/users/:id` | Role, permissions, name, activate/deactivate / remove |
| POST | `/api/users/:id/resend-invite` · `/api/users/:id/password` | New invite link / reset link or set password |
| GET/PUT | `/api/settings/smtp` · POST `/api/settings/smtp/test` | Email settings — developers only |
| GET/POST | `/api/projects` | List / create draft — `projects` |
| GET/PUT/PATCH/DELETE | `/api/projects/:id` | Get / save / toggle status·featured / delete |
| POST | `/api/projects/:id/duplicate` · `/api/projects/reorder` | Duplicate / save order |
| GET · PUT | `/api/seo` · `/api/seo/:key` | SEO for `global`, `home`, `works`, `about`, `contact` — `seo` |
| GET | `/api/public/projects` · `/api/public/seo` | Public data for the website |
| GET/POST | `/api/folders` | List (with counts) / create |
| PATCH/DELETE | `/api/folders/:id` | Rename / delete (images move to Uncategorized; page folders can't be deleted) |
| GET | `/api/media?folder=&q=&type=&sort=&page=&limit=` | Search & paginate (`folder` = id, `all`, `uncategorized`) |
| GET | `/api/media/stats` | Dashboard numbers |
| POST | `/api/media` | Upload (`multipart/form-data`: `files[]`, optional `folder`) |
| GET/PATCH/DELETE | `/api/media/:id` | Details / edit title, alt, tags, folder (moves the file) / delete (`?force=true` if in use) |
| POST | `/api/media/bulk` | `{ action: "move", ids, folder }` or `{ action: "delete", ids, force }` |
| GET | `/api/page-images` | All slot overrides with media |
| PUT/DELETE | `/api/page-images/:key` | Replace a slot (`{ mediaId, page, section, label }`) / restore the original |
| GET | `/api/public/page-images` | Public `{ overrides: { [slotKey]: url } }` used by the website |
| GET | `/api/health` | Liveness + DB state |

## Troubleshooting

- **`querySrv ECONNREFUSED` with a `mongodb+srv://` URI**: Node's DNS resolver (often a local VPN/WARP
  resolver on 127.0.0.1) refuses SRV lookups. Set `DNS_SERVERS=1.1.1.1,8.8.8.8` in `.env`.
