import { chromium } from 'playwright';
import { PROFILE_DIR } from './paths.js';

/**
 * Tek seferlik giris. Tarayici acilir, X hesabinla normal sekilde girersin.
 * Oturum PROFILE_DIR icinde kalir; collect.js ayni profili yeniden kullanir.
 * Boylece sifreni hicbir yere yazmiyoruz, cerez kopyalamiyoruz.
 */
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded' });

console.log('\n  Acilan tarayicida X hesabinla giris yap.');
console.log('  Giris bitince ana akisi gordugunde bu pencereyi KAPAT.');
console.log('  Oturum kaydedilecek, bir daha giris yapman gerekmeyecek.\n');

await ctx.waitForEvent('close', { timeout: 0 });
console.log('  Oturum kaydedildi.\n');
