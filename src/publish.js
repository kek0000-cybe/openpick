import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, DATA_DIR, readJson, writeJson } from './paths.js';
import { commitHash, runDraw } from './fairness.js';

const cfg = readJson(path.join(ROOT, 'site.config.json'));
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'docs');

function parseArgs(argv) {
  const args = { winners: null, backups: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tweet') args.tweetId = argv[++i];
    else if (a === '--winners') args.winners = Number(argv[++i]);
    else if (a === '--backups') args.backups = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--allow-test-id') args.allowTestId = true;
    else if (a === '--rebuild') args.rebuild = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const outRoot = args.out ? path.resolve(args.out) : OUT;

/* ---------- yardimcilar ---------- */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Satir ici JSON'da </script> kacisi sart: aksi halde bir kullanici adi
// script blogundan cikip sayfayi ele gecirebilir.
const jsonLiteral = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const trDate = (iso) =>
  iso ? new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul',
  }).format(new Date(iso)) : '';

/** ES modulunu satir ici <script> icin duzlestirir. */
function inlineModule(file) {
  return fs.readFileSync(path.join(WEB, file), 'utf8')
    .replace(/^\s*import[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

/**
 * CSS adresine icerik ozeti eklenir: stil degistiginde adres de degisir.
 * Bu olmadan geri donen ziyaretcinin tarayicisi eski stili onbellekten
 * kullanir ve yeni HTML ile eslesmedigi icin sayfa bozuk gorunur.
 */
function cssSurumu() {
  const css = fs.readFileSync(path.join(WEB, 'assets', 'site.css'));
  return '?v=' + crypto.createHash('sha256').update(css).digest('hex').slice(0, 10);
}

function fill(template, tokens) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : m);
}

/** Deterministik yedek avatar: dis istek yok, her zaman ayni gorunur. */
function identicon(handle) {
  const h = crypto.createHash('sha256').update(handle).digest();
  const hue = h[0] * 360 / 256;
  const letter = handle[0]?.toUpperCase() ?? '?';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" fill="hsl(${hue.toFixed(0)} 45% 28%)"/>
<text x="32" y="42" font-family="sans-serif" font-size="30" fill="hsl(${hue.toFixed(0)} 60% 82%)"
 text-anchor="middle">${esc(letter)}</text></svg>`;
}

async function mirrorAvatar(user, dir) {
  // X CDN'ine dogrudan baglamak ziyaretcinin IP'sini X'e sizdirir ve adresler
  // degistiginde arsiv sayfalari bozulur. Yayin aninda indirip yaniniza aliyoruz.
  const safe = user.handle.replace(/[^a-z0-9_]/gi, '');
  if (!safe) return null;
  const url = user.avatar;
  if (url && /^https:\/\/pbs\.twimg\.com\//.test(url)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0 && buf.length < 400_000) {
          fs.writeFileSync(path.join(dir, `${safe}.jpg`), buf);
          return `avatar/${safe}.jpg`;
        }
      }
    } catch { /* asagida identicon'a duser */ }
  }
  fs.writeFileSync(path.join(dir, `${safe}.svg`), identicon(safe), 'utf8');
  return `avatar/${safe}.svg`;
}

/* ---------- tek cekilis yayinla ---------- */
async function publishDraw(tweetId) {
  if (!args.allowTestId && !/^[0-9]{5,25}$/.test(tweetId)) {
    throw new Error(`Gecersiz tweet kimligi: ${tweetId} (test verisi siteye sizmasin diye)`);
  }
  const src = path.join(DATA_DIR, tweetId);
  const record = readJson(path.join(src, 'result.json')) ?? readJson(path.join(src, 'commitment.json'));
  if (!record) throw new Error(`${tweetId} icin commitment.json ya da result.json yok`);

  const dstDir = path.join(outRoot, tweetId);
  fs.mkdirSync(path.join(dstDir, 'avatar'), { recursive: true });

  /* 1) Katilimci listesini dogrula ve BAYT BAYT kopyala.
        Yeniden yazmak satir sonlarini degistirip ozeti bozabilir. */
  const listSrc = path.join(src, 'katilimcilar.txt');
  const raw = fs.readFileSync(listSrc, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    if (!/^[a-z0-9_]{1,15}$/.test(line)) {
      throw new Error(`katilimcilar.txt icinde gecersiz satir: "${line.slice(0, 40)}" — yayin durduruldu`);
    }
  }
  if (commitHash(lines) !== record.commit) {
    throw new Error('Liste ozeti taahhutle uyusmuyor — dosya degismis olabilir. Yayin durduruldu.');
  }
  fs.copyFileSync(listSrc, path.join(dstDir, 'katilimcilar.txt'));

  /* 2) Cekilis yapildiysa sonucu bagimsiz olarak yeniden dogrula. */
  if (record.bitcoin?.blockHash) {
    const check = runDraw({
      handles: lines,
      blockHash: record.bitcoin.blockHash,
      winnerCount: record.winners.length,
      backupCount: record.backups.length,
      commit: record.commit,
    });
    if (check.seed !== record.seed ||
        JSON.stringify(check.winners) !== JSON.stringify(record.winners) ||
        JSON.stringify(check.backups) !== JSON.stringify(record.backups)) {
      throw new Error('Kayitli sonuc yeniden hesaplamayla uyusmuyor — yayin durduruldu.');
    }
  }

  /* 3) Kamuya acik kayit: ALAN ALAN secilir, asla spread edilmez.
        Spread kullansak draw.js'e ileride eklenen her alan siteye sizardi. */
  const winnerCount = args.winners ?? record.winners?.length ?? 1;
  const backupCount = args.backups ?? record.backups?.length ?? 0;
  const pub = {
    tweetId: record.tweetId,
    tweetUrl: record.tweetUrl,
    title: record.title,
    prize: record.prize,
    committedAt: record.committedAt,
    drawAt: record.drawAt,
    drawnAt: record.drawnAt ?? null,
    publishedAt: new Date().toISOString(),
    participantCount: record.participantCount,
    rejectedCount: record.rejectedCount,
    filters: record.filters,
    commit: record.commit,
    commitTweetUrl: record.commitTweetUrl ?? null,
    winnerCount,
    backupCount,
    bitcoin: {
      tipAtCommit: record.bitcoin.tipAtCommit,
      targetHeight: record.bitcoin.targetHeight,
      blockHash: record.bitcoin.blockHash ?? null,
    },
    seed: record.seed ?? null,
    winners: record.winners ?? null,
    backups: record.backups ?? null,
    steps: record.steps ?? null,
  };
  writeJson(path.join(dstDir, 'cekilis.json'), pub);

  /* 4) Eleme listesi: yalnizca kullanici adi ve sebep. */
  const rejected = readJson(path.join(src, 'rejected.json'), []);
  writeJson(path.join(dstDir, 'elenenler.json'),
    rejected.map((r) => ({ handle: r.handle, reason: r.reason })));

  /* 5) Avatar seridi: participants.json'dan SADECE ad ve gorsel. */
  const participants = readJson(path.join(src, 'participants.json'), { users: [] });
  const passed = new Set(lines);
  const sample = participants.users.filter((u) => passed.has(u.handle.toLowerCase())).slice(0, cfg.avatarCap);
  const tiles = [];
  for (const u of sample) {
    const rel = await mirrorAvatar(u, path.join(dstDir, 'avatar'));
    if (rel) tiles.push(`<div class="karo"><img src="${esc(rel)}" alt="" loading="lazy"></div>`);
  }
  if (pub.participantCount > tiles.length) tiles.push('<div class="karo artan">?</div>');

  /* 6) Sayfayi uret. */
  const title = pub.title || `Çekiliş ${tweetId}`;
  const desc = pub.prize
    ? `${pub.prize} · ${pub.participantCount} katılımcı · kanıtlanabilir adil çekiliş`
    : `${pub.participantCount} katılımcı arasından kanıtlanabilir adil çekiliş.`;
  const commitRow = pub.commitTweetUrl
    ? `<div class="fact"><div class="fact-k">Taahhüt tweeti</div><div class="fact-v plain"><a href="${esc(pub.commitTweetUrl)}" rel="noopener nofollow">Blok kazılmadan önce yayınlandı</a></div></div>`
    : '';

  const html = fill(fs.readFileSync(path.join(WEB, 'templates', 'cekilis.html'), 'utf8'), {
    CSS_V: cssSurumu(),
    SITE_NAME: esc(cfg.siteName),
    TITLE: esc(title),
    DESC: esc(desc),
    PAGE_URL: `${cfg.siteUrl}/${tweetId}/`,
    TWEET_URL: esc(pub.tweetUrl),
    TWEET_ID: esc(tweetId),
    COMMIT: esc(pub.commit),
    COUNT: String(pub.participantCount),
    REJECTED: String(pub.rejectedCount ?? 0),
    TARGET_HEIGHT: String(pub.bitcoin.targetHeight),
    COMMIT_TWEET_ROW: commitRow,
    TILES: tiles.join(''),
    AS_OF: pub.drawnAt ? '' : ` · son güncelleme ${esc(trDate(pub.publishedAt))}`,
    REPO_URL: esc(cfg.repoUrl),
    CONTACT: esc(cfg.contact),
    DRAW_JSON: jsonLiteral(pub),
    ENGINE: inlineModule('lib/engine.js'),
    CHAIN: inlineModule('lib/chain.js'),
    PAGE: inlineModule('lib/page.js'),
  });
  fs.writeFileSync(path.join(dstDir, 'index.html'), html, 'utf8');

  return pub;
}

/* ---------- ortak sayfalar + dizin ---------- */
function publishShared(entries) {
  fs.mkdirSync(path.join(outRoot, 'varlik'), { recursive: true });
  fs.mkdirSync(path.join(outRoot, 'dogrula'), { recursive: true });
  fs.copyFileSync(path.join(WEB, 'assets', 'site.css'), path.join(outRoot, 'varlik', 'site.css'));
  fs.writeFileSync(path.join(outRoot, '.nojekyll'), '', 'utf8');

  fs.writeFileSync(path.join(outRoot, 'dogrula', 'index.html'),
    fill(fs.readFileSync(path.join(WEB, 'templates', 'dogrula.html'), 'utf8'), {
      CSS_V: cssSurumu(),
      SITE_NAME: esc(cfg.siteName),
      REPO_URL: esc(cfg.repoUrl),
      ENGINE: inlineModule('lib/engine.js'),
    }), 'utf8');

  const cards = entries.length === 0
    ? '<p class="ikincil">Henüz yayınlanmış çekiliş yok.</p>'
    : entries.map((e, i) => {
        const done = Boolean(e.bitcoin.blockHash);
        const rozet = done
          ? '<span class="rozet iyi"><span class="rozet-nokta"></span>sonuçlandı</span>'
          : '<span class="rozet"><span class="rozet-nokta"></span>yaklaşan</span>';
        const meta = done
          ? `${e.participantCount} katılımcı · ${trDate(e.drawnAt || e.drawAt)}`
          : `${e.participantCount} katılımcı · çekiliş ${trDate(e.drawAt)}`;
        return `<a class="kart hrk-sirali" style="--sira: ${i}" href="${esc(e.tweetId)}/">
  <div class="kart-bas"><span class="kart-baslik">${esc(e.title || 'Çekiliş ' + e.tweetId)}</span>${rozet}</div>
  <div class="kart-alt">${esc(meta)}</div>
</a>`;
      }).join('\n');

  fs.writeFileSync(path.join(outRoot, 'index.html'),
    fill(fs.readFileSync(path.join(WEB, 'templates', 'index.html'), 'utf8'), {
      CSS_V: cssSurumu(),
      SITE_NAME: esc(cfg.siteName),
      SITE_URL: esc(cfg.siteUrl),
      REPO_URL: esc(cfg.repoUrl),
      CONTACT: esc(cfg.contact),
      CARDS: cards,
    }), 'utf8');

  writeJson(path.join(outRoot, 'draws.json'), entries.map((e) => ({
    tweetId: e.tweetId, title: e.title, drawAt: e.drawAt,
    participantCount: e.participantCount, done: Boolean(e.bitcoin.blockHash),
  })));
}

/* ---------- sizinti kanaryasi ---------- */
const FORBIDDEN_KEYS = ['description', 'location', 'followers', 'following', 'hasBanner', 'verified', 'createdAt'];

function leakCanary() {
  const bad = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name === 'participants.json') bad.push(`${full} — ham profil dosyasi`);
      if (entry.name.endsWith('.json')) {
        const text = fs.readFileSync(full, 'utf8');
        for (const key of FORBIDDEN_KEYS) {
          if (new RegExp(`"${key}"\\s*:`).test(text)) bad.push(`${full} — "${key}" alani`);
        }
      }
    }
  };
  walk(outRoot);
  return bad;
}

/* ---------- calistir ---------- */
const ids = args.tweetId
  ? [args.tweetId]
  : (fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((d) => /^[0-9]{5,25}$/.test(d)) : []);

if (ids.length === 0) {
  console.error('\nKullanim: npm run publish -- --tweet <tweetId>\n');
  process.exit(1);
}

const published = [];
for (const id of ids) {
  const pub = await publishDraw(id);
  published.push(pub);
  console.log(`  yayinlandi: ${id} (${pub.participantCount} katilimci)`);
}

// Daha once yayinlanmis cekilisleri de dizinde tut.
const all = new Map(published.map((p) => [p.tweetId, p]));
if (fs.existsSync(outRoot)) {
  for (const entry of fs.readdirSync(outRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9]{5,25}$/.test(entry.name)) continue;
    if (all.has(entry.name)) continue;
    const prev = readJson(path.join(outRoot, entry.name, 'cekilis.json'));
    if (prev) all.set(entry.name, prev);
  }
}
const entries = [...all.values()].sort((a, b) => new Date(b.drawAt) - new Date(a.drawAt));
publishShared(entries);

const leaks = leakCanary();
if (leaks.length) {
  console.error('\n  SIZINTI TESPIT EDILDI — yayin gecersiz:\n' + leaks.map((l) => '   ' + l).join('\n') + '\n');
  process.exit(1);
}

console.log(`
  Site hazir: ${outRoot}
  Onizleme  : npm run site
  Yayinla   : git add -A && git commit -m "cekilis" && git push
`);
