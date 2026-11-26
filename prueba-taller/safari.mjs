// La herramienta del taller 12/12 en Safari de iPhone (motor WebKit, en una Mac de GitHub): Hermes en Chromium abre los pasos y
// Lucía, en un iPhone 13 emulado, hace la práctica con el mazo de la web. La misma sala de prueba (prueba-taller/server.mjs: D1 en
// memoria, Realtime de preview); nada toca producción. Capturas del iPhone en cada paso.
import { chromium, webkit, devices } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8799', OUT = process.env.OUT || 'fotos-safari';
mkdirSync(OUT, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const registro = [], fallas = [];
const anotar = (s) => { const l = `${new Date().toISOString().slice(11, 23)} ${s}`; console.log(l); registro.push(l); };

// cámara y micrófono falsos dentro de la página (WebKit no tiene los de Chrome)
function camaraFalsa() {
  const md = navigator.mediaDevices || (navigator.mediaDevices = {});
  md.getUserMedia = async (c = {}) => {
    const pistas = [];
    if (c.video) {
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
      const x = cv.getContext('2d'); x.fillStyle = '#334'; x.fillRect(0, 0, 640, 360);
      const iv = setInterval(() => { x.fillStyle = `hsl(${Date.now() / 40 % 360},30%,30%)`; x.fillRect(0, 0, 640, 360); }, 100);
      const v = cv.captureStream(10).getVideoTracks()[0]; const stop = v.stop.bind(v); v.stop = () => { clearInterval(iv); stop(); };
      pistas.push(v);
    }
    if (c.audio) {
      const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain(), d = ac.createMediaStreamDestination();
      g.gain.value = 0.01; o.connect(g); g.connect(d); o.start(); pistas.push(d.stream.getAudioTracks()[0]);
    }
    return new MediaStream(pistas);
  };
  md.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'falsa', label: 'Falsa', groupId: 'g' }, { kind: 'audioinput', deviceId: 'mic', label: 'Mic', groupId: 'g' }];
}

const navs = [];
async function abrir(quien, tipo, opc, { cam = true } = {}) {
  const browser = await tipo.launch({ headless: true, args: tipo === chromium ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] : [] });
  navs.push(browser);
  const ctx = await browser.newContext(opc);
  if (tipo !== chromium) await ctx.addInitScript(camaraFalsa);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/club-app\.js/.test(m.text())) anotar(`[${quien}] ${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => { anotar(`[${quien}] pageerror: ${e.message}`); fallas.push(`${quien}: ${e.message}`); });
  page.on('response', (r) => { if (r.status() >= 400) anotar(`[${quien}] ${r.status()} ${r.url().replace(BASE, '')}`); });
  await page.goto(`${BASE}/entrar-como?u=${quien}`, { waitUntil: 'domcontentloaded', timeout: 90e3 });
  await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, null, { timeout: 90e3 });
  await espera(1200);
  if (!cam) await page.evaluate(() => { if (S.cam) document.querySelector('#lob-cam').click(); });
  await page.evaluate(() => document.querySelector('#entrar').click());
  await page.waitForFunction(() => document.body.classList.contains('en-llamada') && S.sid, null, { timeout: 90e3, polling: 300 });
  try { await page.waitForFunction(() => S.pc?.connectionState === 'connected', null, { timeout: 45e3, polling: 300 }); }
  catch { anotar(`[${quien}] el video no conectó (sigue la prueba de la herramienta)`); }
  anotar(`[${quien}] en la sala (${tipo.name()})`);
  return page;
}
const foto = async (page, nombre) => { await espera(400); await page.screenshot({ path: `${OUT}/${nombre}.png` }); anotar(`foto ${nombre}`); };
const tocar = async (page, sel) => { await page.locator(sel).first().tap(); }; // un toque de verdad (no .click() por código)
const hasta = (page, fn, arg, ms = 20e3) => page.waitForFunction(fn, arg, { timeout: ms, polling: 200 });
const enPaso = (page, n) => hasta(page, (n) => (document.querySelector('#taller .tl-cab small')?.textContent || '') === `Step ${n} of 5`, n);
// los videos no quedan tapados por el panel: cada cuadro en 16:9 y su nombre adentro de lo que se ve de la grilla
async function videosEnteros(page, cuando) {
  const r = await page.evaluate(() => { const g = document.querySelector('#grilla').getBoundingClientRect();
    return { g: [Math.round(g.top), Math.round(g.bottom)], tiles: [...document.querySelectorAll('#grilla .tile')].map((t) => { const b = t.getBoundingClientRect(), n = t.querySelector('.nombre')?.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), nombreAbajo: n ? Math.round(n.bottom) : null }; }) }; });
  anotar(`videos ${cuando}: ${JSON.stringify(r)}`);
  for (const t of r.tiles) {
    if (Math.abs(t.h - t.w * 9 / 16) > 8) fallas.push(`${cuando}: un video mide ${t.w}×${t.h} (no 16:9)`);
    if (t.nombreAbajo != null && t.nombreAbajo > r.g[1] + 1) fallas.push(`${cuando}: el panel tapa un nombre`);
  }
}

let H, L;
try {
  H = await abrir('owner', chromium, { viewport: { width: 1280, height: 800 } });
  L = await abrir('u1', webkit, { ...devices['iPhone 13'] }, { cam: false });
  await hasta(L, () => !!document.querySelector('#taller .tl-mazos'), null, 30e3);
  await espera(2500); await foto(L, 's01-iphone-antes-de-empezar'); await videosEnteros(L, 'antes de empezar');
  await tocar(L, '#taller .tl-mazo[data-v="web"]'); await hasta(L, () => !!document.querySelector('#taller .tl-mazo.on[data-v="web"]'));
  const abrirPaso = async (n) => { await H.locator('#taller [data-a="abrir"]').click(); await enPaso(H, n); await enPaso(L, n); await espera(300); };

  await abrirPaso(1);
  await tocar(L, '#taller [data-a="barajar"]'); await espera(700); await foto(L, 's02-iphone-barajando');
  await hasta(L, () => !!document.querySelector('#taller .tl-btn.hecho'));

  await abrirPaso(2);
  for (let i = 0; i < 12; i++) {
    const n = await L.evaluate(() => document.querySelectorAll('#taller .tl-meses .c img').length);
    await tocar(L, '#taller [data-a="sacar"]');
    await hasta(L, (n) => document.querySelectorAll('#taller .tl-meses .c img').length > n, n);
  }
  await espera(800); await foto(L, 's03-iphone-su-anio'); await videosEnteros(L, 'paso 2');

  await abrirPaso(3);
  await tocar(L, '#taller [data-a="mes"][data-v="2"]'); await hasta(L, () => !!document.querySelector('#taller .tl-mes.elegido'));
  await foto(L, 's04-iphone-eligio-marzo');

  await abrirPaso(4);
  await tocar(L, '#taller [data-a="elegir"]'); await hasta(L, () => (document.querySelector('#tl-elegir') || { hidden: true }).hidden === false);
  await foto(L, 's05-iphone-elegir');
  await tocar(L, '#tl-elegir [data-ir="2"]'); await espera(600); await foto(L, 's06-iphone-elegir-copas');
  await espera(500); const visible = await L.evaluate(() => { const h = document.querySelector('#tl-g2'), l = document.querySelector('#tl-elegir .lista'); return Math.abs(h.getBoundingClientRect().top - l.getBoundingClientRect().top) < 40; });
  if (!visible) fallas.push('el atajo «Cups» no llevó a las copas');
  const nueva = await L.evaluate(() => ['C10', 'C2', 'C6', 'C9', 'C1'].find((id) => !document.querySelector(`#tl-elegir [data-c="${id}"]`)?.disabled));
  await tocar(L, `#tl-elegir [data-c="${nueva}"]`); await hasta(L, () => !!document.querySelector('#taller .lado.nueva img'));
  await foto(L, 's07-iphone-carta-nueva');

  await abrirPaso(5);
  await foto(L, 's08-iphone-paso5'); await videosEnteros(L, 'paso 5');
  const marzo = await L.evaluate(() => document.querySelector('#taller .tl-mes.elegido img')?.getAttribute('src'));
  if (!marzo?.endsWith(`/${nueva}.webp`)) fallas.push('en el paso 5 marzo no tiene la carta nueva');
  await tocar(L, '#taller [data-a="plegar"]'); await foto(L, 's09-iphone-plegado');
} catch (e) {
  fallas.push(e.message); anotar('ERROR: ' + e.stack);
  for (const [p, n] of [[H, 'hermes'], [L, 'lucia']]) if (p) await foto(p, 'zz-error-' + n).catch(() => {});
} finally { for (const b of navs) await b.close().catch(() => {}); }
writeFileSync(`${OUT}/registro.txt`, registro.join('\n') + '\n\nFallas:\n' + fallas.join('\n') + '\n');
if (fallas.length) { console.error('FALLÓ:\n' + fallas.join('\n')); process.exit(1); }
console.log('OK');
