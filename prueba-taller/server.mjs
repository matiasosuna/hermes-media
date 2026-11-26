// Prueba de la herramienta del taller «12/12 Portal · Manifest your 2027» (tarot-web rama taller-1212, 26/11/2026).
// La sala real (sala/) + la API real (functions/api) de tarot-web, con D1 en memoria (tests/helpers.js) y el Realtime de PREVIEW
// (app hermes-club-sala). Nada toca producción ni la D1 compartida. Igual que prueba-sala/server.mjs (rama prueba-fondo), más:
// un evento tipo «taller» con su sala bloqueada y dos compras pagadas (Lucía y Tomás), como queda en producción al comprar.
// Cuentas de prueba: owner («Hermes», anfitrión), u1 (Lucía), u2 (Tomás), u3 (Ana). /entrar-como?u=… deja la cookie y va a la sala.
// Con PRUEBA_TOKEN (la sala en vivo detrás de un túnel, para probar con Matías): todo pide esa clave (?k= en /entrar-como, después
// la cookie «prueba»). /reiniciar?k=… borra lo hecho en el taller (vuelve al paso 0).
// Uso: node server.mjs <repo tarot-web> <puerto>
import http from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
const [REPO, PUERTO = '8799'] = process.argv.slice(2);
const H = await import(REPO + '/tests/helpers.js');
const { onRequest } = await import(REPO + '/functions/api/[[path]].js');
const { crearEvento } = await import(REPO + '/worker/eventos.js');
const { sincronizar, PRODUCTO } = await import(REPO + '/worker/eventos-correo.js');
const SECRET = process.env.REALTIME_CLUB_APP_SECRET; if (!SECRET) { console.error('falta REALTIME_CLUB_APP_SECRET'); process.exit(1); }

const env = H.makeEnv({ REALTIME_APP_ID: '1c62613e0e7304537450ce8d734942d7', REALTIME_APP_SECRET: SECRET });
const raw = env.DB.raw;

// el aviso al instante (Durable Object SalaAviso en producción): acá, WebSockets en este mismo servidor (paquete ws)
const { WebSocketServer } = await import('ws');
const wss = new WebSocketServer({ noServer: true }), socketsDe = new Map();
env.AVISO = { idFromName: (n) => n, get: (sala) => ({ fetch: async (u) => {
  const url = new URL(u);
  if (url.pathname === '/avisar') {
    const menos = url.searchParams.get('menos');
    for (const w of socketsDe.get(sala) || []) if (w.sid !== menos) try { w.send('cambio'); } catch (e) {}
    return new Response('ok');
  }
  return new Response(null, { headers: { 'x-aviso-sala': sala, 'x-aviso-sid': url.searchParams.get('s') || '' } });
} }) };

const key = await H.makeKey(); H.mockJwks([key]);
const cuentas = {
  owner: H.claims({ sub: 'owner-1', email: 'owner@example.com', name: 'Hermes' }),
  u1: H.claims({ sub: 'u-1', email: 'u1@example.com', name: 'Lucía' }),
  u2: H.claims({ sub: 'u-2', email: 'u2@example.com', name: 'Tomás' }),
  u3: H.claims({ sub: 'u-3', email: 'u3@example.com', name: 'Ana' }), // llega tarde
};
for (const c of Object.values(cuentas)) await H.login(env, key, c); // crea las cuentas

// el taller, como lo arma Hermes desde /panel (sala bloqueada; entran él y quienes compraron)
const ev = await crearEvento(env, { tipo: 'taller', inicio: Date.now() + 5 * 60e3, titulo: '12/12 Portal · Manifest your 2027',
  bajada: 'A live workshop on the last portal of the year.', minutos: 90, precio: 22 });
const ahora = Date.now();
for (const k of ['u1', 'u2', 'u3']) {
  const u = raw.prepare('SELECT id, email, name FROM users WHERE lower(email) = ?').get(cuentas[k].email);
  raw.prepare(`INSERT INTO compras (session_id, producto, email, estado, monto, moneda, creada, pagada, evento_id, user_id, nombre)
    VALUES (?, ?, ?, 'pagada', 2200, 'usd', ?, ?, ?, ?, ?)`).run('cs_prueba_' + k, PRODUCTO, u.email, ahora, ahora, ev.id, String(u.id), u.name);
}
await sincronizar(env, ev);
const SALA = ev.sala;
writeFileSync(process.env.SALA_FILE || 'sala.txt', SALA);

const tipos = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', json: 'application/json',
  jpg: 'image/jpeg', webp: 'image/webp', mjs: 'text/javascript', woff2: 'font/woff2', ico: 'image/x-icon' };
const errores = [];
const TOKEN = process.env.PRUEBA_TOKEN || '';
const galleta = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')));
const archivo = (p) => { // /room/ → sala/ (la fuente); lo demás, de sitio/ (lo que se publica) o del repo
  if (p.startsWith('/room/')) return REPO + '/sala/' + (p.slice(6) || 'index.html');
  for (const base of [REPO + '/sitio', REPO]) {
    let f = base + p;
    if (existsSync(f) && statSync(f).isDirectory()) f += (f.endsWith('/') ? '' : '/') + 'index.html';
    if (existsSync(f)) return f;
  }
  return null;
};
const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`); // detrás del túnel: https
    if (TOKEN && !(['/entrar-como', '/reiniciar'].includes(url.pathname) ? url.searchParams.get('k') === TOKEN : galleta(req).prueba === TOKEN)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Sin clave');
    }
    if (url.pathname === '/entrar-como') {
      const quien = url.searchParams.get('u');
      if (!cuentas[quien]) { res.writeHead(404); return res.end(); }
      const c = await H.login(env, key, cuentas[quien]);
      const galletas = [c + '; Path=/; HttpOnly; SameSite=Lax'];
      if (TOKEN) galletas.push(`prueba=${TOKEN}; Path=/; HttpOnly; SameSite=Lax`);
      res.writeHead(302, { 'set-cookie': galletas, location: '/room/?r=' + SALA }); return res.end();
    }
    if (url.pathname === '/reiniciar') {
      raw.prepare('DELETE FROM taller_estado WHERE sala = ?').run(SALA); raw.prepare('DELETE FROM taller_tiradas WHERE sala = ?').run(SALA);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Listo: el taller vuelve al paso 0.');
    }
    if (url.pathname === '/debug/errores') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(errores)); }
    if (url.pathname.startsWith('/api/')) {
      let body = ''; for await (const c of req) body += c;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const r = await onRequest({ request, env, params: {}, waitUntil: () => {}, next: () => new Response(null, { status: 404 }) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.status >= 400 && !url.pathname.endsWith('/sala/stats')) errores.push({ t: Date.now(), ruta: url.pathname, status: r.status, cuerpo: buf.toString().slice(0, 200) });
      const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
      if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].replace(/;\s*Secure/gi, '');
      res.writeHead(r.status, h); return res.end(buf);
    }
    const f = archivo(url.pathname);
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': tipos[f.split('.').pop()] || 'application/octet-stream' }); res.end(readFileSync(f));
  } catch (e) { console.error('error del servidor:', e.stack); res.writeHead(500); res.end('error'); }
});
servidor.on('upgrade', async (req, socket, head) => { // WebSocket de /api/sala/eventos: lo valida la sala real y lo acepta el «Durable Object» de arriba
  try {
    const url = new URL(req.url, `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`);
    if ((TOKEN && galleta(req).prueba !== TOKEN) || url.pathname !== '/api/sala/eventos') return socket.destroy();
    const r = await onRequest({ request: new Request(url, { method: 'GET', headers: req.headers }), env, params: {}, waitUntil: () => {}, next: () => new Response(null, { status: 404 }) });
    const sala = r.headers.get('x-aviso-sala');
    if (!sala) { socket.write(`HTTP/1.1 ${r.status} No\r\n\r\n`); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.sid = r.headers.get('x-aviso-sid');
      if (!socketsDe.has(sala)) socketsDe.set(sala, new Set());
      socketsDe.get(sala).add(ws);
      ws.on('message', (m) => { if (String(m) === 'ping') ws.send('pong'); });
      ws.on('close', () => socketsDe.get(sala)?.delete(ws));
    });
  } catch (e) { console.error('error del aviso:', e.message); socket.destroy(); }
});
servidor.listen(+PUERTO, '127.0.0.1', () => console.log(`sala del taller lista en :${PUERTO} (sala ${SALA}, evento ${ev.id})`));
