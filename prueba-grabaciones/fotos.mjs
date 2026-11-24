// Capturas en tamaño celular de Recordings › Yours (servidor de prueba: server.mjs). Hermes asigna desde la página; cada cuenta
// mira la suya. Escribe OUT/*.png y OUT/resultado.json; sale con código 1 si algo no dio lo esperado.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8799', OUT = process.env.OUT || 'fotos';
mkdirSync(OUT, { recursive: true });
const { ids } = await (await fetch(BASE + '/debug/ids')).json();
const pasos = [], fallas = [];
const chequear = (ok, que) => { pasos.push({ ok: !!ok, que }); console.log(ok ? '✓' : '✗', que); if (!ok) fallas.push(que); };
const nav = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pagina(u) {
  const ctx = await nav.createBrowserContext();
  const p = await ctx.newPage();
  await p.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: IPHONE });
  p.on('console', (m) => { if (m.type() === 'error') console.log(`  [${u}] consola: ${m.text()}`); });
  p.on('pageerror', (e) => chequear(false, `${u}: error de JS: ${e.message}`));
  await p.goto(`${BASE}/entrar-como?u=${u}`, { waitUntil: 'networkidle0' });
  await p.waitForFunction(() => { const l = document.getElementById('lista'); return l && !/Loading/.test(l.textContent); }, { timeout: 15000 });
  await p.evaluate(() => document.fonts.ready);
  return p;
}
const api = (p) => p.evaluate(() => fetch('/api/club/grabaciones', { credentials: 'same-origin' }).then((r) => r.json()));
const foto = async (p, n, fullPage = true) => { await dormir(500); await p.screenshot({ path: `${OUT}/${n}.png`, fullPage }); };
const yours = (p) => p.evaluate(() => document.getElementById('tuyas')?.innerText ?? null);
const ordenSecciones = (p) => p.evaluate(() => [...document.querySelectorAll('#lista > .grupo > h2')].map((h) => h.textContent));
async function escuchar(p, id, quien) {
  await p.click(`#g-${id} summary`);
  await p.waitForSelector(`#g-${id} .aud audio`, { visible: true });
  await p.evaluate((id) => document.querySelector(`#g-${id} .aud audio`).play(), id);
  await dormir(3000);
  const t = await p.evaluate((id) => document.querySelector(`#g-${id} .aud audio`).currentTime, id);
  chequear(t > 1.5, `${quien}: el audio suena (${t.toFixed(1)} s)`);
  await p.evaluate((id) => document.getElementById('g-' + id).scrollIntoView({ block: 'center' }), id);
}
async function asignar(p, id, tipo, titulo, busca, quien) {
  const g = `#g-${id}`;
  await p.click(`${g} summary`);
  await p.waitForSelector(`${g} .edit select`, { visible: true });
  await p.select(`${g} .edit select`, tipo);
  if (titulo) { await p.$eval(`${g} .edit label:first-child input`, (e) => { e.value = ''; }); await p.type(`${g} .edit label:first-child input`, titulo); }
  await p.type(`${g} .persona input[type=search]`, busca);
  await p.waitForSelector(`${g} .persona .per`, { visible: true, timeout: 5000 });
  await p.evaluate((g) => document.querySelector(g + ' .persona').scrollIntoView({ block: 'center' }), g);
  await foto(p, `admin-eligiendo-${quien}`, false);
  await p.click(`${g} .persona .per`);
  await p.click(`${g} .edit > button`);
  await p.waitForFunction((id) => { const s = document.getElementById('tuyas'); return s && s.querySelector('#g-' + id); }, { timeout: 8000 }, id);
}

try {
  // 1. Antes: la reading de hoy (solo audio, «Q&A gratis» por error) no la ve ninguna alumna
  const mia0 = await pagina('mia');
  const d0 = await api(mia0);
  chequear(!d0.grabaciones.some((g) => g.id === ids.reading) && !d0.privadas.length, 'antes de asignarla: Mia no la ve (ni en la biblioteca)');
  await mia0.browserContext().close();

  // 2. Hermes la pasa a Reading para Mia, y la clase privada a Leo (cuenta gratis), desde la página
  const admin = await pagina('owner');
  await foto(admin, 'admin-antes');
  await asignar(admin, ids.reading, 'reading', 'Reading with Hermes', 'mia', 'mia');
  await asignar(admin, ids.clase, 'privada', '', 'leo@', 'leo');
  await admin.evaluate(() => window.scrollTo(0, 0));
  await foto(admin, 'admin-private');
  const da = await api(admin);
  const ra = da.privadas.find((g) => g.id === ids.reading), ca = da.privadas.find((g) => g.id === ids.clase);
  chequear(ra?.para === 'mia-1' && ra.paraNombre === 'Mia Test' && ra.tipo === 'reading', 'admin: la reading queda para Mia');
  chequear(ca?.para === 'leo-1' && ca.tipo === 'privada', 'admin: la clase privada queda para Leo');
  chequear(!da.grabaciones.some((g) => [ids.reading, ids.clase].includes(g.id)), 'admin: ya no están en la biblioteca');
  chequear((await ordenSecciones(admin))[0] === 'Private', 'admin: «Private» arriba de todo');
  await admin.browserContext().close();

  // 3. Mia: «Yours» arriba, solo la suya, y la escucha
  const mia = await pagina('mia');
  const dm = await api(mia);
  chequear(dm.privadas.length === 1 && dm.privadas[0].id === ids.reading && dm.privadas[0].audio, 'Mia: en «Yours» está solo su reading');
  chequear(!dm.grabaciones.some((g) => [ids.reading, ids.clase].includes(g.id)), 'Mia: no está en la biblioteca (ni la clase de Leo)');
  chequear((await ordenSecciones(mia))[0] === 'Yours', 'Mia: «Yours» arriba de todo');
  const ty = await yours(mia);
  chequear(/Reading with Hermes/.test(ty) && /Only you can see these/.test(ty) && !/The Fool/.test(ty), 'Mia: se ve «Reading with Hermes» y «Only you can see these.»');
  await foto(mia, 'mia-yours');
  await escuchar(mia, ids.reading, 'Mia');
  await foto(mia, 'mia-escuchando', false);
  const link = dm.privadas[0].video;
  await mia.browserContext().close();

  // 4. Ana (otra alumna): nada de eso
  const ana = await pagina('ana');
  const dn = await api(ana);
  chequear(!dn.privadas.length && (await yours(ana)) === null, 'Ana: sin «Yours»');
  chequear(!JSON.stringify(dn).includes(`g${ids.reading}.`) && !JSON.stringify(dn).includes(`g${ids.clase}.`), 'Ana: no le llega ningún link de esas dos');
  await foto(ana, 'ana');
  await ana.browserContext().close();

  // 5. Leo (sin Mentoring): su clase privada sin candado; lo demás con candado
  const leo = await pagina('leo');
  const dl = await api(leo);
  chequear(dl.privadas.length === 1 && dl.privadas[0].id === ids.clase, 'Leo: en «Yours» está solo su clase');
  chequear(dl.grabaciones.every((g) => g.bloqueada), 'Leo: el resto, con candado');
  await foto(leo, 'leo');
  await escuchar(leo, ids.clase, 'Leo');
  await leo.browserContext().close();

  // 6. El link firmado: sin firma o cambiado, no anda
  const roto = link.replace(/s=[0-9a-f]{4}/, 's=0000');
  chequear((await fetch(link)).status === 200 && (await fetch(roto)).status === 403 && (await fetch(link.split('?')[0])).status === 403, 'el audio solo con su link firmado');
} catch (e) {
  chequear(false, 'se cortó la prueba: ' + e.message);
}
writeFileSync(`${OUT}/resultado.json`, JSON.stringify({ ids, pasos }, null, 2));
await nav.close();
console.log(fallas.length ? `\n${fallas.length} falla(s)` : '\nTodo bien');
process.exit(fallas.length ? 1 : 0);
