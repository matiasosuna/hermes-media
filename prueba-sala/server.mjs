// Prueba de la sala (14/11/2026): la sala real (sala/index.html) + la API real (functions/api) de tarot-web, con D1 en
// memoria (tests/helpers.js) y el Realtime de PREVIEW (app hermes-club-sala). Nada toca producción ni la D1 compartida.
// Cuentas de prueba: owner (anfitrión, «Hermes») y u1..uN (miembros). /entrar-como?u=uK deja la cookie y va a la sala.
// La señalización se atrasa a propósito para simular a alguien lejos: REQ_MS por pedido (ida y vuelta al Worker) y
// D1_MS por consulta a la D1 (primaria en California). Uso: node server.mjs <repo tarot-web> <puerto> <N alumnos>
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
const [REPO, PUERTO = '8798', N = '17'] = process.argv.slice(2);
const REQ_MS = +(process.env.REQ_MS || 0), D1_MS = +(process.env.D1_MS || 0);
const SALA = process.env.SALA || 'free-class';
const H = await import(REPO + '/tests/helpers.js');
const { onRequest } = await import(REPO + '/functions/api/[[path]].js');
const SECRET = process.env.REALTIME_CLUB_APP_SECRET; if (!SECRET) { console.error('falta REALTIME_CLUB_APP_SECRET'); process.exit(1); }
const dormir = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : null);

const env = H.makeEnv({ REALTIME_APP_ID: '1c62613e0e7304537450ce8d734942d7', REALTIME_APP_SECRET: SECRET });
const raw = env.DB.raw;
// D1 lenta: cada consulta espera D1_MS (las que van en paralelo se pisan, como en la D1 de verdad)
const lento = (st) => new Proxy(st, {
  get(t, k) {
    const v = t[k];
    if (k === 'bind') return (...a) => lento(v.apply(t, a));
    if (['first', 'all', 'run', 'raw'].includes(k)) return async (...a) => { await dormir(D1_MS); return v.apply(t, a); };
    return typeof v === 'function' ? v.bind(t) : v;
  },
});
const db0 = env.DB;
env.DB = { ...db0, prepare: (sql) => lento(db0.prepare(sql)), batch: async (s) => { await dormir(D1_MS); return db0.batch(s); } };

const key = await H.makeKey(); H.mockJwks([key]);
const cuentas = { owner: H.claims({ sub: 'owner-1', email: 'owner@example.com', name: 'Hermes' }) };
for (let i = 1; i <= +N; i++) {
  await H.hacerMiembro(env, `u${i}@example.com`);
  cuentas['u' + i] = H.claims({ sub: 'u-' + i, email: `u${i}@example.com`, name: 'Alumno ' + i });
}

// lo que mide el servidor: duración por ruta y errores de los pulls (sin datos de nadie: son cuentas de prueba)
const rutas = {}, errores = [];
const tipos = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', json: 'application/json' };

// Control de la prueba repartida en varias máquinas (el director manda órdenes; cada máquina las busca con long-poll).
// Con el túnel, todo pide PRUEBA_TOKEN: cookie «prueba» en el navegador, cabecera x-prueba en las máquinas.
const TOKEN = process.env.PRUEBA_TOKEN || '';
const colas = new Map(), esperas = new Map(), pendientes = new Map(), hola = new Set();
let nOrden = 0;
const json = (res, d, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
function despachar(g) {
  const q = colas.get(g), w = esperas.get(g);
  if (!q?.length || !w) return;
  esperas.delete(g); clearTimeout(w.t); colas.set(g, []); json(w.res, q);
}
const galleta = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')));
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`); // detrás del túnel: https
    if (TOKEN) {
      const ok = url.pathname === '/entrar-como' ? url.searchParams.get('k') === TOKEN
        : url.pathname.startsWith('/control/') || url.pathname.startsWith('/debug/') ? req.headers['x-prueba'] === TOKEN
        : galleta(req).prueba === TOKEN;
      if (!ok) { res.writeHead(403); return res.end(); }
    }
    if (url.pathname.startsWith('/control/')) {
      let body = ''; for await (const c of req) body += c;
      const b = body ? JSON.parse(body) : {}, r = url.pathname.slice(9);
      if (r === 'hora') return json(res, { t: Date.now() });
      if (r === 'hola') { if (req.method === 'POST') hola.add(b.g); return json(res, { grupos: [...hola] }); }
      if (r === 'ordenes') {
        const g = +url.searchParams.get('g');
        if (esperas.has(g)) { const w = esperas.get(g); clearTimeout(w.t); json(w.res, []); }
        esperas.set(g, { res, t: setTimeout(() => { if (esperas.get(g)?.res === res) { esperas.delete(g); json(res, []); } }, 20e3) });
        return despachar(g);
      }
      if (r === 'orden') { // espera a que la máquina la haga y devuelve lo que contestó
        const id = ++nOrden, g = b.g;
        if (!colas.has(g)) colas.set(g, []);
        colas.get(g).push({ id, para: b.para, accion: b.accion, arg: b.arg });
        pendientes.set(id, { res, t: setTimeout(() => { pendientes.delete(id); json(res, { ok: false, error: 'tiempo' }); }, 240e3) });
        return despachar(g);
      }
      if (r === 'hecho') { const p = pendientes.get(b.id); if (p) { pendientes.delete(b.id); clearTimeout(p.t); json(p.res, b.r); } return json(res, { ok: true }); }
      res.writeHead(404); return res.end();
    }
    if (url.pathname === '/entrar-como') {
      const c = await H.login(env, key, cuentas[url.searchParams.get('u')]);
      const galletas = [c + '; Path=/; HttpOnly; SameSite=Lax'];
      if (TOKEN) galletas.push(`prueba=${TOKEN}; Path=/; HttpOnly; SameSite=Lax`);
      res.writeHead(302, { 'set-cookie': galletas, location: '/room/?r=' + SALA }); return res.end();
    }
    if (url.pathname === '/debug/stats') { // la telemetría que guardó la sala (tabla sala_stats, si existe)
      let filas = []; try { filas = raw.prepare('SELECT * FROM sala_stats ORDER BY ts').all().map((r) => ({ ...r })); } catch (e) {}
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ filas, rutas, errores }));
    }
    if (url.pathname.startsWith('/api/')) {
      let body = ''; for await (const c of req) body += c;
      const t0 = performance.now();
      await dormir(REQ_MS);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const r = await onRequest({ request, env, params: {}, waitUntil: () => {}, next: () => new Response(null, { status: 404 }) });
      const buf = Buffer.from(await r.arrayBuffer());
      const ruta = url.pathname.replace('/api/', '');
      (rutas[ruta] ||= []).push(Math.round(performance.now() - t0));
      if (r.status >= 400 && ruta !== 'sala/stats') errores.push({ t: Date.now(), ruta, status: r.status, code: (() => { try { return JSON.parse(buf).error; } catch { return ''; } })() });
      else if (ruta === 'sala/tracks') {
        try {
          const pedidos = JSON.parse(body).tracks || [];
          (JSON.parse(buf).tracks || []).forEach((x, k) => {
            if (!x.errorCode) return;
            const q = pedidos.find((p) => p.sessionId === x.sessionId && p.trackName === x.trackName) || pedidos[k] || {};
            const g = q.sessionId && raw.prepare('SELECT nombre FROM sala_gente WHERE session_id = ?').get(q.sessionId);
            errores.push({ t: Date.now(), ruta, code: x.errorCode, de: g ? g.nombre : 'sesión que ya no está', track: q.trackName });
          });
        } catch {}
      }
      const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
      if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].replace(/;\s*Secure/gi, '');
      res.writeHead(r.status, h); return res.end(buf);
    }
    let f = url.pathname.startsWith('/room/') ? REPO + '/sala/' + (url.pathname.slice(6) || 'index.html') : REPO + url.pathname;
    if (f.endsWith('/')) f += 'index.html';
    if (!existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': tipos[f.split('.').pop()] || 'application/octet-stream' }); res.end(readFileSync(f));
  } catch (e) { console.error('error del servidor:', e.message); res.writeHead(500); res.end('error'); }
}).listen(+PUERTO, '127.0.0.1', () => console.log(`sala de prueba lista en :${PUERTO} (REQ_MS=${REQ_MS}, D1_MS=${D1_MS}, sala=${SALA})`));
