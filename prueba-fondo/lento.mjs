// Teléfonos lentos (24/11/2026): la CPU de Chrome frenada x1, x3, x6 y x10 (DevTools), con la cámara apaisada y parada.
// Por cada caso: ms por cuadro del efecto, cuadros por segundo, qué modelo usó y si saltó el aviso de «equipo lento»
// (se saca el fondo y se apaga la cámara). Lo que importa: que en un equipo medio ande, y que en uno muy lento se apague
// solo sin trabar la página ni mandar la cámara sin el fondo. Sala de prueba, nada de producción.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8798', CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const OUT = process.env.OUT || 'fotos-lento'; mkdirSync(OUT, { recursive: true });
const CAMARAS = { apaisada: process.env.VIDEO, parada: process.env.VIDEO_V };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const filas = [];

async function caso(camara, x) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${CAMARAS[camara]}`,
      '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const fila = { camara, cpu: 'x' + x };
  try {
    const page = await browser.newPage();
    // teléfono parado: la cámara entrega 360×640 como un teléfono de verdad (sin esto, Chrome la recorta a 360×360 por la
    // forma que pide la sala, y se probaría el modelo apaisado)
    if (camara === 'parada') await page.evaluateOnNewDocument(() => {
      const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md);
      md.getUserMedia = (c = {}) => orig(c.video ? { ...c, video: true } : c);
    });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const avisos = []; page.on('console', (m) => { if (/^\[fondo\]/.test(m.text())) avisos.push(m.text()); });
    await page.goto(`${BASE}/entrar-como?u=owner`, { waitUntil: 'domcontentloaded', timeout: 90e3 });
    await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, { timeout: 90e3 });
    await page.evaluate(() => document.querySelector('#lob-fondo').click()); await espera(500);
    await page.emulateCPUThrottling(x);
    const t0 = Date.now();
    await page.evaluate(() => document.querySelector('.fx-op[data-f="fuerte"]').click());
    await page.waitForFunction(() => (S.motor?.vivo && !S.fondoCargando) || !S.fondo, { timeout: 120e3, polling: 300 });
    fila.cargaMs = Date.now() - t0;
    // 12 s con el efecto andando (el aviso de lento salta a los ~2 s de promedio alto + 3 s seguidos)
    const muestras = [];
    for (let i = 0; i < 24; i++) { muestras.push(await page.evaluate(() => ({ ms: S.motor?.ms ?? null, fps: S.motor?.fps ?? null, seg: S.motor?.msSeg ?? null, medias: !!S.motor?.medias }))); await espera(500); }
    const fin = await page.evaluate(() => ({ forma: S.motor?.forma ?? null, fondo: S.fondo, cam: S.cam, vivo: !!S.motor?.vivo,
      tam: S.video ? `${S.video.getSettings().width}x${S.video.getSettings().height}` : null, aviso: document.querySelector('#flotante')?.hidden === false ? document.querySelector('#flotante').textContent : '' }));
    const ms = muestras.map((m) => m.ms).filter((v) => v != null), fps = muestras.map((m) => m.fps).filter((v) => v != null), seg = muestras.map((m) => m.seg).filter((v) => v != null);
    fila.msSegMedio = seg.length ? Math.round(seg.reduce((a, b) => a + b) / seg.length) : null; fila.aMedias = muestras.some((m) => m.medias);
    Object.assign(fila, { msMedio: ms.length ? Math.round(ms.reduce((a, b) => a + b) / ms.length) : null, fpsMedio: fps.length ? Math.round(fps.reduce((a, b) => a + b) / fps.length * 10) / 10 : null,
      ...fin, saltoLento: avisos.includes('[fondo] fondoLento'), avisos });
    await page.emulateCPUThrottling(1);
    await page.screenshot({ path: `${OUT}/lento-${camara}-x${x}.png` });
  } catch (e) { fila.error = e.message; }
  finally { await browser.close().catch(() => {}); }
  console.log(JSON.stringify(fila)); filas.push(fila);
}

for (const camara of ['apaisada', 'parada']) for (const x of [1, 3, 6, 10]) await caso(camara, x);
writeFileSync(`${OUT}/lento.json`, JSON.stringify(filas, null, 2));
// lo que no puede pasar: con el aviso de lento, quedar con el fondo puesto o la cámara prendida
const mal = filas.filter((f) => f.error || (f.saltoLento && (f.fondo || f.cam)));
if (mal.length) { console.error('FALLÓ: ' + JSON.stringify(mal)); process.exit(1); }
console.log('OK');
