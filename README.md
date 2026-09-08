# Editools

**Your editing toolbox.** A fast, practical set of tools for video editors — download media, convert files, and fix audio without leaving your workflow.

> Do the boring work faster.

## Status

Prototype — Phase 1: **Media Downloader** (URL → analyze → pick quality → MP4/MP3).

Coming next: file converter and audio tools (trim, noise removal, normalization), running fully in your browser.

## Privacy

- No accounts, no tracking, no analytics, no cookies.
- Files exist only while a job is running and are deleted afterwards.
- Future conversion/audio tools will process files locally in your browser whenever possible.

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

The desktop app is the yt-dlp-style distribution model: Editools runs entirely on the user's machine (their IP, their responsibility), which also avoids the datacenter-IP blocking that affects the hosted downloader.

```bash
npm run desktop:dev    # run the desktop app in development
npm run desktop:dist   # build the Windows installer (apps/desktop/release/)
```

The Electron main process boots the same Fastify server on a random localhost port and loads the same web UI; yt-dlp and ffmpeg are bundled as resources. "Save file" drops results into the user's Downloads folder.

Note: when launching from a terminal spawned by an Electron-based IDE (VS Code), unset `ELECTRON_RUN_AS_NODE` first or the app starts as plain Node.

## Deployment (Render.com free tier)

The repo ships a `Dockerfile` (single container: Fastify serves the API and the built web app on one port) and a `render.yaml` blueprint.

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint**, pick this repo, apply. Render reads `render.yaml` and builds the Docker image.
3. The app comes up at `https://<name>.onrender.com` (health check: `/api/health`).

Environment knobs (all optional): `HOST`, `PORT`, `WEB_DIST` (serve the web build), `TRUST_PROXY=1` (behind a proxy), `MAX_FILESIZE`, `MAX_DURATION_SECONDS`, `MAX_CONCURRENT_JOBS`, `LOG_LEVEL`.

Free-tier caveats: the instance sleeps after ~15 min idle (first request takes ~1 min), and some platforms (notably YouTube) may throttle or block datacenter IPs, so cloud downloads can occasionally fail even when the same link works locally.

### Getting past YouTube's anti-bot wall (cookies)

YouTube blocks most datacenter IPs with a "confirm you're not a bot" wall. To authenticate the hosted instance:

1. Create a **throwaway Google account** (do NOT use your personal account — automated use from a server IP can get an account flagged).
2. Log into YouTube with it in your browser, then export cookies with a "cookies.txt" extension (Netscape format), e.g. *Get cookies.txt LOCALLY*.
3. On Render: service → **Environment → Secret Files** → add a file named `cookies.txt` with that content (mounted at `/etc/secrets/cookies.txt`).
4. Add env var `COOKIES_FILE=/etc/secrets/cookies.txt` and redeploy.

Cookies are read by yt-dlp only, never logged, and never leave the server. Refresh the file when it expires (typically weeks).

## Legal note

The downloader is intended for your own content, licensed material, or editing references. Respect each platform's terms of service and applicable copyright law — that responsibility is yours.
