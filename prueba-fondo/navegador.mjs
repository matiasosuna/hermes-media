// El fondo de la cámara en otros navegadores (24/11/2026): el anfitrión en WebKit (motor de Safari, como iPhone) o Firefox,
// la alumna en Chromium. La cámara es falsa pero con una persona: un canvas con persona.jpg moviéndose (sirve igual en todos).
// Mide si el botón aparece, si el efecto arranca, cuánto tarda y si a la alumna le llega la imagen (no negra). Nada de producción:
// la sala de prueba (prueba-sala/server.mjs, D1 en memoria, Realtime de preview).
import { chromium, webkit, firefox, devices } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const NAV = process.env.NAV || 'webkit', BASE = process.env.BASE || 'http://127.0.0.1:8798';
const OUT = process.env.OUT || `fotos-${NAV}`; mkdirSync(OUT, { recursive: true });
const FOTO = readFileSync(process.env.FOTO || 'persona-640.jpg').toString('base64');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const registro = [], datos = { nav: NAV };
const anotar = (s) => { console.log(s); registro.push(s); };

// cámara y micrófono falsos dentro de la página (antes de que cargue la sala)
function camaraFalsa(foto) {
  let img = null;
  const cargar = () => (img ||= new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/jpeg;base64,' + foto; }));
  const md = navigator.mediaDevices || (navigator.mediaDevices = {});
  md.getUserMedia = async (c = {}) => {
    const pistas = [];
    if (c.video) {
      const im = await cargar(), cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
      cv.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      (document.body || document.documentElement).append(cv);
      const x = cv.getContext('2d'), t0 = performance.now();
      const dibujar = () => { const t = (performance.now() - t0) / 1000; x.drawImage(im, -32 - 28 * Math.sin(2 * Math.PI * t / 5), -18 - 8 * Math.sin(2 * Math.PI * t / 3), 704, 396); };
      dibujar(); const iv = setInterval(dibujar, 66);
      const v = cv.captureStream(15).getVideoTracks()[0];
      const stop = v.stop.bind(v); v.stop = () => { clearInterval(iv); cv.remove(); stop(); };
      pistas.push(v);
    }
    if (c.audio) {
      const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain(), d = ac.createMediaStreamDestination();
      g.gain.value = 0.02; o.connect(g); g.connect(d); o.start(); pistas.push(d.stream.getAudioTracks()[0]);
    }
    return new MediaStream(pistas);
  };
  md.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'falsa', label: 'Falsa', groupId: 'g' }, { kind: 'audioinput', deviceId: 'mic', label: 'Mic', groupId: 'g' }];
}

async function abrir(quien, tipo, opcCtx) {
  const browser = await tipo.launch({ headless: true, args: tipo === chromium ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] : [] });
  const ctx = await browser.newContext(opcCtx);
  if (tipo !== chromium) await ctx.addInitScript(camaraFalsa, FOTO);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/club-app\.js|404/.test(m.text())) anotar(`[${quien}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => anotar(`[${quien}] pageerror: ${e.message}`));
  await page.goto(`${BASE}/entrar-como?u=${quien}`, { waitUntil: 'domcontentloaded', timeout: 90e3 });
  await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, null, { timeout: 90e3 });
  return { browser, page };
}
const foto = async (page, n) => { await page.screenshot({ path: `${OUT}/${NAV}-${n}.png` }); anotar('foto ' + n); };
const tocar = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const motor = (page) => page.evaluate(() => ({ vivo: !!S.motor?.vivo, ms: S.motor?.ms ?? null, fps: S.motor?.fps ?? null, forma: S.motor?.forma ?? null, fondo: S.fondo,
  manda: ((tr) => (!S.pub.video ? 'sin-publicar' : !tr ? 'nada' : tr === S.motor?.track ? 'efecto' : tr === S.video ? 'camara' : 'otro'))(S.pub.video?.sender.track) }));
const hastaMotor = (page, ms = 120e3) => page.waitForFunction(() => S.motor?.vivo && !S.fondoCargando, null, { timeout: ms, polling: 250 });

const tipoHost = { webkit, firefox, chromium }[NAV];
// (sin «permissions»: la cámara la da camaraFalsa, y WebKit no acepta ese permiso)
const ctxHost = NAV === 'webkit' ? { ...devices['iPhone 13'] }
  : NAV === 'firefox' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
  : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
let fallo = null;
const A = await abrir('owner', tipoHost, ctxHost);
try {
  datos.ua = await A.page.evaluate(() => navigator.userAgent);
  datos.soporte = await A.page.evaluate(() => {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2');
    return { webgl2: !!gl, renderer: gl ? gl.getParameter(gl.RENDERER) : null, captureStream: typeof c.captureStream, rvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
      puede: window.SalaFondo?.puede(), boton: !document.querySelector('#lob-fondo').hidden };
  });
  anotar('soporte: ' + JSON.stringify(datos.soporte));
  await espera(1500); await foto(A.page, '01-lobby');
  if (!datos.soporte.boton) throw new Error('el botón del fondo no aparece en ' + NAV);
  await tocar(A.page, '#lob-fondo'); await espera(600);
  await tocar(A.page, '.fx-op[data-f="fuerte"]');
  const t0 = Date.now(); await hastaMotor(A.page); datos.cargaMs = Date.now() - t0;
  await espera(3000); await foto(A.page, '02-desenfoque');
  datos.desenfoque = await motor(A.page); anotar('desenfoque: ' + JSON.stringify(datos.desenfoque));
  await tocar(A.page, '.fx-op[data-f="biblioteca"]'); await espera(3000); await foto(A.page, '03-imagen');
  datos.imagen = await motor(A.page); anotar('imagen: ' + JSON.stringify(datos.imagen));
  await tocar(A.page, '#fx-x'); await tocar(A.page, '#entrar');
  await A.page.waitForFunction(() => S.sid && S.pc?.connectionState === 'connected', null, { timeout: 90e3 });
  await espera(2000);
  datos.enLaSala = await motor(A.page); anotar('en la sala: ' + JSON.stringify(datos.enLaSala));

  const B = await abrir('u1', chromium, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  try {
    await tocar(B.page, '#entrar');
    await B.page.waitForFunction(() => S.sid && S.pc?.connectionState === 'connected', null, { timeout: 90e3 });
    await B.page.waitForFunction(() => [...S.tiles.values()].some((t) => t.g && !t.g.yo && t.video?.videoWidth > 0), null, { timeout: 60e3, polling: 300 });
    await espera(5000);
    // lo que le llega a la alumna: cuadros, tamaño y si la imagen tiene algo (no negra ni lisa)
    datos.alumna = await B.page.evaluate(async () => {
      const st = await S.pc.getStats(); const r = [];
      st.forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'video' && x.framesDecoded > 0) r.push({ w: x.frameWidth, h: x.frameHeight, fps: x.framesPerSecond, cuadros: x.framesDecoded }); });
      const t = [...S.tiles.values()].find((t) => t.g && !t.g.yo && t.video?.videoWidth > 0);
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.drawImage(t.video, 0, 0, 160, 90);
      const d = x.getImageData(0, 0, 160, 90).data; let s = 0, s2 = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; }
      const n = d.length / 4, media = s / n;
      return { recibe: r, luz: Math.round(media), variacion: Math.round(Math.sqrt(s2 / n - media * media)) };
    });
    anotar('alumna: ' + JSON.stringify(datos.alumna));
    await foto(B.page, '04-alumna-ve');
    // apagar y prender la cámara: nunca sale la cámara sin el fondo
    await tocar(A.page, '#b-cam'); await espera(1500); await tocar(A.page, '#b-cam');
    const muestras = []; for (let i = 0; i < 25; i++) { muestras.push((await motor(A.page)).manda); await espera(150); }
    await hastaMotor(A.page, 60e3).catch(() => {});
    datos.camOffOn = { muestras: [...new Set(muestras)], despues: await motor(A.page) };
    anotar('cámara apagar/prender: ' + JSON.stringify(datos.camOffOn));
    if (muestras.includes('camara')) fallo = new Error('se mandó la cámara sin el fondo');
    await espera(3000); await foto(B.page, '05-alumna-tras-prender');
  } finally { await B.browser.close().catch(() => {}); }
  if (datos.enLaSala.manda !== 'efecto') fallo ||= new Error('en la sala no se manda el efecto: ' + datos.enLaSala.manda);
  if (!datos.alumna?.recibe?.length) fallo ||= new Error('a la alumna no le llegó video');
  else if (datos.alumna.luz < 15 || datos.alumna.variacion < 8) fallo ||= new Error('a la alumna le llega una imagen negra o lisa');
} catch (e) { fallo = e; anotar('ERROR: ' + e.stack); await foto(A.page, 'zz-error').catch(() => {}); }
finally { await A.browser.close().catch(() => {}); }
datos.fallo = fallo ? fallo.message : null;
writeFileSync(`${OUT}/datos-${NAV}.json`, JSON.stringify(datos, null, 2));
writeFileSync(`${OUT}/registro-${NAV}.txt`, registro.join('\n') + '\n');
if (fallo) { console.error('FALLÓ: ' + fallo.message); process.exit(1); }
console.log('OK');
