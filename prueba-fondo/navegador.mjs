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
const anotar = (s) => { const l = `${new Date().toISOString().slice(11, 23)} ${s}`; console.log(l); registro.push(l); };

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
  // Firefox sin placa de video (la máquina de GitHub) apaga WebGL2 y el botón no aparece, que es lo correcto; para probar el
  // efecto igual se lo fuerza a usar WebGL por software (en una computadora o teléfono de verdad, WebGL2 viene prendido)
  // WebKit y Firefox con ventana (pantalla virtual xvfb, como un navegador de verdad); Chromium de la alumna sin ventana
  const browser = await tipo.launch({ headless: tipo === chromium || !process.env.DISPLAY, args: tipo === chromium ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] : [],
    ...(tipo === firefox ? { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false, 'webgl.enable-webgl2': true } } : {}) });
  const ctx = await browser.newContext(opcCtx);
  if (tipo !== chromium) await ctx.addInitScript(camaraFalsa, FOTO);
  // el aviso de «equipo lento» se anota pero no se aplica: acá se prueba que el efecto ande en este navegador; la velocidad
  // de esta máquina (sin placa de video) no es la de un teléfono, y se informa aparte (ms por cuadro)
  if (quien === 'owner') await ctx.addInitScript(() => {
    let sf;
    Object.defineProperty(window, 'SalaFondo', { configurable: true, get: () => sf, set: (v) => {
      const crear = v.crear;
      v.crear = (f, o = {}) => crear(f, { ...o, alLento: () => { (window.__lentos ||= []).push(Math.round(performance.now())); console.warn('[prueba] lento (anotado, no aplicado)'); } });
      sf = v;
    } });
  });
  const page = await ctx.newPage();
  // del anfitrión en WebKit/Firefox se anota todo (MediaPipe avisa por consola en qué paso va)
  page.on('console', (m) => { if ((['error', 'warning'].includes(m.type()) || (quien === 'owner' && tipo !== chromium)) && !/club-app\.js|404/.test(m.text())) anotar(`[${quien}] ${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => anotar(`[${quien}] pageerror: ${e.message}`));
  await page.goto(`${BASE}/entrar-como?u=${quien}`, { waitUntil: 'domcontentloaded', timeout: 90e3 });
  await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, null, { timeout: 90e3 });
  return { browser, page };
}
const foto = async (page, n) => { await page.screenshot({ path: `${OUT}/${NAV}-${n}.png` }); anotar('foto ' + n); };
const tocar = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const motor = (page) => page.evaluate(() => ({ vivo: !!S.motor?.vivo, ms: S.motor?.ms ?? null, msSeg: S.motor?.msSeg ?? null, medias: !!S.motor?.medias, lentos: (window.__lentos || []).length, fps: S.motor?.fps ?? null, forma: S.motor?.forma ?? null, fondo: S.fondo,
  manda: ((tr) => (!S.pub.video ? 'sin-publicar' : !tr ? 'nada' : tr === S.motor?.track ? 'efecto' : tr === S.video ? 'camara' : 'otro'))(S.pub.video?.sender.track) }));
// espera a que el efecto ande o a que la sala lo saque (aviso de error o de equipo lento)
const hastaMotor = (page, ms = 120e3) => page.waitForFunction(() => (S.motor?.vivo && !S.fondoCargando) || !S.fondo, null, { timeout: ms, polling: 250 });
// si no arrancó: paso por paso, cuál se cuelga (cargar MediaPipe, play del video, avisos de cuadros, crear)
const diagnostico = (page) => page.evaluate(async () => {
  const r = {}, t = (p, ms) => Promise.race([Promise.resolve(p).then(() => 'ok', (e) => 'error: ' + (e?.message || e)), new Promise((ok) => setTimeout(() => ok('colgado'), ms))]);
  let t0 = performance.now(); r.cargar = await t(SalaFondo.cargar('apaisado'), 60e3); r.cargarMs = Math.round(performance.now() - t0);
  // cámara de prueba propia (un canvas que cambia): no depende de getUserMedia ni de la cámara de la sala, que quedó apagada
  const fc = document.createElement('canvas'); fc.width = 640; fc.height = 360; fc.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0'; document.body.append(fc);
  const fx = fc.getContext('2d'); let k = 0;
  setInterval(() => { k++; fx.fillStyle = `hsl(${(k * 7) % 360} 50% 60%)`; fx.fillRect(0, 0, 640, 360); fx.fillStyle = '#222'; fx.fillRect(220 + (k % 40), 60, 200, 300); }, 66);
  const cam = fc.captureStream(15).getVideoTracks()[0];
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0'; document.body.append(v);
  v.srcObject = new MediaStream([cam]); r.play = await t(v.play(), 5000);
  await new Promise((ok) => setTimeout(ok, 1500)); r.ready = v.readyState; r.tam = v.videoWidth + 'x' + v.videoHeight;
  r.rvfc = await t(new Promise((ok) => v.requestVideoFrameCallback(ok)), 3000);
  try { // MediaPipe solo, sobre la cámara achicada
    const seg = await SalaFondo.cargar('apaisado'), c2 = document.createElement('canvas'); c2.width = 256; c2.height = 144;
    c2.getContext('2d').drawImage(v, 0, 0, 256, 144); let n = null;
    const ts = Math.max((seg.ultimoTs || 0) + 1, Math.round(performance.now())); seg.ultimoTs = ts;
    seg.segmentForVideo(c2, ts, (x) => { const m = x.confidenceMasks?.[0]; n = m ? m.width + 'x' + m.height : 'sin máscara'; });
    r.seg = 'ok ' + n;
  } catch (e) { r.seg = 'error: ' + (e?.message || e); }
  try { const g = document.createElement('canvas').getContext('webgl2'); r.gl = g ? g.getParameter(g.VERSION) + ' · ' + g.getParameter(g.SHADING_LANGUAGE_VERSION) : 'sin webgl2'; } catch (e) { r.gl = 'error: ' + e.message; }
  // qué video escondido avanza en este navegador (Safari pausa los videos que «no se ven»)
  const VARIANTES = {
    actual: 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1',
    atributos: 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1',
    casiInvisible: 'position:fixed;right:0;bottom:0;width:64px;height:36px;opacity:.01;pointer-events:none',
    visible: 'position:fixed;right:0;bottom:0;width:160px;height:90px;pointer-events:none',
    unPixel: 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none',
    afuera: 'position:fixed;left:-10000px;top:0;width:640px;height:360px;pointer-events:none',
    enteroTransparente: 'position:fixed;left:0;top:0;width:640px;height:360px;opacity:0;pointer-events:none;z-index:-1',
    detrasDelFondo: 'position:fixed;left:0;top:0;width:64px;height:36px;pointer-events:none;z-index:-1',
  };
  r.variantes = {};
  for (const [nom, css] of Object.entries(VARIANTES)) {
    const e = document.createElement('video'); e.muted = true; e.playsInline = true; e.style.cssText = css;
    if (nom === 'atributos') { e.setAttribute('muted', ''); e.setAttribute('autoplay', ''); e.setAttribute('playsinline', ''); }
    document.body.append(e); e.srcObject = new MediaStream([cam.clone()]);
    const p = await t(e.play(), 3000); await new Promise((ok) => setTimeout(ok, 1000));
    const f = await t(new Promise((ok) => e.requestVideoFrameCallback(ok)), 1500);
    r.variantes[nom] = `play ${p} · ready ${e.readyState} · ${e.videoWidth}x${e.videoHeight} · cuadros ${f}`;
    e.srcObject = null; e.remove();
  }
  r.gumPropio = String(navigator.mediaDevices.getUserMedia).includes('pistas');
  t0 = performance.now(); r.crear = await t(SalaFondo.crear(cam, { modo: 'fuerte' }).then((m) => { r.crearMs = Math.round(performance.now() - t0); r.msCuadro = m.ms; m.parar(); }), 30e3);
  return r;
});

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
  // cuánto tarda MediaPipe la primera vez en este navegador, por partes (bajar el wasm, compilarlo, armar el separador).
  // Se carga antes de elegir el fondo: la sala espera hasta 60 s y acá se quiere probar el efecto, no la velocidad de esta máquina
  datos.cargaMediaPipe = await A.page.evaluate(async () => {
    const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3', r = {}, ms = (t) => Math.round(performance.now() - t);
    let t0 = performance.now(); const buf = await (await fetch(MP + '/wasm/vision_wasm_internal.wasm')).arrayBuffer(); r.bajarWasm = ms(t0); r.mb = Math.round(buf.byteLength / 1e5) / 10;
    t0 = performance.now(); await WebAssembly.compile(buf); r.compilarWasm = ms(t0);
    t0 = performance.now(); await SalaFondo.cargar('apaisado'); r.cargarSala = ms(t0);
    return r;
  });
  anotar('MediaPipe la primera vez: ' + JSON.stringify(datos.cargaMediaPipe));
  await tocar(A.page, '#lob-fondo'); await espera(600);
  await tocar(A.page, '.fx-op[data-f="fuerte"]');
  const t0 = Date.now(); await hastaMotor(A.page); datos.cargaMs = Date.now() - t0;
  if (!(await A.page.evaluate(() => !!S.motor?.vivo))) {
    await foto(A.page, '02-no-arranco');
    datos.diagnostico = await diagnostico(A.page).catch((e) => ({ error: e.message })); anotar('diagnóstico: ' + JSON.stringify(datos.diagnostico));
    throw new Error('el efecto no arrancó en ' + NAV + ' (aviso: ' + (await A.page.evaluate(() => document.querySelector('#flotante')?.textContent || '')) + ')');
  }
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
