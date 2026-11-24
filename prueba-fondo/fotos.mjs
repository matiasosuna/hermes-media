// Prueba del fondo de la cámara de la sala (tarot-web, 24/11/2026), sin gente real: la sala real con D1 en memoria y el
// Realtime de PREVIEW (prueba-sala/server.mjs). El anfitrión tiene de cámara un video de una persona (generado con IA);
// prende el fondo en el lobby, entra, y una alumna entra y lo ve. Capturas en tamaño celular (390×844 @2x) y números:
// ms por cuadro del efecto, qué track se manda y qué resolución le llega a la alumna. Nada toca producción.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8798', CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const OUT = process.env.OUT || 'fotos', VIDEO = process.env.VIDEO || '';
mkdirSync(OUT, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const registro = [], datos = {};
const anotar = (s) => { console.log(s); registro.push(s); };

async function abrir(quien, movil = true) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      ...(VIDEO && quien === 'owner' ? [`--use-file-for-fake-video-capture=${VIDEO}`] : []),
      '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage();
  await page.setViewport(movil ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 800 });
  page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) anotar(`[${quien}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => anotar(`[${quien}] pageerror: ${e.message}`));
  await page.goto(`${BASE}/entrar-como?u=${quien}`, { waitUntil: 'domcontentloaded', timeout: 90e3 });
  await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, { timeout: 90e3 });
  return { browser, page };
}
const foto = async (page, nombre) => { await page.screenshot({ path: `${OUT}/${nombre}.png` }); anotar(`foto ${nombre}`); };
const tocar = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const motor = (page) => page.evaluate(() => ({ vivo: !!S.motor?.vivo, ms: S.motor?.ms ?? null, fps: S.motor?.fps ?? null, fondo: S.fondo,
  manda: S.pub.video ? (S.pub.video.sender.track === S.motor?.track ? 'efecto' : S.pub.video.sender.track === S.video ? 'camara' : String(S.pub.video.sender.track)) : 'nada' }));
async function hastaMotor(page, ms = 90e3) {
  const t0 = Date.now();
  await page.waitForFunction(() => S.motor?.vivo && !S.fondoCargando, { timeout: ms, polling: 200 });
  return Date.now() - t0;
}
async function recibido(page) { // lo que le llega a la alumna del video del anfitrión
  return page.evaluate(async () => {
    const st = await S.pc.getStats(); const r = [];
    st.forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'video' && x.framesDecoded > 0) r.push({ w: x.frameWidth, h: x.frameHeight, fps: x.framesPerSecond, cuadros: x.framesDecoded }); });
    return r;
  });
}

let fallo = null;
const A = await abrir('owner');
try {
  datos.puede = await A.page.evaluate(() => window.SalaFondo?.puede());
  datos.boton = await A.page.evaluate(() => !document.querySelector('#lob-fondo').hidden);
  anotar(`puede: ${datos.puede}, botón: ${datos.boton}`);
  await espera(2500); await foto(A.page, '01-lobby');
  await tocar(A.page, '#lob-fondo'); await espera(800); await foto(A.page, '02-panel');
  await tocar(A.page, '.fx-op[data-f="fuerte"]');
  datos.cargaMs = await hastaMotor(A.page); anotar(`efecto listo en ${datos.cargaMs} ms (primera vez: baja MediaPipe)`);
  await espera(2500); await foto(A.page, '03-desenfoque');
  await A.page.evaluate(() => document.querySelector('#fondos').scrollTo(0, 0));
  const imgs = await A.page.evaluate(() => (M.fondos || []).map((f) => f.id));
  anotar(`imágenes: ${imgs.join(', ')}`);
  if (imgs[0]) { await tocar(A.page, `.fx-op[data-f="${imgs[0]}"]`); await espera(2500); await foto(A.page, '04-imagen'); }
  await tocar(A.page, '.fx-op[data-f="suave"]'); await espera(2000); await foto(A.page, '05-suave');
  datos.motorLobby = await motor(A.page); anotar('lobby: ' + JSON.stringify(datos.motorLobby));
  if (imgs[1]) await tocar(A.page, `.fx-op[data-f="${imgs[1]}"]`);
  await tocar(A.page, '#fx-x'); await espera(500); await foto(A.page, '06-lobby-con-fondo');
  await tocar(A.page, '#entrar');
  await A.page.waitForFunction(() => S.sid && S.pc?.connectionState === 'connected', { timeout: 90e3 });
  await espera(2000);
  datos.motorLlamada = await motor(A.page); anotar('anfitrión en la sala: ' + JSON.stringify(datos.motorLlamada));

  const B = await abrir('u1');
  try {
    await tocar(B.page, '#entrar');
    await B.page.waitForFunction(() => S.sid && S.pc?.connectionState === 'connected', { timeout: 90e3 });
    await B.page.waitForFunction(() => [...S.tiles.values()].some((t) => t.g && !t.g.yo && t.video?.videoWidth > 0), { timeout: 60e3, polling: 300 });
    await espera(4000);
    datos.alumnaRecibe = await recibido(B.page); anotar('alumna recibe: ' + JSON.stringify(datos.alumnaRecibe));
    await foto(B.page, '07-alumna-ve-imagen');
    // cambio en plena llamada: sin renegociar (mismo track)
    await tocar(A.page, '#b-fondo'); await espera(600);
    await tocar(A.page, '.fx-op[data-f="fuerte"]'); await espera(3000);
    await foto(A.page, '08-anfitrion-panel-llamada');
    await foto(B.page, '09-alumna-ve-desenfoque');
    await tocar(A.page, '#fx-x');
    // apagar y prender la cámara: a la alumna nunca le llega la cámara sin el fondo
    await tocar(A.page, '#b-cam'); await espera(1500);
    const apagada = await motor(A.page);
    await tocar(A.page, '#b-cam');
    const muestras = [];
    for (let i = 0; i < 20; i++) { muestras.push((await motor(A.page)).manda); await espera(100); }
    await hastaMotor(A.page, 30e3); await espera(2500);
    datos.camOffOn = { apagada, muestras, despues: await motor(A.page) };
    anotar('cámara apagar/prender: ' + JSON.stringify(datos.camOffOn));
    if (muestras.includes('camara')) fallo = new Error('al prender la cámara se mandó la cámara sin el fondo');
    await foto(B.page, '10-alumna-tras-prender');
    await foto(A.page, '11-anfitrion-llamada');
    // sin fondo: vuelve la cámara tal cual
    await tocar(A.page, '#b-fondo'); await espera(500); await tocar(A.page, '.fx-op[data-f=""]'); await espera(2500);
    datos.sinFondo = await motor(A.page); anotar('sin fondo: ' + JSON.stringify(datos.sinFondo));
    if (datos.sinFondo.manda !== 'camara') fallo = new Error('sin fondo no volvió la cámara: ' + datos.sinFondo.manda);
    await foto(B.page, '12-alumna-ve-sin-fondo');
  } finally { await B.browser.close().catch(() => {}); }
  if (datos.motorLlamada.manda !== 'efecto') fallo = new Error('en la sala no se manda el efecto: ' + datos.motorLlamada.manda);
  if (!datos.alumnaRecibe.length) fallo = new Error('a la alumna no le llegó video');
} catch (e) { fallo = e; anotar('ERROR: ' + e.stack); await foto(A.page, 'zz-error').catch(() => {}); }
finally { await A.browser.close().catch(() => {}); }
writeFileSync(`${OUT}/datos.json`, JSON.stringify(datos, null, 2));
writeFileSync(`${OUT}/registro.txt`, registro.join('\n') + '\n');
if (fallo) { console.error('FALLÓ: ' + fallo.message); process.exit(1); }
console.log('OK');
