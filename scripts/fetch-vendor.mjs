#!/usr/bin/env node
/**
 * Downloads the AI models and the Real-ESRGAN binary into `vendor/` (gitignored).
 * Runs on `npm install`; idempotent (skips files whose SHA-256 already matches).
 * Never fails the install: offline machines just lose the image/tracking tools.
 *
 *   SKIP_VENDOR_FETCH=1  → do nothing (Docker / web deploy, where IMAGE_TOOLS=false)
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor');

/** Pinned releases. Update the hash whenever a URL changes. */
const MODELS = [
  {
    // ISNet general-use (DIS, Apache-2.0) — background removal. Hosted by rembg.
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    dest: 'models/isnet-general-use.onnx',
  },
  {
    // YuNet 2023mar (OpenCV Zoo, MIT) — face detection, fixed 640×640 input.
    url: 'https://huggingface.co/opencv/opencv_zoo/resolve/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    dest: 'models/face_detection_yunet_2023mar.onnx',
  },
  {
    // Whisper "small" multilingual weights, GGML format (OpenAI Whisper, MIT), for automatic
    // captions. Not "base": verified side-by-side on the same clip that small's word-level
    // timestamps (from -ml 1 -sow, whisper.cpp's --dtw doesn't produce real alignment on this
    // build) are visibly tighter — base merges distinct words into one timing span; small doesn't.
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    dest: 'models/ggml-small.bin',
  },
  // Custom caption template fonts (see apps/server/src/media/captions.ts's CAPTION_FONT_FILES).
  // All OFL (SIL Open Font License) via the google/fonts repo — the only fonts a custom caption
  // template can use, since libass needs an actual bundled file, not the user's system fonts.
  {
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf',
    sha256: 'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab',
    dest: 'fonts/Anton-Regular.ttf',
  },
  {
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/BebasNeue-Regular.ttf',
    sha256: '08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73',
    dest: 'fonts/BebasNeue-Regular.ttf',
  },
  {
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf',
    sha256: '983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c',
    dest: 'fonts/Poppins-Bold.ttf',
  },
  {
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf',
    sha256: 'dd9a89a019b4849f66ab75455fe7bdf931311042cbb0f0f97acc061539703180',
    dest: 'fonts/ArchivoBlack-Regular.ttf',
  },
];

/** whisper.cpp (MIT) CLI — nightly "b" build tag, which is where prebuilt binaries are published. */
const WHISPER = {
  win32: {
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
    sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
    // Only the CLI + the DLLs it actually loads (ggml's CPU-feature dispatch keeps one per
    // microarchitecture) — not llama.dll/SDL2.dll, which belong to the other demo binaries
    // in the same archive. Zip entries are nested under "Release/"; stripped on extraction.
    keepBare: new Set([
      'whisper-cli.exe',
      'whisper.dll',
      'ggml.dll',
      'ggml-base.dll',
      'ggml-cpu-alderlake.dll',
      'ggml-cpu-cannonlake.dll',
      'ggml-cpu-cascadelake.dll',
      'ggml-cpu-haswell.dll',
      'ggml-cpu-icelake.dll',
      'ggml-cpu-sandybridge.dll',
      'ggml-cpu-skylakex.dll',
      'ggml-cpu-sse42.dll',
      'ggml-cpu-x64.dll',
    ]),
    marker: 'whisper-cli.exe',
  },
};

/** realesrgan-ncnn-vulkan (MIT) + Real-ESRGAN models (BSD-3), upstream portable release. */
const REALESRGAN = {
  win32: {
    url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip',
    sha256: 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d',
    // Only what the app needs: the exe, its OpenMP runtime and the model files.
    keep: (name) => name === 'realesrgan-ncnn-vulkan.exe' || name === 'vcomp140.dll' || name.startsWith('models/'),
    marker: 'realesrgan-ncnn-vulkan.exe',
  },
};

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function download(url, dest, label) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  let lastLogged = -1;
  const progress = new TransformStreamCounter((n) => {
    received += n;
    if (total > 0) {
      const pct = Math.floor((received / total) * 10) * 10;
      if (pct !== lastLogged) {
        lastLogged = pct;
        process.stdout.write(`  ${label}: ${pct}%\n`);
      }
    }
  });
  await pipeline(Readable.fromWeb(res.body), progress, createWriteStream(tmp));
  renameSync(tmp, dest);
}

/** Tiny pass-through stream that reports byte counts (keeps the script dependency-free). */
import { Transform } from 'node:stream';
class TransformStreamCounter extends Transform {
  constructor(onBytes) {
    super();
    this.onBytes = onBytes;
  }
  _transform(chunk, _enc, cb) {
    this.onBytes(chunk.length);
    cb(null, chunk);
  }
}

async function ensureFile({ url, sha256, dest }) {
  const target = path.join(vendor, dest);
  if (existsSync(target) && sha256Of(target) === sha256) {
    console.log(`✓ ${dest} (cached)`);
    return;
  }
  console.log(`↓ ${dest}`);
  await download(url, target, dest);
  const actual = sha256Of(target);
  if (actual !== sha256) {
    rmSync(target, { force: true });
    throw new Error(`${dest}: checksum mismatch (${actual})`);
  }
  console.log(`✓ ${dest}`);
}

async function ensureRealesrgan() {
  const entry = REALESRGAN[process.platform];
  if (!entry) {
    console.log(`– realesrgan: no prebuilt binary for ${process.platform}; upscaling will be unavailable`);
    return;
  }
  const dir = path.join(vendor, 'realesrgan');
  const stamp = path.join(dir, '.sha256');
  if (existsSync(path.join(dir, entry.marker)) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === entry.sha256) {
    console.log('✓ realesrgan (cached)');
    return;
  }
  const zipPath = path.join(vendor, 'realesrgan.zip');
  if (!existsSync(zipPath) || sha256Of(zipPath) !== entry.sha256) {
    console.log('↓ realesrgan-ncnn-vulkan');
    await download(entry.url, zipPath, 'realesrgan');
    const actual = sha256Of(zipPath);
    if (actual !== entry.sha256) {
      rmSync(zipPath, { force: true });
      throw new Error(`realesrgan: checksum mismatch (${actual})`);
    }
  }
  const { default: AdmZip } = await import('adm-zip');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'models'), { recursive: true });
  const zip = new AdmZip(zipPath);
  for (const e of zip.getEntries()) {
    const name = e.entryName.replace(/\\/g, '/');
    if (e.isDirectory || !entry.keep(name) || name.includes('..')) continue;
    writeFileSync(path.join(dir, name), e.getData());
  }
  writeFileSync(stamp, entry.sha256);
  rmSync(zipPath, { force: true });
  console.log('✓ realesrgan');
}

async function ensureWhisper() {
  const entry = WHISPER[process.platform];
  if (!entry) {
    console.log(`– whisper: no prebuilt binary for ${process.platform}; captions will be unavailable`);
    return;
  }
  const dir = path.join(vendor, 'whisper');
  const stamp = path.join(dir, '.sha256');
  if (existsSync(path.join(dir, entry.marker)) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === entry.sha256) {
    console.log('✓ whisper (cached)');
    return;
  }
  const zipPath = path.join(vendor, 'whisper.zip');
  if (!existsSync(zipPath) || sha256Of(zipPath) !== entry.sha256) {
    console.log('↓ whisper-cli');
    await download(entry.url, zipPath, 'whisper');
    const actual = sha256Of(zipPath);
    if (actual !== entry.sha256) {
      rmSync(zipPath, { force: true });
      throw new Error(`whisper: checksum mismatch (${actual})`);
    }
  }
  const { default: AdmZip } = await import('adm-zip');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zip = new AdmZip(zipPath);
  for (const e of zip.getEntries()) {
    const name = e.entryName.replace(/\\/g, '/');
    const bare = name.startsWith('Release/') ? name.slice('Release/'.length) : name;
    if (e.isDirectory || !entry.keepBare.has(bare) || bare.includes('..')) continue;
    writeFileSync(path.join(dir, bare), e.getData());
  }
  writeFileSync(stamp, entry.sha256);
  rmSync(zipPath, { force: true });
  console.log('✓ whisper');
}

async function main() {
  if (process.env.SKIP_VENDOR_FETCH === '1') {
    console.log('fetch-vendor: skipped (SKIP_VENDOR_FETCH=1)');
    return;
  }
  mkdirSync(vendor, { recursive: true });
  for (const model of MODELS) await ensureFile(model);
  await ensureRealesrgan();
  await ensureWhisper();
}

main().catch((err) => {
  console.warn(`fetch-vendor: ${err.message}`);
  console.warn('fetch-vendor: the image tools will be unavailable until `node scripts/fetch-vendor.mjs` succeeds.');
});
