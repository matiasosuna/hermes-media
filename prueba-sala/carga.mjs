// Prueba de carga de la sala (14/11/2026, pedido de Matías: «Probala vos», sin probar en una clase).
// Abre 1 anfitrión + N alumnos (Chrome headless, cada uno su navegador) contra server.mjs y repite la clase gratis:
// entran con el mic apagado, lo prenden de a uno (fase A), hablan varios con cambios de cámara y dos se van y vuelven
// (fase B), y el anfitrión da la clase con alguna pregunta (fase C). Mide en cada oyente cuándo empieza a oír a cada
// uno, los cortes, getStats (buffer, pérdida, RTT) y los errores de los pulls. Escribe resultados.json y resumen.md.
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
const { inyectar } = createRequire(import.meta.url)('./inyectar.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:8798';
const N = +(process.env.N || 17), NP = N + 1; // 0 = anfitrión
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const VERSION = process.env.VERSION || '?';
const OUT = process.env.OUT || 'resultados';
const ESCALA = +(process.env.ESCALA || 1); // para una corrida corta de prueba (0.2 = fases 5 veces más cortas)
mkdirSync(OUT, { recursive: true });
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s]`, ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const P = new Array(NP).fill(null); // instancia viva de cada participante
const instancias = []; // todas (también las cerradas): {i, desde, hasta, ev, err, fallas}
const consola = [], ventanas = [], muestras = [], fases = [], cpu = [];

async function abrir(i) {
  const inst = { i, desde: null, hasta: null, ev: [], err: [], fallas: [] };
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, defaultViewport: { width: 960, height: 540 },
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--window-size=960,540', ...(process.env.CHROME_EXTRA || '').split(' ').filter(Boolean)],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => consola.push([i, 'pageerror', String(e.message).slice(0, 160)]));
  page.on('console', (m) => { if (m.type() === 'error') consola.push([i, 'console', m.text().slice(0, 160)]); });
  await page.evaluateOnNewDocument(inyectar, i, NP, !!process.env.SIN_DTX);
  await page.goto(`${BASE}/entrar-como?u=${i ? 'u' + i : 'owner'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, { timeout: 90e3 });
  await page.evaluate(() => document.querySelector('#entrar').click());
  await page.waitForFunction(() => typeof S !== 'undefined' && S.sid && S.pc && S.pc.connectionState === 'connected', { timeout: 90e3 });
  inst.desde = Date.now(); inst.browser = browser; inst.page = page;
  P[i] = inst; instancias.push(inst);
  log(`entró ${i ? 'alumno ' + i : 'el anfitrión'}`);
  return inst;
}
async function juntar(inst) { // trae lo que anotó la pestaña (sin borrar: se pisa con lo último)
  try {
    const r = await inst.page.evaluate(() => ({ ev: window.__ev, err: window.__err, fallas: window.__fallas }));
    inst.ev = r.ev; inst.err = r.err; inst.fallas = r.fallas;
  } catch (e) {}
}
async function cerrar(i) {
  const inst = P[i]; if (!inst) return;
  await juntar(inst); inst.hasta = Date.now(); P[i] = null;
  await inst.browser.close().catch(() => {});
  log(`se fue ${i ? 'alumno ' + i : 'el anfitrión'}`);
}
const hablando = new Map(); // i → ventana abierta
async function hablar(i, on) {
  const inst = P[i]; if (!inst) return;
  if (on && hablando.has(i)) return;
  if (!on && !hablando.has(i)) return;
  const t = await inst.page.evaluate((on) => { window.__setHablar(on); if (S.mic !== on) document.querySelector('#b-mic').click(); return Date.now(); }, on).catch(() => null);
  if (t == null) return;
  if (on) { const w = { quien: i, on: t, off: null, fase: fases.at(-1)?.nombre }; ventanas.push(w); hablando.set(i, w); }
  else { hablando.get(i).off = t; hablando.delete(i); }
}
async function muestrear() {
  // CPU: uso real (de /proc/stat) y quién lo gasta (procesos de Chrome por tipo, node)
  const st = () => readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
  const a = st(); await dormir(1000); const b = st();
  const tot = b.reduce((x, y) => x + y, 0) - a.reduce((x, y) => x + y, 0), ocio = (b[3] + b[4]) - (a[3] + a[4]);
  const grupos = {};
  try {
    for (const l of execSync('ps -eo pcpu=,args=', { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n')) {
      const m = l.trim().match(/^([\d.]+)\s+(.*)$/); if (!m) continue;
      const tipo = /chrome/.test(m[2]) ? 'chrome ' + ((m[2].match(/--type=([\w-]+)/) || [, 'browser'])[1] + ((m[2].match(/--utility-sub-type=([\w.]+)/) || [, ''])[1] ? ':' + m[2].match(/--utility-sub-type=([\w.]+)/)[1].split('.').pop() : '')) : /node/.test(m[2]) ? 'node' : 'otro';
      grupos[tipo] = Math.round((grupos[tipo] || 0) + +m[1]);
    }
  } catch (e) {}
  cpu.push({ t: Date.now(), carga: os.loadavg()[0], uso: tot ? Math.round(100 * (1 - ocio / tot)) : null, grupos });
  await Promise.all(P.filter(Boolean).map(async (inst) => {
    try { muestras.push({ t: Date.now(), i: inst.i, inst: instancias.indexOf(inst), ...(await inst.page.evaluate(() => window.__stats())) }); } catch (e) {}
  }));
}
const fase = (nombre) => { fases.push({ nombre, desde: Date.now() }); log('— fase', nombre); };
const s = (ms) => Math.round(ms * ESCALA);

// ---------- la clase ----------
const reloj = setInterval(muestrear, 15e3);
fase('entrada');
await abrir(0);
await dormir(3000);
const entradas = [];
for (let i = 1; i <= N; i++) { entradas.push(abrir(i).catch((e) => log(`alumno ${i} no pudo entrar: ${e.message.slice(0, 120)}`))); await dormir(3000); }
await Promise.all(entradas);
await dormir(10e3);

fase('A');  // uno por uno: prende el mic, habla 8 s, lo apaga
for (let i = 0; i <= N; i++) { await hablar(i, true); await dormir(s(8000)); await hablar(i, false); await dormir(2000); }

fase('B');  // varios a la vez y cambios de cámara; dos se van y vuelven
const finB = Date.now() + s(180e3);
const eventosB = [[s(50e3), () => cerrar(5)], [s(60e3), () => abrir(5).then(() => dormir(15e3)).then(() => hablar(5, true)).then(() => dormir(5000)).then(() => hablar(5, false))],
  [s(110e3), () => cerrar(12)], [s(120e3), () => abrir(12).then(() => dormir(15e3)).then(() => hablar(12, true)).then(() => dormir(5000)).then(() => hablar(12, false))]];
const iniB = Date.now(), pendientes = [];
for (const [ms, f] of eventosB) pendientes.push(dormir(ms).then(f).catch((e) => log('evento B falló:', e.message.slice(0, 120))));
while (Date.now() < finB) {
  const libres = [...Array(NP).keys()].filter((i) => P[i] && !hablando.has(i) && i !== 5 && i !== 12);
  const i = libres[Math.floor(Math.random() * libres.length)];
  if (i != null) { await hablar(i, true); setTimeout(() => hablar(i, false), 5000); }
  await dormir(3000);
}
await Promise.all(pendientes); await dormir(6000);
for (const i of [...hablando.keys()]) await hablar(i, false);

fase('C');  // el anfitrión da la clase; dos preguntas
await hablar(0, true);
for (const k of [1, 2]) {
  await dormir(s(40e3));
  const i = 1 + Math.floor(Math.random() * N); await hablar(i, true); await dormir(5000); await hablar(i, false);
}
await dormir(s(40e3));
await hablar(0, false);
await dormir(3000);
fase('fin');
clearInterval(reloj); await muestrear();
for (const inst of P.filter(Boolean)) await juntar(inst);
let servidor = {}; try { servidor = await (await fetch(BASE + '/debug/stats')).json(); } catch (e) {}
for (const inst of P.filter(Boolean)) { inst.hasta = Date.now(); await inst.browser.close().catch(() => {}); }

// ---------- números ----------
const pct = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1) + 0.5))]; };
const med = (a) => pct(a, 0.5), r0 = (x) => (x == null ? null : Math.round(x)), r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
// presencia del tono de «quien» en la instancia «inst»: intervalos [ini, fin) en que se oye
function intervalos(inst, quien) {
  const out = []; let ini = null;
  for (const [t, q, v] of inst.ev) { if (q !== quien) continue; if (v && ini == null) ini = t; if (!v && ini != null) { out.push([ini, t]); ini = null; } }
  if (ini != null) out.push([ini, inst.hasta || Date.now()]);
  return out;
}
const porFase = {};
for (const w of ventanas) {
  if (w.off == null) continue;
  const F = (porFase[w.fase] ||= { lat: [], perdidas: 0, pares: 0, cortes: 0, cortesMs: [], segundos: 0, peores: [] });
  for (const inst of instancias) {
    if (inst.i === w.quien || inst.desde == null || inst.desde > w.on - 5000 || (inst.hasta && inst.hasta < w.off)) continue;
    F.pares++;
    const iv = intervalos(inst, w.quien).filter(([a, b]) => b > w.on && a < w.off + 1500);
    const primero = iv.find(([a]) => a >= w.on - 50);
    if (!primero) { F.perdidas++; continue; }
    F.lat.push(primero[0] - w.on);
    // cortes: huecos de 150 ms o más entre que empezó a oírse y 300 ms antes de que apague el mic
    const hasta = w.off - 300; let prev = null;
    for (const [a, b] of iv) {
      if (a < primero[0]) continue;
      if (prev != null && a < hasta && a - prev >= 150) { F.cortes++; F.cortesMs.push(a - prev); }
      prev = b;
    }
    if (prev != null && prev < hasta && hasta - prev >= 150) { F.cortes++; F.cortesMs.push(hasta - prev); }
    F.segundos += Math.max(0, hasta - primero[0]) / 1000;
  }
}
const latencia = {};
for (const [f, F] of Object.entries(porFase)) {
  latencia[f] = { pares: F.pares, mediana_ms: r0(med(F.lat)), p90_ms: r0(pct(F.lat, 0.9)), max_ms: r0(pct(F.lat, 1)),
    en_1s: F.lat.length ? r1(100 * F.lat.filter((x) => x <= 1000).length / F.pares) : 0, no_se_oyo: F.perdidas,
    cortes: F.cortes, cortes_por_min: F.segundos ? r1(F.cortes / (F.segundos / 60)) : null, corte_mediano_ms: r0(med(F.cortesMs)), corte_max_ms: r0(pct(F.cortesMs, 1)) };
}
// getStats: diferencias entre muestras seguidas de la misma instancia, desde que entraron todos
const desdeA = fases.find((f) => f.nombre === 'A')?.desde || 0;
const red = { buffer_ms: [], perdida_pct: [], ocultos_pct: [], rtt_ms: [], jitter_ms: [], audios: [], videos: [] };
const ant = new Map();
for (const m of muestras) {
  const p = ant.get(m.inst); ant.set(m.inst, m);
  if (m.rtt != null && m.t >= desdeA) red.rtt_ms.push(m.rtt * 1000);
  if (!p || m.t < desdeA) continue;
  const dj = m.jbd - p.jbd, de = m.jbe - p.jbe, dl = m.lost - p.lost, dr = m.recv - p.recv, dc = m.conc - p.conc, dt = m.tot - p.tot;
  if (de > 0) red.buffer_ms.push(1000 * dj / de);
  if (dl + dr > 0) red.perdida_pct.push(100 * dl / (dl + dr));
  if (dt > 0) red.ocultos_pct.push(100 * dc / dt);
  if (m.jit.length) red.jitter_ms.push(1000 * m.jit.reduce((a, b) => a + b, 0) / m.jit.length);
  red.audios.push(m.audios); red.videos.push(m.videos);
}
const resumenRed = Object.fromEntries(Object.entries(red).map(([k, a]) => [k, { mediana: r1(med(a)), p90: r1(pct(a, 0.9)), max: r1(pct(a, 1)) }]));
const errNav = {}; for (const inst of instancias) for (const [, ruta, c] of inst.err || []) { const k = ruta + ' ' + c; errNav[k] = (errNav[k] || 0) + 1; }
const errSrv = {}; for (const e of servidor.errores || []) { const k = e.ruta + ' ' + (e.code || e.status) + (e.de ? ` (${e.de} / ${e.track})` : ''); errSrv[k] = (errSrv[k] || 0) + 1; }
const senal = Object.fromEntries(Object.entries(servidor.rutas || {}).map(([k, a]) => [k, { n: a.length, mediana_ms: med(a), p90_ms: pct(a, 0.9) }]));
const entraron = instancias.filter((x) => x.desde).length;
const res = {
  version: VERSION, participantes: NP, entraron, red_simulada: process.env.RED || '', senal_simulada: { REQ_MS: process.env.REQ_MS, D1_MS: process.env.D1_MS },
  latencia, red: resumenRed, errores_navegador: errNav, errores_servidor: errSrv, senal_servidor: senal,
  telemetria_sala: (servidor.filas || []).length, consola: consola.length, consola_ejemplos: [...new Set(consola.map((c) => c[2]))].slice(0, 8),
  fallas_inyeccion: instancias.reduce((a, x) => a + (x.fallas?.length || 0), 0),
  carga_cpu: { mediana: r1(med(cpu.map((c) => c.carga))), max: r1(pct(cpu.map((c) => c.carga), 1)), nucleos: os.cpus().length,
    uso_pct: r0(med(cpu.map((c) => c.uso).filter((x) => x != null))), grupos_mitad: cpu[Math.floor(cpu.length / 2)]?.grupos },
  // por participante, al final: paquetes de audio que mandó y estado del AudioContext de la sala
  envio: Object.fromEntries([...new Map(muestras.map((m) => [m.inst, m])).values()].map((m) => [`P${m.i}#${m.inst}`, { enviados: m.enviados, ac: m.ac }])),
  duracion_s: Math.round((Date.now() - T0) / 1000),
};
writeFileSync(`${OUT}/resultados.json`, JSON.stringify(res, null, 2));
const L = (f) => latencia[f] || {};
const fila = (f, nom) => `| ${nom} | ${L(f).pares ?? '-'} | ${L(f).mediana_ms ?? '-'} | ${L(f).p90_ms ?? '-'} | ${L(f).max_ms ?? '-'} | ${L(f).en_1s ?? '-'} % | ${L(f).no_se_oyo ?? '-'} | ${L(f).cortes ?? '-'} (${L(f).cortes_por_min ?? '-'}/min, máx ${L(f).corte_max_ms ?? '-'} ms) |`;
const md = `## Sala: ${VERSION} — ${entraron}/${NP} entraron\n\nRed simulada: ${res.red_simulada}. Señalización: ${res.senal_simulada.REQ_MS} ms por pedido + ${res.senal_simulada.D1_MS} ms por consulta a la D1.\n\n` +
  `| Fase | Pares | Se oye (mediana ms) | p90 | máx | ≤ 1 s | No se oyó | Cortes ≥150 ms |\n|---|---|---|---|---|---|---|---|\n` +
  fila('A', 'A: prende el mic de a uno') + '\n' + fila('B', 'B: varios + cambios de cámara') + '\n' + fila('C', 'C: clase + preguntas') + '\n\n' +
  `Red (getStats): buffer ${resumenRed.buffer_ms.mediana} ms (p90 ${resumenRed.buffer_ms.p90}), pérdida ${resumenRed.perdida_pct.mediana} % (p90 ${resumenRed.perdida_pct.p90}), ` +
  `audio inventado ${resumenRed.ocultos_pct.mediana} % (p90 ${resumenRed.ocultos_pct.p90}), RTT ${resumenRed.rtt_ms.mediana} ms, jitter ${resumenRed.jitter_ms.mediana} ms, audios recibidos ${resumenRed.audios.mediana}, videos ${resumenRed.videos.mediana}.\n\n` +
  `Errores de pulls/señal (navegador): ${JSON.stringify(errNav)}. Servidor: ${JSON.stringify(errSrv)}. Consola: ${consola.length}. Telemetría guardada: ${res.telemetria_sala} filas. CPU: carga ${res.carga_cpu.mediana} (máx ${res.carga_cpu.max}) en ${res.carga_cpu.nucleos} núcleos.\n`;
writeFileSync(`${OUT}/resumen.md`, md);
console.log(md);
process.exit(0);
