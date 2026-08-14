import crypto from 'node:crypto';

/**
 * Katilimci listesini kanonik metne cevirir.
 * Kucuk harfe indirip siralar; boylece toplama sirasi degisse bile ozet ayni cikar.
 */
export function canonicalize(handles) {
  const unique = [...new Set(handles.map((h) => String(h).trim().replace(/^@/, '').toLowerCase()))];
  unique.sort();
  return unique.join('\n');
}

/** Katilim kapandiginda yayinlanan taahhut ozeti. */
export function commitHash(handles) {
  return crypto.createHash('sha256').update(canonicalize(handles), 'utf8').digest('hex');
}

/**
 * Tohum = SHA256(taahhut ozeti : blok hash).
 * Blok hash cekilis anindan sonra kazildigi icin kimse tohumu onceden bilemez;
 * taahhut ozeti onceden yayinlandigi icin liste sonradan degistirilemez.
 */
export function deriveSeed(commit, blockHash) {
  const c = String(commit).trim().toLowerCase();
  const b = String(blockHash).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(c)) throw new Error('Gecersiz taahhut ozeti (64 hex bekleniyor)');
  if (!/^[0-9a-f]{64}$/.test(b)) throw new Error('Gecersiz blok hash (64 hex bekleniyor)');
  return crypto.createHash('sha256').update(`${c}:${b}`, 'utf8').digest('hex');
}

const DRAW_BITS = 48; // 2^48 < 2^53, JS tam sayi guvenli araligi icinde
const DRAW_SPACE = 2 ** DRAW_BITS;

/**
 * [0, bound) araliginda tarafsiz tam sayi uretir.
 * Reddetme ornekleme (rejection sampling) kullanir: modulo yanliligi olusmaz,
 * yani hicbir katilimcinin secilme sansi digerlerinden yuksek degildir.
 */
export function drawIndexDetailed(seed, counter, bound) {
  if (!Number.isInteger(bound) || bound < 1) throw new Error('bound pozitif tam sayi olmali');
  if (bound === 1) return { offset: 0, value: 0, attempt: 0 };
  const key = Buffer.from(seed, 'hex');
  const limit = Math.floor(DRAW_SPACE / bound) * bound;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const digest = crypto.createHmac('sha256', key).update(`${counter}:${attempt}`, 'utf8').digest();
    const value = digest.readUIntBE(0, DRAW_BITS / 8);
    if (value < limit) return { offset: value % bound, value, attempt };
  }
  throw new Error('Reddetme ornekleme beklenmedik sekilde yakinsamadi');
}

export function drawIndex(seed, counter, bound) {
  return drawIndexDetailed(seed, counter, bound).offset;
}

/**
 * Kismi Fisher-Yates karistirmasi ile tekrarsiz kazanan secer.
 * Ilk `winnerCount` kisi asil kazanan, sonrasi sirali yedeklerdir.
 */
export function selectWinners(participants, seed, winnerCount, backupCount = 0) {
  const pool = [...participants];
  const n = pool.length;
  if (n === 0) throw new Error('Katilimci listesi bos');
  const total = Math.min(winnerCount + backupCount, n);
  const picks = [];
  const steps = [];
  for (let i = 0; i < total; i++) {
    const bound = n - i;
    const { offset, value, attempt } = drawIndexDetailed(seed, i, bound);
    const j = i + offset;
    [pool[i], pool[j]] = [pool[j], pool[i]];
    picks.push(pool[i]);
    steps.push({ round: i, remaining: bound, value, attempt, offset, swappedWith: j, picked: pool[i] });
  }
  return {
    winners: picks.slice(0, winnerCount),
    backups: picks.slice(winnerCount),
    steps,
  };
}

/** Tek cagrida tam cekilis: liste + blok hash -> kazananlar ve tum ara degerler. */
export function runDraw({ handles, blockHash, winnerCount = 1, backupCount = 0, commit }) {
  const ordered = canonicalize(handles).split('\n').filter(Boolean);
  const listCommit = commit ?? commitHash(ordered);
  const computed = commitHash(ordered);
  if (listCommit !== computed) {
    throw new Error(`Taahhut uyusmuyor. Yayinlanan: ${listCommit}, hesaplanan: ${computed}`);
  }
  const seed = deriveSeed(listCommit, blockHash);
  const { winners, backups, steps } = selectWinners(ordered, seed, winnerCount, backupCount);
  return { commit: listCommit, blockHash, seed, participantCount: ordered.length, winners, backups, steps };
}
