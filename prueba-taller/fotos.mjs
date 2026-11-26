// Prueba de la herramienta del taller 12/12 (tarot-web rama taller-1212), sin gente real: la sala real con D1 en memoria y el Realtime
// de PREVIEW (prueba-taller/server.mjs). Hermes (con una persona de cámara) abre los 5 pasos; Lucía usa el mazo de la web y Tomás el
// suyo. Capturas en tamaño celular (390×844 @2x) de cada paso, de los tres, y dos de computadora. Nada toca producción.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8799', CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const OUT = process.env.OUT || 'fotos', VIDEO = process.env.VIDEO || '';
mkdirSync(OUT, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const registro = [], fallas = [];
const anotar = (s) => { const l = `${new Date().toISOString().slice(11, 23)} ${s}`; console.log(l); registro.push(l); };
const MOVIL = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const PC = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true }; // sin cambiar isMobile: si no, puppeteer recarga y se sale de la llamada

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    ...(VIDEO ? [`--use-file-for-fake-video-capture=${VIDEO}`] : [])],
});
async function abrir(quien, { cam = true } = {}) {
  const ctx = await browser.createBrowserContext(); // cada uno con sus cookies
  const page = await ctx.newPage();
  page.on('response', (r) => { if (r.status() >= 400) anotar(`[${quien}] ${r.status()} ${r.url().replace(BASE, '')}`); });
  page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) anotar(`[${quien}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => { anotar(`[${quien}] pageerror: ${e.message}`); fallas.push(`${quien}: ${e.message}`); });
  await page.setViewport(MOVIL);
  await page.goto(`${BASE}/entrar-como?u=${quien}`, { waitUntil: 'domcontentloaded', timeout: 90e3 });
  await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, { timeout: 90e3 });
  await espera(1200);
  if (!cam) await page.evaluate(() => { if (S.cam) document.querySelector('#lob-cam').click(); });
  await page.evaluate(() => document.querySelector('#entrar').click());
  await page.waitForFunction(() => document.body.classList.contains('en-llamada') && S.sid, { timeout: 90e3, polling: 300 });
  try { await page.waitForFunction(() => S.pc?.connectionState === 'connected', { timeout: 45e3, polling: 300 }); }
  catch { anotar(`[${quien}] el video no conectó (sigue la prueba de la herramienta)`); }
  anotar(`[${quien}] en la sala`);
  return page;
}
const foto = async (page, nombre) => { await espera(400); await page.screenshot({ path: `${OUT}/${nombre}.png` }); anotar(`foto ${nombre}`); };
const tocar = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('no está: ' + s); el.click(); }, sel);
const hasta = (page, fn, arg, ms = 20e3) => page.waitForFunction(fn, { timeout: ms, polling: 200 }, arg);
const enPaso = (page, n) => hasta(page, (n) => (document.querySelector('#taller .tl-cab small')?.textContent || '') === (n ? `Step ${n} of 5` : ''), n);
const cartasEnMesa = (page) => page.evaluate(() => document.querySelectorAll('#taller .tl-meses .c img').length);
async function abrirPaso(n) { await tocar(H, '#taller [data-a="abrir"]'); await enPaso(H, n); await Promise.all([enPaso(L, n), enPaso(T, n)]); await espera(300); }

let H, L, T;
try {
  H = await abrir('owner');
  L = await abrir('u1', { cam: false });
  T = await abrir('u2', { cam: false });
  await Promise.all([H, L, T].map((p) => hasta(p, () => !!document.querySelector('#taller'), null, 30e3)));
  anotar('el panel apareció en los tres');

  // 0 · antes de empezar: cada uno elige el mazo
  await foto(L, '01-alumna-antes-de-empezar');
  await tocar(L, '#taller .tl-mazo[data-v="web"]'); await hasta(L, () => !!document.querySelector('#taller .tl-mazo.on[data-v="web"]'));
  await tocar(T, '#taller .tl-mazo[data-v="propio"]'); await hasta(T, () => !!document.querySelector('#taller .tl-mazo.on[data-v="propio"]'));
  await foto(L, '02-alumna-eligio-mazo-web');
  await espera(2800); await foto(H, '03-hermes-antes-de-empezar');

  // 1 · barajar
  await abrirPaso(1);
  await foto(L, '04-alumna-paso1');
  await tocar(L, '#taller [data-a="barajar"]'); await espera(700); await foto(L, '05-alumna-barajando');
  await hasta(L, () => !!document.querySelector('#taller .tl-btn.hecho'));
  await foto(T, '06-propio-paso1');
  await tocar(T, '#taller [data-a="listo"]'); await hasta(T, () => !!document.querySelector('#taller .tl-btn.hecho'));
  await hasta(H, () => (document.querySelector('#taller .listos')?.textContent || '').startsWith('2 of 2'), null, 15e3)
    .catch(() => fallas.push('Hermes no vio «2 of 2 done» en el paso 1'));
  await foto(H, '07-hermes-paso1-todos-listos');

  // 2 · sacar el año
  await abrirPaso(2);
  await foto(L, '08-alumna-paso2');
  for (let i = 0; i < 12; i++) {
    const n = await cartasEnMesa(L);
    await tocar(L, '#taller [data-a="sacar"]');
    await hasta(L, (n) => document.querySelectorAll('#taller .tl-meses .c img').length > n, n);
    if (i === 4) { await espera(150); await foto(L, '09-alumna-sacando'); }
  }
  await espera(800); await foto(L, '10-alumna-su-anio');
  if (await L.evaluate(() => !!document.querySelector('#taller [data-a="sacar"]'))) fallas.push('después de 12 cartas todavía se puede sacar');
  // Tomás anota dos cartas de su mazo (opcional) y marca Done
  await tocar(T, '#taller [data-a="anotar"][data-v="0"]'); await hasta(T, () => (document.querySelector('#tl-elegir') || { hidden: true }).hidden === false);
  await foto(T, '11-propio-anotar-carta');
  await tocar(T, '#tl-elegir [data-c="XVII"]'); await hasta(T, () => !!document.querySelector('#taller .tl-mes img[src$="/XVII.webp"]'));
  await tocar(T, '#taller [data-a="anotar"][data-v="1"]'); await hasta(T, () => (document.querySelector('#tl-elegir') || { hidden: true }).hidden === false);
  if (!(await T.evaluate(() => document.querySelector('#tl-elegir [data-c="XVII"]')?.disabled))) fallas.push('la carta ya anotada se puede volver a elegir');
  await tocar(T, '#tl-elegir [data-c="C3"]'); await hasta(T, () => !!document.querySelector('#taller .tl-mes img[src$="/C3.webp"]'));
  await foto(T, '12-propio-paso2');
  await tocar(T, '#taller [data-a="listo"]'); await hasta(T, () => !!document.querySelector('#taller .tl-btn.hecho'));
  await espera(2800); await foto(H, '13-hermes-paso2');

  // 3 · elegir el mes
  await abrirPaso(3);
  await tocar(L, '#taller [data-a="mes"][data-v="4"]'); await hasta(L, () => !!document.querySelector('#taller .tl-mes.elegido'));
  await foto(L, '14-alumna-eligio-mayo');
  await tocar(T, '#taller [data-a="mes"][data-v="1"]'); await hasta(T, () => !!document.querySelector('#taller .tl-mes.elegido'));
  await foto(T, '15-propio-eligio-febrero');

  // 4 · la carta nueva (a cara vista)
  await abrirPaso(4);
  await foto(L, '16-alumna-paso4');
  await tocar(L, '#taller [data-a="elegir"]'); await hasta(L, () => (document.querySelector('#tl-elegir') || { hidden: true }).hidden === false);
  await foto(L, '17-alumna-elige-carta');
  const nueva = await L.evaluate(() => ['XIX', 'XVII', 'III', 'C10', 'P10', 'W1'].find((id) => !document.querySelector(`#tl-elegir [data-c="${id}"]`)?.disabled));
  await tocar(L, `#tl-elegir [data-c="${nueva}"]`); await hasta(L, () => !!document.querySelector('#taller .lado.nueva img'));
  await foto(L, '18-alumna-carta-nueva');
  await foto(T, '19-propio-paso4');
  await foto(H, '19b-hermes-paso4');
  await tocar(T, '#taller [data-a="listo"]'); await hasta(T, () => !!document.querySelector('#taller .tl-btn.hecho'));

  // 5 · como es arriba es abajo
  await abrirPaso(5);
  await foto(L, '20-alumna-paso5');
  await foto(T, '21-propio-paso5');
  await espera(2800); await foto(H, '22-hermes-paso5');
  const fin = await L.evaluate(() => ({ texto: document.querySelector('#taller .tl-ind')?.textContent, mayo: document.querySelector('#taller .tl-mes.elegido img')?.getAttribute('src') }));
  anotar('paso 5 de Lucía: ' + JSON.stringify(fin));
  if (!fin.mayo?.endsWith(`/${nueva}.webp`)) fallas.push('en el paso 5 mayo no tiene la carta nueva');

  // plegar el panel: el video queda grande
  await tocar(L, '#taller [data-a="plegar"]'); await foto(L, '23-alumna-panel-plegado'); await tocar(L, '#taller [data-a="plegar"]');
  // en la computadora
  await H.setViewport(PC); await L.setViewport(PC); await espera(1500);
  await foto(H, '24-hermes-computadora'); await foto(L, '25-alumna-computadora');
} catch (e) {
  fallas.push(e.message); anotar('ERROR: ' + e.stack);
  for (const [p, n] of [[H, 'hermes'], [L, 'lucia'], [T, 'tomas']]) if (p) await foto(p, 'zz-error-' + n).catch(() => {});
} finally { await browser.close().catch(() => {}); }
const errores = await fetch(BASE + '/debug/errores').then((r) => r.json()).catch(() => []);
writeFileSync(`${OUT}/registro.txt`, registro.join('\n') + '\n\nErrores de la API:\n' + JSON.stringify(errores, null, 1) + '\n\nFallas:\n' + fallas.join('\n') + '\n');
if (fallas.length) { console.error('FALLÓ:\n' + fallas.join('\n')); process.exit(1); }
console.log('OK');
