import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILE_DIR = path.join(ROOT, '.session');
export const DATA_DIR = path.join(ROOT, 'data');

export function drawDir(tweetId) {
  const dir = path.join(DATA_DIR, tweetId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/** https://x.com/kullanici/status/123 -> { tweetId, handle } */
export function parseTweetUrl(input) {
  const m = String(input).match(/(?:twitter|x)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/);
  if (!m) throw new Error(`Tweet linki anlasilamadi: ${input}`);
  return { handle: m[1], tweetId: m[2] };
}
