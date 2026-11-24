// Dos máquinas en redes distintas (24/11/2026): el anfitrión en la máquina de la sala y una alumna en otra máquina de GitHub,
// con red de lejos (200 ms, 3 % de pérdida en UDP), que entra por el túnel como cualquier persona. El anfitrión cambia el
// fondo en plena clase (foto → desenfoque → apaga/prende la cámara → otra foto → sin fondo); la alumna saca capturas cada 15 s
// y anota lo que le llega (cuadros, tamaño, pérdidas, si la imagen tiene algo). ROL=anfitrion | alumna. Sala de prueba.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const ROL = process.env.ROL, BASE = process.env.BASE, K = process.env.PRUEBA_TOKEN || '';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome', OUT = process.env.OUT || 'fotos-lejos';
mkdirSync(OUT, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const registro = []; const anotar = (s) => { const l = `${new Date().toISOString().slice(11, 19)} ${s}`; console.log(l); registro.push(l); };
const guardar = () => writeFileSync(`${OUT}/registro-${ROL}.txt`, registro.join('\n') + '\n');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    ...(ROL === 'anfitrion' && process.env.VIDEO ? [`--use-file-for-fake-video-capture=${process.env.VIDEO}`] : []),
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('console', (m) => { if (['error', 'warn'].includes(m.type()) && !/club-app\.js|404|OpenGL|XNNPACK|Feedback/.test(m.text())) anotar(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => anotar('pageerror: ' + e.message));
const tocar = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const fondo = async (id) => { await tocar('#b-fondo'); await espera(400); await tocar(`.fx-op[data-f="${id}"]`); await espera(300); await tocar('#fx-x'); anotar('fondo → ' + (id || 'ninguno')); };
const estado = () => page.evaluate(() => ({ vivo: !!S.motor?.vivo, ms: S.motor?.ms ?? null, fps: S.motor?.fps ?? null, fondo: S.fondo, cam: S.cam,
  manda: ((tr) => (!S.pub.video ? 'sin-publicar' : !tr ? 'nada' : tr === S.motor?.track ? 'efecto' : tr === S.video ? 'camara' : 'otro'))(S.pub.video?.sender.track) }));
let fallo = null;
try {
  await page.goto(`${BASE}/entrar-como?u=${ROL === 'anfitrion' ? 'owner' : 'u1'}&k=${K}`, { waitUntil: 'domcontentloaded', timeout: 120e3 });
  await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, { timeout: 120e3 });
  if (ROL === 'anfitrion') {
    await tocar('#lob-fondo'); await espera(400); await tocar('.fx-op[data-f="biblioteca"]');
    await page.waitForFunction(() => S.motor?.vivo && !S.fondoCargando, { timeout: 120e3 }); await tocar('#fx-x');
    await tocar('#entrar');
    await page.waitForFunction(() => S.sid && S.pc?.connectionState === 'connected', { timeout: 120e3 });
    anotar('anfitrión en la sala con «biblioteca»: ' + JSON.stringify(await estado()));
    await page.waitForFunction(() => S.gente.length >= 2, { timeout: 15 * 60e3, polling: 1000 });
    anotar('entró la alumna');
    const muestras = new Set(); let fase = 'con-fondo'; // con un fondo elegido nunca puede salir «camara»
    const vigilar = setInterval(async () => { try { muestras.add(fase + ':' + (await estado()).manda); } catch (e) {} }, 200);
    await espera(40e3); await fondo('fuerte');
    await espera(40e3); await tocar('#b-cam'); anotar('cámara apagada');
    await espera(10e3); await tocar('#b-cam'); anotar('cámara prendida');
    await espera(30e3); await fondo('playa');
    await espera(40e3); fase = 'sin-fondo'; await fondo('');
    await espera(40e3); clearInterval(vigilar);
    anotar('qué se mandó en toda la clase: ' + [...muestras].join(', ') + ' · ahora: ' + JSON.stringify(await estado()));
    if (muestras.has('con-fondo:camara')) fallo = new Error('con un fondo elegido se mandó la cámara sin el fondo');
    await page.screenshot({ path: `${OUT}/anfitrion-fin.png` });
  } else {
    await tocar('#entrar');
    await page.waitForFunction(() => S.sid && S.pc?.connectionState === 'connected', { timeout: 120e3 });
    anotar('alumna en la sala');
    await page.waitForFunction(() => [...S.tiles.values()].some((t) => t.g && !t.g.yo && t.video?.videoWidth > 0), { timeout: 5 * 60e3, polling: 500 });
    anotar('le llega el video del anfitrión');
    const serie = [];
    for (let i = 0; i < 18; i++) {
      await espera(15e3);
      const m = await page.evaluate(async () => {
        const st = await S.pc.getStats(); let v = null;
        st.forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'video' && x.framesDecoded > 0 && (!v || x.framesDecoded > v.framesDecoded)) v = x; });
        const t = [...S.tiles.values()].find((t) => t.g && !t.g.yo && t.g.host);
        let luz = null, variacion = null, esquina = null;
        if (t?.video?.videoWidth) {
          const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.drawImage(t.video, 0, 0, 160, 90);
          const d = x.getImageData(0, 0, 160, 90).data; let s = 0, s2 = 0;
          for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; }
          const n = d.length / 4; luz = Math.round(s / n); variacion = Math.round(Math.sqrt(s2 / n - (s / n) ** 2));
          const e = x.getImageData(4, 4, 1, 1).data; esquina = `rgb(${e[0]},${e[1]},${e[2]})`; // arriba a la izquierda: qué fondo se ve
        }
        return { w: v?.frameWidth, h: v?.frameHeight, fps: v?.framesPerSecond, perdidos: v?.packetsLost, jitter: v?.jitter, congelado: v?.freezeCount, luz, variacion, esquina, camaraHost: !!t?.video?.videoWidth };
      });
      anotar(`captura ${i + 1}: ` + JSON.stringify(m)); serie.push(m);
      await page.screenshot({ path: `${OUT}/alumna-${String(i + 1).padStart(2, '0')}.png` });
    }
    writeFileSync(`${OUT}/serie-alumna.json`, JSON.stringify(serie, null, 2));
    if (!serie.some((m) => m.fps > 5)) fallo = new Error('a la alumna casi no le llegaron cuadros');
  }
} catch (e) { fallo = e; anotar('ERROR: ' + e.stack); await page.screenshot({ path: `${OUT}/${ROL}-error.png` }).catch(() => {}); }
finally { guardar(); await browser.close().catch(() => {}); }
if (fallo) { console.error('FALLÓ: ' + fallo.message); process.exit(1); }
console.log('OK');
