// Saca una imagen de cada maqueta (.phone, 390×844 a 2x) → out/1-pasos.png … (corre en GitHub Actions, nunca en la Mac).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
mkdirSync(dir + 'out', { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1900, height: 1000 }, deviceScaleFactor: 2 });
await p.goto('file://' + dir + 'index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(800);
const nombres = ['1-pasos', '2-rueda', '3-la-sala', '4-calendario'];
const fonos = await p.$$('.phone');
for (let i = 0; i < fonos.length; i++) await fonos[i].screenshot({ path: `${dir}out/${nombres[i]}.png` });
const rotas = await p.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src));
console.log('imagenes rotas:', rotas.length, rotas.slice(0, 5));
await b.close();
