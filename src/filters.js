/**
 * Ekrandaki "User Filters" karsiliklari.
 * Tum veriler toplama sirasinda zaten geldigi icin filtreleme ek istek gerektirmez.
 */
export const DEFAULT_FILTERS = {
  mustHaveAvatar: true,
  mustHaveBanner: false,
  mustHaveDescription: false,
  mustHaveLocation: false,
  minTweets: 0,
  minAccountAgeDays: 0,
  excludeHandles: [],
};

const days = (ms) => ms / 86_400_000;

/**
 * Bir filtreyi uygulamadan ONCE, dayandigi alanin gercekten olculup
 * olculmedigini denetler.
 *
 * ⚠️ NEDEN VAR: X alan yapisini degistirdiginde tweet sayisi herkeste 0
 *    geliyordu. "En az 100 tweet" filtresi bunu "hicbiri yeterli degil" diye
 *    okuyup 6421 kisiden 6381'ini eledi ve cekilis, verisi kazara guncel olan
 *    40 kisi arasinda yapildi. Sessiz ve tamamen yanlis bir sonucti.
 *
 *    Bir alan HERKESTE bossa bu bir olcum degil, veri eksikligidir; o alana
 *    dayanan filtre uygulanmamali, calisiyormus gibi yapip herkesi elememeli.
 */
export function filtreDenetimi(users, filters = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  if (users.length < 20) return [];
  const oran = (fn) => users.filter(fn).length / users.length;
  const sorunlar = [];

  if (f.minTweets > 0 && oran((u) => !u.tweets) > 0.95) {
    sorunlar.push('tweet sayisi (--min-tweets)');
  }
  if (f.mustHaveDescription && oran((u) => !u.description) > 0.98) {
    sorunlar.push('biyografi (--require-bio)');
  }
  if (f.mustHaveBanner && oran((u) => !u.hasBanner) > 0.98) {
    sorunlar.push('kapak gorseli (--require-banner)');
  }
  if (f.minAccountAgeDays > 0 && oran((u) => !u.createdAt) > 0.5) {
    sorunlar.push('hesap yasi (--min-age-days)');
  }
  return sorunlar;
}

export function applyFilters(users, filters = {}, now = new Date()) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const excluded = new Set(f.excludeHandles.map((h) => h.replace(/^@/, '').toLowerCase()));
  const rejected = [];

  const passed = users.filter((u) => {
    const fail = (reason) => {
      rejected.push({ handle: u.handle, reason });
      return false;
    };
    if (excluded.has(u.handle.toLowerCase())) return fail('liste disi');
    if (f.mustHaveAvatar && !u.hasAvatar) return fail('profil fotografi yok');
    if (f.mustHaveBanner && !u.hasBanner) return fail('kapak gorseli yok');
    if (f.mustHaveDescription && !u.description.trim()) return fail('biyografi yok');
    if (f.mustHaveLocation && !u.location.trim()) return fail('konum yok');
    // Sebep metinleri yayınlanıyor: kişinin GERÇEK tweet sayısını yazmak,
    // korumaya çalıştığımız profil verisini sızdırır. Eşik yazılır, değer yazılmaz.
    if (f.minTweets > 0 && u.tweets < f.minTweets) return fail(`tweet sayısı yetersiz (< ${f.minTweets})`);
    if (f.minAccountAgeDays > 0) {
      if (!u.createdAt) return fail('hesap yasi bilinmiyor');
      if (days(now - new Date(u.createdAt)) < f.minAccountAgeDays) {
        return fail(`hesap ${f.minAccountAgeDays} gunden yeni`);
      }
    }
    return true;
  });

  return { passed, rejected, filters: f };
}
