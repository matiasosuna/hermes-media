// Prueba de carga de la sala (14/11/2026, pedido de Matías: «Probala vos», sin probar en una clase).
// 1 anfitrión + N alumnos (Chrome headless, cada uno su navegador), repartidos en varias máquinas de GitHub (18 en una
// sola de 4 núcleos la saturaban y los números no servían). Una máquina («sala», ROL=director) tiene el servidor, el
// túnel y dirige la clase; las otras (ROL=grupo) abren sus participantes y hacen lo que les dice el director.
// La clase repite la gratis: entran con el mic apagado, lo prenden de a uno (fase A), hablan varios con cambios de cámara
// y dos se van y vuelven (fase B), y el anfitrión da la clase con alguna pregunta (fase C). Cada oyente anota cuándo
// empieza a oír a cada uno (tono propio por persona) y los cortes; además getStats y errores de los pulls.
// Todos los tiempos van en el reloj del servidor (cada máquina mide su diferencia con /control/hora).
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
const { inyectar } = createRequire(import.meta.url)('./inyectar.cjs');

const ROL = process.env.ROL || 'director';
const BASE = process.env.BASE || 'http://127.0.0.1:8798'; // lo que abren los navegadores y a dónde se habla con el servidor
const TOKEN = process.env.PRUEBA_TOKEN || '';
const N = +(process.env.N || 17), NP = N + 1; // 0 = anfitrión
const GRUPOS = (process.env.GRUPOS || `0-${N}`).split(',').map((r) => r.split('-').map(Number)); // «0-3,4-8,…»
const G = +(process.env.G || 0);
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const VERSION = process.env.VERSION || '?';
const OUT = process.env.OUT || 'resultados';
const ESCALA = +(process.env.ESCALA || 1);
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s] [g${G}]`, ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'content-type': 'application/json', 'x-prueba': TOKEN };
const ctl = async (ruta, body, intentos = 5) => {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(BASE + ruta, body === undefined ? { headers: H } : { method: 'POST', headers: H, body: JSON.stringify(body) });
      if (r.ok) return await r.json();
      throw new Error('HTTP ' + r.status);
    } catch (e) { if (k >= intentos) throw e; await dormir(1000); }
  }
};

// ---------- reloj: diferencia con el servidor (la ida y vuelta más corta de 10) ----------
let OFFSET = 0;
{
  let mejor = Infinity;
  for (let k = 0; k < 10; k++) {
    const a = Date.now(), { t } = await ctl('/control/hora'), b = Date.now();
    if (b - a < mejor) { mejor = b - a; OFFSET = t - (a + b) / 2; }
  }
  log(`reloj: diferencia ${OFFSET.toFixed(0)} ms (ida y vuelta ${mejor} ms)`);
}
const ahora = () => Date.now() + OFFSET;

// ---------- participantes de esta máquina ----------
const P = new Map(); // i → instancia viva
const instancias = [], consola = [], muestras = [], cpu = [];
let nInst = 0;
async function abrir(i) {
  const inst = { id: `g${G}-${nInst++}`, i, desde: null, hasta: null, ev: [], err: [], fallas: [] };
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, defaultViewport: { width: 960, height: 540 },
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--window-size=960,540', ...(process.env.CHROME_EXTRA || '').split(' ').filter(Boolean)],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => consola.push([i, 'pageerror', String(e.message).slice(0, 160)]));
    page.on('console', (m) => { if (m.type() === 'error') consola.push([i, 'console', m.text().slice(0, 160)]); });
    await page.evaluateOnNewDocument(inyectar, i, NP, !!process.env.SIN_DTX);
    await page.goto(`${BASE}/entrar-como?u=${i ? 'u' + i : 'owner'}&k=${TOKEN}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const b = document.querySelector('#entrar'); return b && !b.disabled && b.offsetParent !== null; }, { timeout: 90e3 });
    await page.evaluate(() => document.querySelector('#entrar').click());
    await page.waitForFunction(() => typeof S !== 'undefined' && S.sid && S.pc && S.pc.connectionState === 'connected', { timeout: 90e3 });
    inst.desde = ahora(); inst.browser = browser; inst.page = page;
    P.set(i, inst); instancias.push(inst);
    log(`entró ${i ? 'alumno ' + i : 'el anfitrión'}`);
    return { ok: true, t: inst.desde };
  } catch (e) { await browser.close().catch(() => {}); log(`P${i} no pudo entrar: ${e.message.slice(0, 120)}`); return { ok: false }; }
}
async function juntar(inst) { // lo que anotó la pestaña, pasado al reloj del servidor
  try {
    const r = await inst.page.evaluate(() => ({ ev: window.__ev, err: window.__err, fallas: window.__fallas }));
    inst.ev = r.ev.map(([t, q, v]) => [t + OFFSET, q, v]); inst.err = r.err.map(([t, ...x]) => [t + OFFSET, ...x]); inst.fallas = r.fallas;
  } catch (e) {}
}
async function cerrar(i) {
  const inst = P.get(i); if (!inst) return { ok: false };
  await juntar(inst); inst.hasta = ahora(); P.delete(i);
  await inst.browser.close().catch(() => {});
  log(`se fue ${i ? 'alumno ' + i : 'el anfitrión'}`);
  return { ok: true, t: inst.hasta };
}
async function hablar(i, on) {
  const inst = P.get(i); if (!inst) return { ok: false };
  const t = await inst.page.evaluate((on) => { window.__setHablar(on); if (S.mic !== on) document.querySelector('#b-mic').click(); return Date.now(); }, on).catch(() => null);
  return t == null ? { ok: false } : { ok: true, t: t + OFFSET };
}
async function muestrear() {
  const st = () => readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
  const a = st(); await dormir(1000); const b = st();
  const tot = b.reduce((x, y) => x + y, 0) - a.reduce((x, y) => x + y, 0), ocio = (b[3] + b[4]) - (a[3] + a[4]);
  cpu.push({ t: ahora(), g: G, carga: os.loadavg()[0], uso: tot ? Math.round(100 * (1 - ocio / tot)) : null });
  await Promise.all([...P.values()].map(async (inst) => {
    try { muestras.push({ t: ahora(), i: inst.i, inst: inst.id, ...(await inst.page.evaluate(() => window.__stats())) }); } catch (e) {}
  }));
}
async function datos() {
  for (const inst of P.values()) await juntar(inst);
  return { g: G, cpu, consola, muestras, instancias: instancias.map(({ browser, page, ...x }) => x) }; // hasta = null: sigue adentro
}
// las órdenes del director para esta máquina (también las de la máquina del director: un solo camino)
let seguir = true;
async function ejecutor() {
  await ctl('/control/hola', { g: G });
  const reloj = setInterval(() => muestrear().catch(() => {}), 15e3);
  while (seguir) {
    let ords = [];
    try { ords = await ctl('/control/ordenes?g=' + G, undefined, 30); } catch (e) { log('sin órdenes:', e.message); await dormir(2000); continue; }
    for (const o of ords) {
      (async () => {
        let r = { ok: false };
        try {
          if (o.accion === 'abrir') r = await abrir(o.para);
          else if (o.accion === 'cerrar') r = await cerrar(o.para);
          else if (o.accion === 'hablar') r = await hablar(o.para, !!o.arg);
          else if (o.accion === 'datos') { clearInterval(reloj); await muestrear(); r = await datos(); }
          else if (o.accion === 'fin') { seguir = false; r = { ok: true }; }
        } catch (e) { r = { ok: false, error: String(e.message).slice(0, 120) }; }
        await ctl('/control/hecho', { id: o.id, r }).catch(() => {});
      })();
    }
  }
  for (const inst of P.values()) await inst.browser.close().catch(() => {});
}

if (ROL === 'grupo') { await ejecutor(); log('listo'); process.exit(0); }

// ================= director =================
mkdirSync(OUT, { recursive: true });
ejecutor(); // los participantes de la máquina del director
const grupoDe = (i) => GRUPOS.findIndex(([a, b]) => i >= a && i <= b);
const orden = (para, accion, arg) => ctl('/control/orden', { para, g: para == null ? arg : grupoDe(para), accion, arg }, 2).catch(() => ({ ok: false }));
{ // que estén todas las máquinas
  const hasta = Date.now() + 15 * 60e3;
  while (Date.now() < hasta) { const { grupos } = await ctl('/control/hola'); if (grupos.length >= GRUPOS.length) break; await dormir(3000); }
  const { grupos } = await ctl('/control/hola'); log(`máquinas listas: ${grupos.length}/${GRUPOS.length}`);
}
const vivos = new Set(), hablando = new Map(), ventanas = [], fases = [];
const fase = (nombre) => { fases.push({ nombre, desde: ahora() }); log('— fase', nombre); };
const s = (ms) => Math.round(ms * ESCALA);
async function entra(i) { const r = await orden(i, 'abrir'); if (r.ok) vivos.add(i); return r; }
async function sale(i) { vivos.delete(i); hablando.delete(i); return orden(i, 'cerrar'); }
async function hablar2(i, on) {
  if (!vivos.has(i) || on === hablando.has(i)) return;
  if (on) hablando.set(i, null);
  const r = await orden(i, 'hablar', on);
  if (on) { if (!r.ok) { hablando.delete(i); return; } const w = { quien: i, on: r.t, off: null, fase: fases.at(-1)?.nombre }; ventanas.push(w); hablando.set(i, w); }
  else { const w = hablando.get(i); hablando.delete(i); if (w) w.off = r.ok ? r.t : ahora(); }
}

fase('entrada');
await entra(0); await dormir(3000);
const entradas = [];
for (let i = 1; i <= N; i++) { entradas.push(entra(i)); await dormir(3000); }
await Promise.all(entradas);
log(`entraron ${vivos.size}/${NP}`);
await dormir(10e3);

fase('A');  // uno por uno: prende el mic, habla 8 s, lo apaga
for (let i = 0; i <= N; i++) { await hablar2(i, true); await dormir(s(8000)); await hablar2(i, false); await dormir(2000); }

fase('B');  // varios a la vez y cambios de cámara; dos se van y vuelven (y hablan al volver)
const finB = Date.now() + s(180e3), pendientes = [];
const vuelve = (i) => entra(i).then(() => dormir(15e3)).then(() => hablar2(i, true)).then(() => dormir(5000)).then(() => hablar2(i, false));
for (const [ms, f] of [[s(50e3), () => sale(5)], [s(60e3), () => vuelve(5)], [s(110e3), () => sale(12)], [s(120e3), () => vuelve(12)]])
  pendientes.push(dormir(ms).then(f).catch((e) => log('evento B falló:', e.message)));
while (Date.now() < finB) {
  const libres = [...vivos].filter((i) => !hablando.has(i) && i !== 5 && i !== 12);
  const i = libres[Math.floor(Math.random() * libres.length)];
  if (i != null) { hablar2(i, true).then(() => dormir(5000)).then(() => hablar2(i, false)); }
  await dormir(3000);
}
await Promise.all(pendientes); await dormir(7000);
for (const i of [...hablando.keys()]) await hablar2(i, false);

fase('C');  // el anfitrión da la clase; dos preguntas
await hablar2(0, true);
for (const k of [1, 2]) {
  await dormir(s(40e3));
  const i = 1 + Math.floor(Math.random() * N); await hablar2(i, true); await dormir(5000); await hablar2(i, false);
}
await dormir(s(40e3));
await hablar2(0, false);
await dormir(3000);
fase('fin');
const fin = ahora();
const todo = [];
for (let g = 0; g < GRUPOS.length; g++) { const r = await orden(null, 'datos', g); if (r.g != null) todo.push(r); else log(`la máquina ${g} no mandó datos`); }
let servidor = {}; try { servidor = await ctl('/debug/stats'); } catch (e) {}
for (let g = 0; g < GRUPOS.length; g++) orden(null, 'fin', g);
await dormir(2000);

// ---------- números ----------
const instancias2 = todo.flatMap((d) => d.instancias.map((x) => ({ ...x, hasta: x.hasta || fin })));
const muestras2 = todo.flatMap((d) => d.muestras).sort((a, b) => a.t - b.t);
const cpu2 = todo.flatMap((d) => d.cpu), consola2 = todo.flatMap((d) => d.consola);
const pct = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1) + 0.5))]; };
const med = (a) => pct(a, 0.5), r0 = (x) => (x == null ? null : Math.round(x)), r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
function intervalos(inst, quien) { // [ini, fin) en que la instancia oye el tono de «quien»
  const out = []; let ini = null;
  for (const [t, q, v] of inst.ev) { if (q !== quien) continue; if (v && ini == null) ini = t; if (!v && ini != null) { out.push([ini, t]); ini = null; } }
  if (ini != null) out.push([ini, inst.hasta]);
  return out;
}
const porFase = {};
for (const w of ventanas) {
  if (w.off == null) continue;
  const F = (porFase[w.fase] ||= { lat: [], perdidas: 0, pares: 0, cortes: 0, cortesMs: [], segundos: 0 });
  for (const inst of instancias2) {
    if (inst.i === w.quien || inst.desde == null || inst.desde > w.on - 5000 || inst.hasta < w.off) continue;
    F.pares++;
    const iv = intervalos(inst, w.quien).filter(([a, b]) => b > w.on && a < w.off + 1500);
    const primero = iv.find(([a]) => a >= w.on - 50);
    if (!primero) { F.perdidas++; continue; }
    F.lat.push(primero[0] - w.on);
    const hasta = w.off - 300; let prev = null; // cortes: huecos de 150 ms o más mientras habla
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
    en_1s: F.pares ? r1(100 * F.lat.filter((x) => x <= 1000).length / F.pares) : 0, no_se_oyo: F.perdidas,
    cortes: F.cortes, cortes_por_min: F.segundos ? r1(F.cortes / (F.segundos / 60)) : null, corte_mediano_ms: r0(med(F.cortesMs)), corte_max_ms: r0(pct(F.cortesMs, 1)) };
}
const desdeA = fases.find((f) => f.nombre === 'A')?.desde || 0;
const red = { buffer_ms: [], perdida_pct: [], ocultos_pct: [], rtt_ms: [], jitter_ms: [], audios: [], videos: [] };
const ant = new Map();
for (const m of muestras2) {
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
const errNav = {}; for (const inst of instancias2) for (const [, ruta, c] of inst.err || []) { const k = ruta + ' ' + c; errNav[k] = (errNav[k] || 0) + 1; }
const errSrv = {}; for (const e of servidor.errores || []) { const k = e.ruta + ' ' + (e.code || e.status) + (e.de ? ` (${e.de} / ${e.track})` : ''); errSrv[k] = (errSrv[k] || 0) + 1; }
const senal = Object.fromEntries(Object.entries(servidor.rutas || {}).map(([k, a]) => [k, { n: a.length, mediana_ms: med(a), p90_ms: pct(a, 0.9) }]));
const usoPor = {}; for (const c of cpu2) if (c.uso != null) (usoPor['g' + c.g] ||= []).push(c.uso);
const res = {
  version: VERSION, participantes: NP, maquinas: GRUPOS.length, entraron: instancias2.filter((x) => x.desde).length,
  red_simulada: process.env.RED || '', senal_simulada: { REQ_MS: process.env.REQ_MS, D1_MS: process.env.D1_MS },
  latencia, red: resumenRed, errores_navegador: errNav, errores_servidor: errSrv, senal_servidor: senal,
  telemetria_sala: (servidor.filas || []).length, consola: consola2.length, consola_ejemplos: [...new Set(consola2.map((c) => c[2]))].slice(0, 8),
  fallas_inyeccion: instancias2.reduce((a, x) => a + (x.fallas?.length || 0), 0),
  cpu_uso_pct: Object.fromEntries(Object.entries(usoPor).map(([g, a]) => [g, { mediana: med(a), max: pct(a, 1) }])),
  envio: Object.fromEntries([...new Map(muestras2.map((m) => [m.inst, m])).values()].map((m) => [`P${m.i}#${m.inst}`, { enviados: m.enviados, ac: m.ac }])),
  duracion_s: Math.round((Date.now() - T0) / 1000),
};
writeFileSync(`${OUT}/resultados.json`, JSON.stringify(res, null, 2));
const L = (f) => latencia[f] || {};
const fila = (f, nom) => `| ${nom} | ${L(f).pares ?? '-'} | ${L(f).mediana_ms ?? '-'} | ${L(f).p90_ms ?? '-'} | ${L(f).max_ms ?? '-'} | ${L(f).en_1s ?? '-'} % | ${L(f).no_se_oyo ?? '-'} | ${L(f).cortes ?? '-'} (${L(f).cortes_por_min ?? '-'}/min, máx ${L(f).corte_max_ms ?? '-'} ms) |`;
const md = `## Sala: ${VERSION} — ${res.entraron} entradas de ${NP} participantes en ${res.maquinas} máquinas\n\nRed simulada: ${res.red_simulada}. Señalización: ${res.senal_simulada.REQ_MS} ms por pedido + ${res.senal_simulada.D1_MS} ms por consulta a la D1.\n\n` +
  `| Fase | Pares | Se oye (mediana ms) | p90 | máx | ≤ 1 s | No se oyó | Cortes ≥150 ms |\n|---|---|---|---|---|---|---|---|\n` +
  fila('A', 'A: prende el mic de a uno') + '\n' + fila('B', 'B: varios + cambios de cámara') + '\n' + fila('C', 'C: clase + preguntas') + '\n\n' +
  `Red (getStats): buffer ${resumenRed.buffer_ms.mediana} ms (p90 ${resumenRed.buffer_ms.p90}), pérdida ${resumenRed.perdida_pct.mediana} % (p90 ${resumenRed.perdida_pct.p90}), ` +
  `audio inventado ${resumenRed.ocultos_pct.mediana} % (p90 ${resumenRed.ocultos_pct.p90}), RTT ${resumenRed.rtt_ms.mediana} ms, jitter ${resumenRed.jitter_ms.mediana} ms, audios recibidos ${resumenRed.audios.mediana}, videos ${resumenRed.videos.mediana}.\n\n` +
  `Errores de pulls/señal (navegador): ${JSON.stringify(errNav)}. Servidor: ${JSON.stringify(errSrv)}. Consola: ${consola2.length}. Telemetría guardada: ${res.telemetria_sala} filas. CPU (uso %): ${JSON.stringify(res.cpu_uso_pct)}.\n`;
writeFileSync(`${OUT}/resumen.md`, md);
console.log(md);
process.exit(0);
