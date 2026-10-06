# Editools

**Your editing toolbox.** A fast, practical set of tools for video editors — download media, convert files, and fix audio without leaving your workflow.

> Do the boring work faster.

## Status

A **Windows desktop app**. There is no web version of the tools: the only website is the sales landing page (`apps/landing`, a static site).

## Privacy

- Your media is processed on your own computer and is never uploaded. Temporary files exist only while a job is running and are deleted afterwards.
- An Editools account (free plan, sign-in by e-mail code, no password) is required. Only your account, plan and usage counts go to our servers.
- Usage analytics record which tools are used and whether jobs succeed — never file names, links, transcripts or media content. You can opt out in your account settings, and export or delete your data at any time.
- The renderer makes no third-party requests; the AI tools run fully offline.

## Requirements

- Node.js 20+ (npm 10+)

`yt-dlp` and `ffmpeg` binaries are downloaded automatically by `npm install` (via `youtube-dl-exec` and `ffmpeg-static`) — no manual setup.

## Development

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173
- API server: http://127.0.0.1:3001 (localhost only)

## Structure

```
apps/web        React + Vite + Tailwind SPA
apps/server     Fastify API (yt-dlp downloader)
apps/desktop    Electron shell embedding the server + web build
packages/shared TypeScript contracts shared by all
```

## Desktop app

Editools runs entirely on the user's machine (their IP, their responsibility), which also avoids the datacenter-IP blocking that hits downloaders hosted on servers.

```bash
npm run desktop:dev    # run the desktop app in development
npm run desktop:dist   # build the Windows installer (apps/desktop/release/)
```

The Electron main process boots the same Fastify server on a random localhost port and loads the same web UI; yt-dlp and ffmpeg are bundled as resources. "Save file" drops results into the user's Downloads folder.

Note: when launching from a terminal spawned by an Electron-based IDE (VS Code), unset `ELECTRON_RUN_AS_NODE` first or the app starts as plain Node.

## Getting past YouTube's anti-bot wall (cookies)

YouTube's "confirm you're not a bot" wall isn't just a datacenter-IP thing anymore — it now hits plenty of ordinary residential connections too, desktop app included. The desktop app can authenticate a request with the cookies of a browser you are already logged into:

**Desktop app** — the Downloader has a built-in "Having trouble downloading?" option that pulls cookies straight from a browser already logged into YouTube on the same machine (Chrome, Edge, Firefox, Brave), no manual export needed. Close that browser first: Chrome/Edge lock their cookie database while running, and yt-dlp can't read it until they're closed.

Cookies are read by yt-dlp only, are never logged and never leave your computer.

## Landing page (the only website)

`apps/landing` is a static site (Vite + React) that shares the app's design, fonts and demo media. It has no server and calls no API.

- `npm run dev -w @editools/landing` — local preview; `npm run build -w @editools/landing` — static files in `apps/landing/dist`.
- Build-time variables (set them in the host's dashboard, never commit secrets — none of these is secret): `VITE_DOWNLOAD_URL` (GitHub Releases link of the installer), `VITE_CHECKOUT_URL` (Kiwify checkout), `VITE_SUPPORT_EMAIL`. A button whose variable is empty shows "em breve" instead of a dead link.
- `render.yaml` declares it as a Render **Static Site** (free, always on, no server to wake up).

## Legal note

The downloader is intended for your own content, licensed material, or editing references. Respect each platform's terms of service and applicable copyright law — that responsibility is yours.
