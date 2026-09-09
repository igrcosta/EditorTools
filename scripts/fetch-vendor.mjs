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
];

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

async function main() {
  if (process.env.SKIP_VENDOR_FETCH === '1') {
    console.log('fetch-vendor: skipped (SKIP_VENDOR_FETCH=1)');
    return;
  }
  mkdirSync(vendor, { recursive: true });
  for (const model of MODELS) await ensureFile(model);
  await ensureRealesrgan();
}

main().catch((err) => {
  console.warn(`fetch-vendor: ${err.message}`);
  console.warn('fetch-vendor: the image tools will be unavailable until `node scripts/fetch-vendor.mjs` succeeds.');
});
