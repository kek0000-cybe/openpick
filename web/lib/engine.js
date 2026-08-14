/**
 * Çekiliş motorunun tarayıcı sürümü — src/fairness.js ile BİREBİR aynı sonucu
 * vermek zorundadır. İki motor ayrışırsa iki farklı kazanan çıkar ve güven biter;
 * test/crosscheck.js tam olarak bunu her koşuda karşılaştırır.
 *
 * Node 24'te de globalThis.crypto.subtle bulunduğu için bu dosya tarayıcı
 * açmadan doğrudan Node içinde test edilebilir.
 *
 * Yayınlanan sayfalara satır içi gömülür (publish.js), böylece doğrulama sayfası
 * tek dosya olarak indirilip çevrimdışı da çalışmaya devam eder.
 */
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (h) => new Uint8Array(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

export async function sha256Hex(text) {
  return toHex(await subtle.digest('SHA-256', enc.encode(text)));
}

/** Kullanıcı adlarını kanonik metne indirger: küçük harf, tekilleştirilmiş, sıralı. */
export function canonicalize(handles) {
  const unique = [...new Set(handles.map((h) => String(h).trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
  unique.sort();
  return unique.join('\n');
}

export async function commitHash(handles) {
  return sha256Hex(canonicalize(handles));
}

export async function deriveSeed(commit, blockHash) {
  const c = String(commit).trim().toLowerCase();
  const b = String(blockHash).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(c)) throw new Error('Geçersiz taahhüt özeti');
  if (!/^[0-9a-f]{64}$/.test(b)) throw new Error('Geçersiz blok hash');
  return sha256Hex(`${c}:${b}`);
}

export async function seedKey(seedHex) {
  return subtle.importKey('raw', hexToBytes(seedHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

const DRAW_BITS = 48;
const DRAW_SPACE = 2 ** DRAW_BITS;

/**
 * [0, bound) aralığında tarafsız tam sayı. Reddetme örneklemesi kullanır:
 * modulo yanlılığı oluşmaz, hiçbir katılımcı matematiksel olarak avantajlı değildir.
 * Ara değerleri de döndürür ki sayfa turun gerçek matematiğini gösterebilsin.
 */
export async function drawIndexDetailed(key, counter, bound) {
  if (!Number.isInteger(bound) || bound < 1) throw new Error('bound pozitif tam sayı olmalı');
  if (bound === 1) return { offset: 0, value: 0, attempt: 0 };
  const limit = Math.floor(DRAW_SPACE / bound) * bound;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const sig = new Uint8Array(await subtle.sign('HMAC', key, enc.encode(`${counter}:${attempt}`)));
    const value =
      sig[0] * 2 ** 40 + sig[1] * 2 ** 32 + sig[2] * 2 ** 24 + sig[3] * 2 ** 16 + sig[4] * 2 ** 8 + sig[5];
    if (value < limit) return { offset: value % bound, value, attempt };
  }
  throw new Error('Reddetme örneklemesi yakınsamadı');
}

export async function selectWinners(participants, seedHex, winnerCount, backupCount = 0) {
  const pool = [...participants];
  const n = pool.length;
  if (n === 0) throw new Error('Katılımcı listesi boş');
  const key = await seedKey(seedHex);
  const total = Math.min(winnerCount + backupCount, n);
  const picks = [];
  const steps = [];
  for (let i = 0; i < total; i++) {
    const bound = n - i;
    const { offset, value, attempt } = await drawIndexDetailed(key, i, bound);
    const j = i + offset;
    [pool[i], pool[j]] = [pool[j], pool[i]];
    picks.push(pool[i]);
    steps.push({ round: i, remaining: bound, value, attempt, offset, swappedWith: j, picked: pool[i] });
  }
  return { winners: picks.slice(0, winnerCount), backups: picks.slice(winnerCount), steps };
}

/** Tam çekiliş: liste + blok hash → kazananlar ve tüm ara değerler. */
export async function runDraw({ handles, blockHash, winnerCount = 1, backupCount = 0, commit }) {
  const ordered = canonicalize(handles).split('\n').filter(Boolean);
  const computed = await commitHash(ordered);
  if (commit && commit.trim().toLowerCase() !== computed) {
    throw new Error(`Taahhüt uyuşmuyor. Yayınlanan: ${commit}, hesaplanan: ${computed}`);
  }
  const seed = await deriveSeed(computed, blockHash);
  const { winners, backups, steps } = await selectWinners(ordered, seed, winnerCount, backupCount);
  return { commit: computed, blockHash, seed, participantCount: ordered.length, winners, backups, steps };
}
