/**
 * drand — halka acik dogrulanabilir rastgelelik agi (League of Entropy).
 * Hem tarayici hem Node ayni dosyayi kullanir.
 *
 * NEDEN BITCOIN YERINE BU:
 * Bitcoin'de blok araligi ~10 dakika, yani cekilis icin en az o kadar beklemek
 * gerekiyordu. drand her 3 SANIYEDE bir yeni deger uretiyor — sonuc aninda
 * geliyor ama garanti aynen duruyor:
 *
 *   - Tur numarasi zamandan kesin hesaplanir: tur = (zaman - genesis) / 3
 *     Yani "su saatte hangi turu kullanacagiz" onceden ilan edilebilir.
 *   - O turun degeri, turun zamani gelmeden URETILMEZ. Dagitik bir esik
 *     imza agi uretir; tek bir taraf onceden bilemez ve etkileyemez.
 *   - Deger yayinlandiktan sonra herkes ayni adresten dogrulayabilir.
 *
 * Yani "bekleme yok" ile "sonucu kimse onceden bilemez" ayni anda saglanir.
 */
export const DRAND = {
  chain: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  genesis: 1692803367,
  period: 3,
  mirrors: [
    'https://api.drand.sh',
    'https://api2.drand.sh',
    'https://api3.drand.sh',
  ],
};

/** Verilen ana (unix saniye) denk gelen tur numarasi. */
export function roundAt(unixSeconds) {
  return Math.floor((unixSeconds - DRAND.genesis) / DRAND.period) + 1;
}

/** Turun gerceklesecegi an (unix saniye). */
export function roundTime(round) {
  return DRAND.genesis + (round - 1) * DRAND.period;
}

export function currentRound() {
  return roundAt(Math.floor(Date.now() / 1000));
}

const DRAND_TIMEOUT = 8000;

async function drandGetir(yol) {
  const hatalar = [];
  for (const base of DRAND.mirrors) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DRAND_TIMEOUT);
    try {
      const res = await fetch(`${base}/${DRAND.chain}${yol}`, { signal: ctrl.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      hatalar.push(`${base}: ${err.message}`);
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(`drand aynalarina ulasilamadi — ${hatalar.join(' | ')}`);
}

/** Bir turun rastgeleligi; tur henuz gelmediyse null. */
export async function randomnessAt(round) {
  const veri = await drandGetir(`/public/${round}`);
  if (!veri?.randomness) return null;
  if (!/^[0-9a-f]{64}$/.test(veri.randomness)) throw new Error('drand gecersiz deger dondu');
  return { round: veri.round, randomness: veri.randomness, signature: veri.signature };
}

/**
 * Ayni turu iki BAGIMSIZ aynadan dogrular.
 * Tek bir aynanin yanlis ya da geride kalmis veri vermesine karsi ucuz koruma.
 */
export async function randomnessConfirmed(round) {
  const sonuclar = [];
  for (const base of DRAND.mirrors) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DRAND_TIMEOUT);
    try {
      const res = await fetch(`${base}/${DRAND.chain}/public/${round}`, { signal: ctrl.signal });
      if (res.status === 404) return { randomness: null, confirmedBy: 0 };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const v = await res.json();
      if (/^[0-9a-f]{64}$/.test(v.randomness ?? '')) sonuclar.push(v.randomness);
      if (sonuclar.length >= 2) break;
    } catch {
      /* sonraki aynaya gec */
    } finally {
      clearTimeout(t);
    }
  }
  if (sonuclar.length === 0) return { randomness: null, confirmedBy: 0 };
  if (sonuclar.length === 1) return { randomness: sonuclar[0], confirmedBy: 1 };
  if (sonuclar[0] !== sonuclar[1]) {
    throw new Error('drand aynalari farkli deger bildirdi — sonuc aciklanmayacak.');
  }
  return { randomness: sonuclar[0], confirmedBy: 2 };
}
