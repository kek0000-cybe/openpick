import { hashAtHeightConfirmed, currentHeight } from './bitcoin.js';
import { randomnessConfirmed, currentRound } from './beacon.js';

/**
 * Taahhutte ilan edilen kaynaktan rastgeleligi ceker.
 * Iki kaynak da 64 karakterlik onaltilik deger dondurur, tohum turetimi ayni.
 *
 * Eski cekilisler commitment.bitcoin tasiyor, yenileri commitment.randomness.
 */
export function kaynakBilgisi(commitment) {
  return commitment.randomness ?? { source: 'bitcoin', ...commitment.bitcoin };
}

export function kaynakEtiketi(r) {
  return r.source === 'drand'
    ? `drand turu ${r.round}`
    : `Bitcoin blogu ${r.targetHeight}`;
}

export async function rastgeleligiAl(commitment) {
  const r = kaynakBilgisi(commitment);

  if (r.source === 'drand') {
    const { randomness, confirmedBy } = await randomnessConfirmed(r.round);
    if (!randomness) {
      const suan = currentRound();
      const kalan = Math.max(0, r.round - suan);
      return { hazir: false, kalanSaniye: kalan * 3,
        mesaj: `drand turu ${r.round} henuz gelmedi (su an ${suan}, ~${kalan * 3} saniye)` };
    }
    return { hazir: true, deger: randomness, confirmedBy, etiket: kaynakEtiketi(r) };
  }

  const { hash, confirmedBy } = await hashAtHeightConfirmed(r.targetHeight);
  if (!hash) {
    const tip = await currentHeight();
    const kalan = Math.max(0, r.targetHeight - tip);
    return { hazir: false, kalanSaniye: kalan * 600,
      mesaj: `Blok ${r.targetHeight} henuz kazilmadi (su an ${tip}, ~${kalan * 10} dakika)` };
  }
  return { hazir: true, deger: hash, confirmedBy, etiket: kaynakEtiketi(r) };
}
