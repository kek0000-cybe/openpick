import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { PROFILE_DIR, drawDir, parseTweetUrl, readJson, writeJson } from './paths.js';
import { kimlikTahmini } from './kimlik.js';

const SOURCES = {
  retweets: { suffix: '/retweets', match: /\/graphql\/[^/]+\/Retweeters/ },
  likes: { suffix: '/likes', match: /\/graphql\/[^/]+\/Favoriters/ },
  // Yorumlar tweetin kendi sayfasindan gelir ve yapisi digerlerinden farklidir:
  // kullanici degil TWEET listesi doner, kullanici her tweetin icindedir.
  replies: { suffix: '', match: /\/graphql\/[^/]+\/TweetDetail/, kind: 'reply' },
};

function parseArgs(argv) {
  const args = { types: ['retweets'], max: Infinity, slow: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--types') args.types = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--max') args.max = Number(argv[++i]);
    else if (a === '--slow') args.slow = true;
    else if (a === '--dump') args.dump = true;
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

/**
 * X'in kullanici objesini sabit bir sekle indirger.
 *
 * ⚠️ X 2026'da `legacy` alanini KALDIRDI ve her seyi ayri objelere tasidi:
 *      statuses_count  -> tweet_counts.tweets
 *      followers_count -> relationship_counts.followers
 *      description     -> profile_bio.description
 *      profile_banner  -> banner.image_url
 *    Eski yollar hala yedek olarak okunuyor; X bazi oturumlara eski sekli
 *    dondurebiliyor. Yeni yapi once denenir.
 *
 *    Bu sessiz bir kirilmaydi: alanlar bos gelince filtreler calisiyor gibi
 *    gorunup herkesi eliyordu. Asagidaki saglik kontrolu tam bunun icin var.
 */
function normalizeUser(node) {
  const l = node.legacy ?? {};
  const c = node.core ?? {};
  const handle = c.screen_name ?? l.screen_name;
  if (!handle) return null;

  const avatar = node.avatar?.image_url ?? l.profile_image_url_https ?? '';
  const banner = node.banner?.image_url ?? l.profile_banner_url ?? '';
  const createdRaw = c.created_at ?? l.created_at;

  return {
    id: node.rest_id,
    handle,
    name: c.name ?? l.name ?? '',
    createdAt: createdRaw ? new Date(createdRaw).toISOString() : null,
    description: node.profile_bio?.description ?? l.description ?? '',
    location: node.location?.location ?? l.location ?? '',
    followers: node.relationship_counts?.followers ?? l.followers_count ?? 0,
    following: node.relationship_counts?.following ?? l.friends_count ?? 0,
    tweets: node.tweet_counts?.tweets ?? l.statuses_count ?? 0,
    avatar,
    hasAvatar: !(l.default_profile_image === true || /default_profile_images/.test(avatar)),
    hasBanner: Boolean(banner),
    verified: Boolean(node.is_blue_verified ?? node.verification?.verified ?? l.verified),
  };
}

/**
 * Toplama bittikten sonra verinin sagligini kontrol eder.
 * Bir alan HERKESTE bos ciktiysa bu gercek bir olcum degil, cikarim hatasidir —
 * ve o alana bagli filtre sessizce herkesi eler. Sessiz kalmaktansa bagirmali.
 */
function saglikKontrolu(users) {
  if (users.length < 20) return [];
  const uyarilar = [];
  const oran = (f) => users.filter(f).length / users.length;
  if (oran((u) => u.tweets === 0) > 0.95) uyarilar.push('tweet sayisi');
  if (oran((u) => u.followers === 0) > 0.95) uyarilar.push('takipci sayisi');
  if (oran((u) => !u.description) > 0.98) uyarilar.push('biyografi');
  if (oran((u) => !u.hasBanner) > 0.98) uyarilar.push('kapak gorseli');
  if (oran((u) => !u.createdAt) > 0.5) uyarilar.push('hesap yasi');
  return uyarilar;
}

/**
 * Yorumdan katilimci kimligini tahmin eder.
 *
 * Insanlar serbest yaziyor: "Katildim id ::::Firat27", "fes23 katildim",
 * "Id: kanboz121820gma", "user name 6q : virguest". Bu yuzden cikarim
 * TAHMINDIR ve ham metin her zaman yaninda saklanir — supheli olanlari
 * gozle kontrol edebilmek icin.
 */
/**
 * Yorumlari cikarir. Ucu birden zorunlu:
 *   - yalnizca BU konusmaya ait olanlar (yanit akisina reklam tweetleri karisiyor)
 *   - duzenleyenin kendi mesajlari haric
 *   - ayni kisi birden cok yazmis olabilir; tekrarlar sonra ayiklanir
 */
function extractReplies(json, tweetId) {
  const tweetler = [];
  (function ara(x) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(ara); return; }
    if (x.__typename === 'Tweet' && x.rest_id && x.legacy) { tweetler.push(x); return; }
    for (const v of Object.values(x)) ara(v);
  })(json);

  const yazan = (t) => t.core?.user_results?.result ?? null;
  const anaTweet = tweetler.find((t) => t.rest_id === tweetId);
  const duzenleyen = anaTweet
    ? (yazan(anaTweet)?.core?.screen_name ?? yazan(anaTweet)?.legacy?.screen_name ?? '').toLowerCase()
    : null;

  const cikti = [];
  for (const t of tweetler) {
    if (t.legacy.conversation_id_str !== tweetId) continue;   // baska konusma
    if (t.rest_id === tweetId) continue;                       // cekilis tweetinin kendisi
    const u = yazan(t);
    if (!u) continue;
    const user = normalizeUser(u);
    if (!user) continue;
    if (duzenleyen && user.handle.toLowerCase() === duzenleyen) continue; // duzenleyenin mesajlari
    const metin = t.note_tweet?.note_tweet_results?.result?.text ?? t.legacy.full_text ?? '';
    const { id, kesin } = kimlikTahmini(metin);
    cikti.push({ ...user, replyText: metin, replyId: id, replyIdKesin: kesin, replyAt: t.legacy.created_at });
  }
  return cikti;
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
  const { suffix, match, kind } = SOURCES[type];
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
      // Teshis modu: X alan yapisini degistirdiginde ham yaniti gorup
      // cikarimi ona gore duzeltebilmek icin ilk yaniti kaydeder.
      if (opts.dump && !opts.dumped) {
        opts.dumped = true;
        const hedef = path.join(drawDir(opts.tweetId), 'ham-ornek.json');
        fs.writeFileSync(hedef, JSON.stringify(json, null, 2), 'utf8');
        console.log(`\n  Ham yanit kaydedildi: ${hedef}`);
      }
      const bulunan = kind === 'reply' ? extractReplies(json, opts.tweetId) : extractUsers(json);
      for (const user of bulunan) {
        const key = user.handle.toLowerCase();
        // Ayni kisi birden cok yorum yazmis olabilir (ornekte biri 5 kez yazdi).
        // Ilk yorumu esas aliyoruz; sonrakiler katilimi tekrarlamaktan ibaret.
        if (!found.has(key)) found.set(key, user);
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
args.tweetId = tweetId;
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
console.log(`  Toplam benzersiz katilimci: ${existing.users.length}`);

const uyarilar = saglikKontrolu(existing.users);
if (uyarilar.length) {
  console.log(`
  ! DIKKAT: su alanlar herkeste bos geldi -> ${uyarilar.join(', ')}
    Bu bir olcum degil, cikarim hatasi. X alan yapisini degistirmis olabilir.
    Bu alanlara bagli filtreleri KULLANMA; kullanirsan herkes elenir.
    Yapiyi gormek icin:  npm run collect -- --url <link> --max 3 --dump
`);
}
console.log('  Sirada: npm run commit -- --tweet ' + tweetId + '\n');
