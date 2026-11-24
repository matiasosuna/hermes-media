// Comparación de modelos de recorte (MediaPipe) sobre la misma foto de la cámara falsa (24/11/2026): qué modelo separa mejor
// a la persona de una cocina desordenada. Por modelo: la máscara en grises, la persona sobre un fondo y los ms por cuadro.
// Solo diagnóstico (no es la sala): una página en blanco que carga MediaPipe del CDN, igual que sala/fondo.js.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome', OUT = process.env.OUT || 'fotos';
const FOTO = process.env.FOTO || 'prueba-fondo/persona.png', FONDO = process.env.FONDO_IMG || '';
mkdirSync(OUT, { recursive: true });
const data = (f, tipo) => `data:${tipo};base64,${readFileSync(f).toString('base64')}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[pág]', m.text()));
await page.goto('about:blank');
const res = await page.evaluate(async (foto, fondo) => {
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3';
  const G = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/';
  const MODELOS = {
    cuadrado: G + 'selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    apaisado: G + 'selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
    multiclase: G + 'selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  };
  const cargar = (src) => new Promise((r, x) => { const i = new Image(); i.onload = () => r(i); i.onerror = x; i.src = src; });
  const im = await cargar(foto), bg = fondo ? await cargar(fondo) : null;
  // el mismo recorte que la cámara falsa en t=0: escala 704×396 y corta 640×360 desde (32, 18)
  const cam = document.createElement('canvas'); cam.width = 640; cam.height = 360;
  cam.getContext('2d').drawImage(im, -32, -18, 704, 396);
  const v = await import(MP + '/vision_bundle.mjs');
  const fs = await v.FilesetResolver.forVisionTasks(MP + '/wasm');
  const salida = {};
  for (const [nombre, url] of Object.entries(MODELOS)) {
    try {
      const s = await v.ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: url, delegate: 'CPU' },
        runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false });
      let persona = null, w = 0, h = 0, n = 0;
      const t0 = performance.now();
      for (let k = 0; k < 8; k++) s.segment(cam, (r) => {
        const m = r.confidenceMasks; w = m[0].width; h = m[0].height; n = m.length;
        if (k === 7) { // multiclase: 0 = fondo; el resto es la persona (pelo, piel, ropa, otros)
          const a = m[0].getAsFloat32Array(); persona = n > 1 ? a.map((x) => 1 - x) : Float32Array.from(a);
        }
      });
      const ms = Math.round((performance.now() - t0) / 8);
      // dibujo: máscara en grises | persona sobre el fondo (con el mismo borde que la sala, smoothstep .45–.75)
      const out = document.createElement('canvas'); out.width = 1280; out.height = 360;
      const c = out.getContext('2d');
      const mk = document.createElement('canvas'); mk.width = w; mk.height = h;
      const md = mk.getContext('2d').createImageData(w, h);
      for (let i = 0; i < w * h; i++) { const g = persona[i] * 255; md.data.set([g, g, g, 255], i * 4); }
      mk.getContext('2d').putImageData(md, 0, 0);
      c.drawImage(mk, 0, 0, 640, 360);
      // compuesto
      const mk2 = document.createElement('canvas'); mk2.width = 640; mk2.height = 360; const c2 = mk2.getContext('2d');
      c2.drawImage(mk, 0, 0, 640, 360);
      const mm = c2.getImageData(0, 0, 640, 360).data, camd = cam.getContext('2d').getImageData(0, 0, 640, 360).data;
      const fondoCv = document.createElement('canvas'); fondoCv.width = 640; fondoCv.height = 360; const cf = fondoCv.getContext('2d');
      if (bg) cf.drawImage(bg, 0, 0, 640, 360); else { cf.fillStyle = '#c0f'; cf.fillRect(0, 0, 640, 360); }
      const fd = cf.getImageData(0, 0, 640, 360);
      const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      for (let i = 0; i < 640 * 360; i++) {
        const al = ss(.45, .75, mm[i * 4] / 255);
        for (let ch = 0; ch < 3; ch++) fd.data[i * 4 + ch] = camd[i * 4 + ch] * al + fd.data[i * 4 + ch] * (1 - al);
      }
      cf.putImageData(fd, 0, 0); c.drawImage(fondoCv, 640, 0);
      salida[nombre] = { ms, w, h, n, png: out.toDataURL('image/png') };
      s.close();
    } catch (e) { salida[nombre] = { error: String(e) }; }
  }
  return salida;
}, data(FOTO, 'image/png'), FONDO ? data(FONDO, 'image/jpeg') : '');
await browser.close();
const resumen = {};
for (const [k, r] of Object.entries(res)) {
  if (r.png) writeFileSync(`${OUT}/mascara-${k}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  resumen[k] = r.error ? { error: r.error } : { ms: r.ms, mascara: `${r.w}x${r.h}`, canales: r.n };
}
console.log(JSON.stringify(resumen, null, 2));
writeFileSync(`${OUT}/mascaras.json`, JSON.stringify(resumen, null, 2));
