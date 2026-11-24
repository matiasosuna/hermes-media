// Prueba de Recordings › Yours (tarot-web, 24/11/2026): la página real (sitio/ de ./build.sh) + la API real (functions/api)
// con D1 en memoria (tests/helpers.js). Nada toca producción: cuentas y grabaciones de prueba, y en vez de Modal este mismo
// servidor sirve los archivos en /modal/ con la misma firma (GRABACIONES_VER). Uso: node server.mjs <repo tarot-web> <puerto> <carpeta archivos>
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
const [REPO, PUERTO = '8799', ARCHIVOS] = process.argv.slice(2);
const SITIO = REPO + '/sitio';
const BASE = `http://127.0.0.1:${PUERTO}`;
const FIRMA = 'clave-de-prueba';
const H = await import(REPO + '/tests/helpers.js');
const { onRequest } = await import(REPO + '/functions/api/[[path]].js');
const env = H.makeEnv({ GRABACIONES_FIRMA: FIRMA, GRABACIONES_VER: BASE + '/modal' });
const key = await H.makeKey(); H.mockJwks([key]);

// cuentas: Hermes (admin), Mia (alumna: dueña de la reading), Ana (otra alumna), Leo (cuenta gratis, sin Mentoring)
const gente = {
  owner: { sub: 'owner-1', email: 'owner@example.com', name: 'Hermes' },
  mia: { sub: 'mia-1', email: 'mia@example.com', name: 'Mia Test', miembro: true },
  ana: { sub: 'ana-1', email: 'ana@example.com', name: 'Ana Test', miembro: true },
  leo: { sub: 'leo-1', email: 'leo@example.com', name: 'Leo Test' },
};
const galletas = {};
for (const [k, p] of Object.entries(gente)) {
  if (p.miembro) await H.hacerMiembro(env, p.email);
  galletas[k] = await H.login(env, key, H.claims({ sub: p.sub, email: p.email, name: p.name }));
}
const hace = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const graba = async (nombre, titulo, d, tipo, gratis) => {
  const r = await env.DB.prepare(`INSERT INTO grabaciones (clave, nombre, titulo, fecha, estado, gratis, tipo, link, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'subida', ?, ?, 'https://t.me/c/1/1', ?, ?)`).bind('k-' + nombre, nombre, titulo, hace(d), gratis, tipo, hace(d), hace(d)).run();
  const id = r.meta.last_row_id;
  await env.DB.prepare('UPDATE grabaciones SET video = ? WHERE id = ?').bind('g' + id, id).run();
  return id;
};
// las del Mentoring (video) y la reading de hoy como quedó en producción: solo audio, «Q&A gratis» por error (sala pública)
const ids = {
  qa1: await graba('sala-free-class-20261120-2100.webm', 'Live Q&A · The Star', 4, 'qa', 1),
  qa2: await graba('sala-free-class-20261113-2100.webm', 'Live Q&A · Reversed cards', 11, 'qa', 1),
  med: await graba('sala-club-20261118-1900.webm', 'Breathing with the Moon', 6, 'meditacion', 0),
  reading: await graba('sala-reading-mia-20261124-1207-audio.webm', 'Session · ' + hace(0), 0, 'qa', 1),
  clase: await graba('sala-leo-20261123-1500-audio.webm', 'Private class · The Fool', 1, 'qa', 0),
};
console.log('grabaciones de prueba:', JSON.stringify(ids));

const tipos = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', json: 'application/json',
  jpg: 'image/jpeg', webp: 'image/webp', mjs: 'text/javascript', mp4: 'video/mp4', m4a: 'audio/mp4', woff2: 'font/woff2', ico: 'image/x-icon' };
const pedidosModal = [];
const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE);
    if (url.pathname === '/entrar-como') { // deja la cookie de esa cuenta y va a la página
      const c = galletas[url.searchParams.get('u')];
      if (!c) { res.writeHead(404); return res.end(); }
      res.writeHead(302, { 'set-cookie': c + '; Path=/; HttpOnly; SameSite=Lax', location: url.searchParams.get('a') || '/mentoring/recordings/' }); return res.end();
    }
    if (url.pathname === '/debug/ids') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ids, pedidosModal })); }
    if (url.pathname.startsWith('/modal/')) { // lo que hace Modal (modal/grabaciones.py): solo con link firmado y vigente
      const nombre = url.pathname.slice(7), e = Number(url.searchParams.get('e')), s = url.searchParams.get('s') || '';
      const bien = createHmac('sha256', FIRMA).update(`${nombre}:${e}`).digest('hex');
      const ok = /^g\d{1,9}\.(mp4|jpg|m4a)$/.test(nombre) && e > Date.now() / 1000 && s.length === bien.length && timingSafeEqual(Buffer.from(s), Buffer.from(bien));
      pedidosModal.push({ nombre, ok });
      if (!ok) { res.writeHead(403); return res.end('Link expired'); }
      const f = ARCHIVOS + '/' + nombre.replace(/^g\d+\./, 'prueba.');
      if (!existsSync(f)) { res.writeHead(404); return res.end(); }
      const buf = readFileSync(f), rango = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const t = tipos[nombre.split('.').pop()];
      if (rango) {
        const a = +rango[1], b = rango[2] ? +rango[2] : buf.length - 1;
        res.writeHead(206, { 'content-type': t, 'content-range': `bytes ${a}-${b}/${buf.length}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 });
        return res.end(buf.subarray(a, b + 1));
      }
      res.writeHead(200, { 'content-type': t, 'accept-ranges': 'bytes', 'content-length': buf.length }); return res.end(buf);
    }
    if (url.pathname.startsWith('/api/')) {
      let body = ''; for await (const c of req) body += c;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const r = await onRequest({ request, env, params: {}, waitUntil: () => {}, next: () => new Response(null, { status: 404 }) });
      const buf = Buffer.from(await r.arrayBuffer());
      const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
      if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].replace(/;\s*Secure/gi, '');
      if (r.status >= 400) console.log('API', req.method, url.pathname, r.status, buf.toString().slice(0, 200));
      res.writeHead(r.status, h); return res.end(buf);
    }
    let f = SITIO + decodeURIComponent(url.pathname);
    if (existsSync(f) && statSync(f).isDirectory()) f = f.replace(/\/?$/, '/index.html');
    if (!existsSync(f) && existsSync(f + '.html')) f += '.html';
    if (!existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': tipos[f.split('.').pop()] || 'application/octet-stream' }); res.end(readFileSync(f));
  } catch (e) { console.error('error del servidor:', e.message); res.writeHead(500); res.end('error'); }
});
servidor.listen(+PUERTO, '127.0.0.1', () => console.log(`Recordings de prueba en ${BASE}`));
