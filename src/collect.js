import { chromium } from 'playwright';
import path from 'node:path';
import { PROFILE_DIR, drawDir, parseTweetUrl, readJson, writeJson } from './paths.js';

const SOURCES = {
  retweets: { suffix: '/retweets', match: /\/graphql\/[^/]+\/Retweeters/ },
  likes: { suffix: '/likes', match: /\/graphql\/[^/]+\/Favoriters/ },
};

function parseArgs(argv) {
  const args = { types: ['retweets'], max: Infinity, slow: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--types') args.types = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--max') args.max = Number(argv[++i]);
    else if (a === '--slow') args.slow = true;
    else if (!args.url && a.includes('status/')) args.url = a;
  }
  if (!args.url) {
    console.error('\nKullanim: npm run collect -- --url <tweet-linki> [--types retweets,likes] [--max 5000] [--slow]\n');
    process.exit(1);
  }
  for (const t of args.types) {
    if (!SOURCES[t]) {
      console.error(`Bilinmeyen tur: ${t}. Desteklenen: ${Object.keys(SOURCES).join(', ')}`);
      process.exit(1);
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * base * 0.6);

/** X'in kullanici objesini sabit bir sekle indirger; hem eski hem yeni alan yapisini kabul eder. */
function normalizeUser(node) {
  const l = node.legacy ?? {};
  const c = node.core ?? {};
  const handle = c.screen_name ?? l.screen_name;
  if (!handle) return null;
  const avatar = node.avatar?.image_url ?? l.profile_image_url_https ?? '';
  const createdRaw = c.created_at ?? l.created_at;
  return {
    id: node.rest_id,
    handle,
    name: c.name ?? l.name ?? '',
    createdAt: createdRaw ? new Date(createdRaw).toISOString() : null,
    description: l.description ?? '',
    location: node.location?.location ?? l.location ?? '',
    followers: l.followers_count ?? 0,
    following: l.friends_count ?? 0,
    tweets: l.statuses_count ?? 0,
    avatar,
    hasAvatar: !(l.default_profile_image === true || /default_profile/.test(avatar)),
    hasBanner: Boolean(l.profile_banner_url),
    verified: Boolean(node.is_blue_verified ?? l.verified),
  };
}

/**
 * Yanitin icinde nerede olursa olsun kullanici objelerini bulur.
 * Sabit bir yol (data.retweeters_timeline...) yazmiyoruz; X ic yapiyi degistirdiginde
 * kirilmasin diye agaci geziyoruz.
 */
function extractUsers(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) extractUsers(item, out);
    return out;
  }
  if (node.__typename === 'User' && node.rest_id && (node.legacy || node.core)) {
    const u = normalizeUser(node);
    if (u) out.push(u);
  }
  for (const key of Object.keys(node)) extractUsers(node[key], out);
  return out;
}

async function collectSource(page, tweetUrl, type, opts) {
  const { suffix, match } = SOURCES[type];
  const found = new Map();
  let rateLimited = false;
  let sawResponse = false;

  const onResponse = async (response) => {
    if (!match.test(response.url())) return;
    sawResponse = true;
    if (response.status() === 429) {
      rateLimited = true;
      return;
    }
    try {
      const json = await response.json();
      for (const user of extractUsers(json)) {
        if (!found.has(user.handle.toLowerCase())) found.set(user.handle.toLowerCase(), user);
      }
    } catch {
      /* JSON olmayan yanitlari yoksay */
    }
  };

  page.on('response', onResponse);
  const target = tweetUrl.replace(/\/+$/, '') + suffix;
  console.log(`\n  [${type}] ${target}`);
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await sleep(jitter(2500));

  if (page.url().includes('/login') || page.url().includes('/i/flow/login')) {
    throw new Error('Oturum gecersiz. Once "npm run login" calistir.');
  }

  let idle = 0;
  let lastCount = 0;
  const baseDelay = opts.slow ? 3500 : 1800;

  while (idle < 4 && found.size < opts.max) {
    await page.mouse.wheel(0, 1600 + Math.floor(Math.random() * 700));
    await sleep(jitter(baseDelay));

    if (rateLimited) {
      console.log('  ! X hiz siniri uygulandi, 90 saniye bekleniyor...');
      rateLimited = false;
      await sleep(90_000);
      idle = 0;
      continue;
    }

    if (found.size === lastCount) {
      idle++;
    } else {
      idle = 0;
      lastCount = found.size;
      process.stdout.write(`\r  toplanan: ${found.size}   `);
    }
  }

  page.off('response', onResponse);
  process.stdout.write(`\r  [${type}] toplam ${found.size} kisi\n`);

  if (!sawResponse) {
    console.log('  ! Bu tur icin hic veri yakalanamadi. Tweet gizli olabilir veya X yapiyi degistirmis olabilir.');
  }
  return [...found.values()];
}

const args = parseArgs(process.argv.slice(2));
const { tweetId } = parseTweetUrl(args.url);
const dir = drawDir(tweetId);
const outFile = path.join(dir, 'participants.json');

const existing = readJson(outFile, { tweetUrl: args.url, tweetId, sources: {}, users: [] });
const merged = new Map(existing.users.map((u) => [u.handle.toLowerCase(), u]));

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

try {
  for (const type of args.types) {
    const users = await collectSource(page, args.url, type, args);
    existing.sources[type] = users.length;
    for (const u of users) {
      const key = u.handle.toLowerCase();
      const prev = merged.get(key);
      merged.set(key, { ...prev, ...u, via: [...new Set([...(prev?.via ?? []), type])] });
    }
    // Her tur arasinda nefes al: art arda istek atmak en hizli banlanma yolu.
    await sleep(jitter(4000));
  }
} finally {
  await ctx.close();
}

existing.users = [...merged.values()].sort((a, b) => a.handle.localeCompare(b.handle));
existing.collectedAt = new Date().toISOString();
writeJson(outFile, existing);

console.log(`\n  Kaydedildi: ${outFile}`);
console.log(`  Toplam benzersiz katilimci: ${existing.users.length}\n`);
console.log('  Sirada: npm run commit -- --tweet ' + tweetId + '\n');
