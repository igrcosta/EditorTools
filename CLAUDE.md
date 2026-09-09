# Editools — Development Guide

Toolbox web app for video editors. Full product spec lives in `Editools_Product_Development_Specification.md` (kept by the founder, not in this repo). Built: foundation, Media Downloader (yt-dlp, multi-platform), Converter/Audio Extractor, Audio hub (Cut Silence & Trim, Fix Audio), Image hub (Remove Background, Upscale with before/after slider), Face Tracking (reframes a video to follow the face) — all ship in the desktop app. Processing runs on the embedded native ffmpeg via the shared task/job layer (`media/tasks.ts` + `media/jobs.ts`), not ffmpeg.wasm; a future cloud-web version would need wasm or uploads.

The AI tools (Remove Background, Upscale, Face Tracking) are **desktop-only**: they need the models in `vendor/` plus, for upscaling, a Vulkan GPU. The server reports what it can run at `GET /api/features`; the web app shows "Desktop only" otherwise, and the Docker/Render deploy sets `IMAGE_TOOLS=false`.

## Commands

- `npm install` — installs everything, including yt-dlp and ffmpeg binaries (via `youtube-dl-exec` / `ffmpeg-static` postinstall) and the AI models + Real-ESRGAN binary into `vendor/` (`scripts/fetch-vendor.mjs`, pinned URLs + SHA-256; `SKIP_VENDOR_FETCH=1` skips it, offline failures only warn).
- `npm run dev` — runs web (Vite, :5173) and server (Fastify, 127.0.0.1:3001) together. Vite proxies `/api` to the server.
- `npm run typecheck` — TypeScript check across all workspaces.
- `npm run build` — builds the web app.

## Architecture

- `packages/shared/src/index.ts` — API contracts (`AnalyzeResult`, `DownloadRequest`, `JobState`, formats, error codes). Both apps import `@editools/shared`. Change contracts here first.
- `apps/server/src/media/` — the shared processing layer (spec §25). `jobs.ts` owns the queue, job state, temp dirs, transparent retries and TTL cleanup; work units are `JobTask`s built in `tasks.ts` (download, convert with remux→transcode fallback, audio fix, cut silence, remove background, upscale, face track); `ytdlp.ts` wraps yt-dlp, `ffmpeg.ts` wraps ffmpeg (monotonic progress, raw-frame streaming, `probeMedia`), `realesrgan.ts` wraps the Real-ESRGAN ncnn-vulkan binary, `onnx.ts` lazily loads `onnxruntime-node` sessions (ISNet in `background.ts`, YuNet + crop-track math in `facetrack.ts`), `features.ts` says which of these are available, `errors.ts` maps technical errors to codes (tasks throw `EDITOOLS_*` markers for specific codes). New tools = new task in `tasks.ts` + thin route, never a parallel system. Multi-step tasks use the `pipelineTask` helper so cancel reaches the current child process.
- Pixel work goes through ffmpeg (decode to rawvideo → model → `alphamerge`/`crop`+`sendcmd`), not an image library; `onnxruntime-node` is the only ML runtime and it is imported dynamically so the web deploy never loads it.
- `apps/server/src/security/urlGuard.ts` — SSRF guard. Every user-provided URL MUST pass through `assertSafeUrl` before reaching yt-dlp.
- `apps/web/src/features/<tool>/` — one folder per tool (page + hook). Design system primitives in `apps/web/src/components/`.
- UI strings: always through i18next (`apps/web/src/i18n/locales/en/`). English only for now; structure is ready for PT-BR.

## Development rules (from spec §50 — do not violate)

1. Do not implement features outside the current phase without explicit approval. Out of scope now: accounts, subscriptions, transcription, cloud storage.
2. Working functionality over speculative abstraction.
3. Create reusable architecture only where repetition is real.
4. Every processing operation needs success, failure, loading, and cancel states.
5. Never fake functionality — disabled tools are labeled "Coming soon", progress bars never show fake numbers (`progress: null` → indeterminate UI).
6. Avoid unnecessary dependencies; prefer mature open-source tools.
7. Keep processing logic separated from UI logic.
8. UX stays simple even when the backend is complex.

## Desktop app (`apps/desktop`)

Electron shell that embeds the server: `main.ts` sets `YTDLP_PATH`/`FFMPEG_PATH`/`WEB_DIST`/`MODELS_DIR`/`REALESRGAN_PATH` env vars, then dynamically imports `@editools/server/app` (`buildApp()`) and listens on a random localhost port. esbuild bundles main + server into `dist/main.cjs` (electron and `onnxruntime-node`/`onnxruntime-common` external — native module, shipped as `resources/node_modules/*` via `extraResources` and resolved from there at runtime). `npm run desktop:dev` runs it; `npm run desktop:dist` builds the NSIS installer (yt-dlp, ffmpeg, `vendor/realesrgan` → `bin/`, `vendor/models` → `models/`; exact `electronVersion` pinned in the build config). Any new binary or model must be added to both `scripts/fetch-vendor.mjs` and `extraResources`. Env vars must be set BEFORE the server import — its config reads env at module load. When testing from this repo's terminal, remove `ELECTRON_RUN_AS_NODE` (inherited from VS Code) or Electron runs as plain Node.

## Deployment

Single-container Docker deploy (see `Dockerfile` + `render.yaml` for Render.com): Fastify serves the web build (`WEB_DIST`) and the API on one port, `HOST=0.0.0.0` + `TRUST_PROXY=1` inside the container only. Limits are tuned down for the free tier via env vars in `render.yaml`; `IMAGE_TOOLS=false` + `SKIP_VENDOR_FETCH=1` keep the AI tools (and their 250 MB of models) out of the container.

## Security invariants

- Server binds to `127.0.0.1` by default; `0.0.0.0` only inside a container behind a platform proxy (`HOST` env).
- yt-dlp/ffmpeg are always spawned with argument arrays — never build shell strings from user input.
- Files on disk use the fixed `%(id)s.%(ext)s` template inside a per-job temp dir; user-facing filenames are sanitized and only appear in `Content-Disposition`.
- No telemetry, no analytics, no third-party calls from the frontend, no URL logging at `info` level. The only network access besides yt-dlp is `scripts/fetch-vendor.mjs` at install time (pinned URLs, checksums verified); the AI tools themselves run fully offline.
- Third-party licenses of shipped binaries/models are listed in `THIRD_PARTY_LICENSES.md`; do not add models with non-commercial or AGPL terms (e.g. BRIA RMBG, upscayl-ncnn).
