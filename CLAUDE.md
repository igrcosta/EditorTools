# Editools — Development Guide

Toolbox web app for video editors. Full product spec lives in `Editools_Product_Development_Specification.md` (kept by the founder, not in this repo). Built: foundation, Media Downloader (yt-dlp, multi-platform), Converter/Audio Extractor, Fix Audio (noise removal + loudness), Trim Audio (waveform) — all four tools ship in the desktop app. Processing runs on the embedded native ffmpeg via the shared task/job layer (`media/tasks.ts` + `media/jobs.ts`), not ffmpeg.wasm; a future cloud-web version would need wasm or uploads.

## Commands

- `npm install` — installs everything, including yt-dlp and ffmpeg binaries (via `youtube-dl-exec` / `ffmpeg-static` postinstall).
- `npm run dev` — runs web (Vite, :5173) and server (Fastify, 127.0.0.1:3001) together. Vite proxies `/api` to the server.
- `npm run typecheck` — TypeScript check across all workspaces.
- `npm run build` — builds the web app.

## Architecture

- `packages/shared/src/index.ts` — API contracts (`AnalyzeResult`, `DownloadRequest`, `JobState`, formats, error codes). Both apps import `@editools/shared`. Change contracts here first.
- `apps/server/src/media/` — the shared processing layer (spec §25). `jobs.ts` owns the queue, job state, temp dirs, transparent retries and TTL cleanup; work units are `JobTask`s built in `tasks.ts` (download, convert with remux→transcode fallback, audio fix, trim); `ytdlp.ts` wraps yt-dlp, `ffmpeg.ts` wraps ffmpeg with monotonic progress, `errors.ts` maps technical errors to codes. New tools = new task in `tasks.ts` + thin route, never a parallel system.
- `apps/server/src/security/urlGuard.ts` — SSRF guard. Every user-provided URL MUST pass through `assertSafeUrl` before reaching yt-dlp.
- `apps/web/src/features/<tool>/` — one folder per tool (page + hook). Design system primitives in `apps/web/src/components/`.
- UI strings: always through i18next (`apps/web/src/i18n/locales/en/`). English only for now; structure is ready for PT-BR.

## Development rules (from spec §50 — do not violate)

1. Do not implement features outside the current phase without explicit approval. Out of scope now: converter, audio tools, accounts, subscriptions, transcription, cloud storage.
2. Working functionality over speculative abstraction.
3. Create reusable architecture only where repetition is real.
4. Every processing operation needs success, failure, loading, and cancel states.
5. Never fake functionality — disabled tools are labeled "Coming soon", progress bars never show fake numbers (`progress: null` → indeterminate UI).
6. Avoid unnecessary dependencies; prefer mature open-source tools.
7. Keep processing logic separated from UI logic.
8. UX stays simple even when the backend is complex.

## Desktop app (`apps/desktop`)

Electron shell that embeds the server: `main.ts` sets `YTDLP_PATH`/`FFMPEG_PATH`/`WEB_DIST` env vars, then dynamically imports `@editools/server/app` (`buildApp()`) and listens on a random localhost port. esbuild bundles main + server into `dist/main.cjs` (self-contained; electron external). `npm run desktop:dev` runs it; `npm run desktop:dist` builds the NSIS installer (binaries shipped via `extraResources`, exact `electronVersion` pinned in the build config). Env vars must be set BEFORE the server import — its config reads env at module load. When testing from this repo's terminal, remove `ELECTRON_RUN_AS_NODE` (inherited from VS Code) or Electron runs as plain Node.

## Deployment

Single-container Docker deploy (see `Dockerfile` + `render.yaml` for Render.com): Fastify serves the web build (`WEB_DIST`) and the API on one port, `HOST=0.0.0.0` + `TRUST_PROXY=1` inside the container only. Limits are tuned down for the free tier via env vars in `render.yaml`.

## Security invariants

- Server binds to `127.0.0.1` by default; `0.0.0.0` only inside a container behind a platform proxy (`HOST` env).
- yt-dlp/ffmpeg are always spawned with argument arrays — never build shell strings from user input.
- Files on disk use the fixed `%(id)s.%(ext)s` template inside a per-job temp dir; user-facing filenames are sanitized and only appear in `Content-Disposition`.
- No telemetry, no analytics, no third-party calls from the frontend, no URL logging at `info` level.
