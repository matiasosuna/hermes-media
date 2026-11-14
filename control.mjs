// Panel de control de la web (hermestarot444.com/panel/, 14/11/2026). En cada corrida del publicador:
//  1. hace los pedidos del panel: pausar / seguir (calendario.json "pausado"), publicar una historia (workflow historia
//     con publicar=si) y actualizar el status (workflow status);
//  2. le manda al panel la foto del calendario: próximo reel, listos y por hacer, últimos publicados e historias.
// Entra a la API con HT_STATS_TOKEN. Si la web no responde, el publicador sigue igual.
import { readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const CONTROL = process.env.CONTROL_URL || 'https://hermestarot444.com/api/control';
const HISTORIA = /^imagenes\/[a-z0-9-]+\.html$/;
const DIR = new URL('./', import.meta.url);

/** Las historias que se pueden publicar: imagenes/*historia*.html y los hitos, con su PNG si está. */
export function historias(dir = DIR) {
  const archivos = readdirSync(new URL('imagenes/', dir));
  return archivos.filter((f) => /\.html$/.test(f) && /historia|^hito-/.test(f)).sort().map((f) => {
    const png = f.replace(/\.html$/, '.png');
    return { archivo: `imagenes/${f}`, nombre: f.replace(/\.html$/, '').replace(/-/g, ' ').replace(/^club historia/, 'Club ·'), png: archivos.includes(png) ? `imagenes/${png}` : null };
  });
}

/** Lo que el panel muestra del calendario (sin captions: solo lo que se mira de un vistazo). */
export function fotoCalendario(cal, ahora = Date.now(), dir = DIR) {
  const ord = (a, b) => Date.parse(a.cuando) - Date.parse(b.cuando);
  const pend = cal.items.filter((i) => !i.instagram?.publicado).sort(ord);
  const listo = (i) => !cal.requiere_v2 || Boolean(i.v2);
  const listos = pend.filter(listo);
  const pubs = cal.items.filter((i) => i.instagram?.publicado).sort(ord);
  return {
    pausado: Boolean(cal.pausado),
    proximos: pend.slice(0, 8).map((i) => ({ id: i.id, carta: i.carta, cuando: i.cuando, listo: listo(i) })),
    cola: listos.length,
    por_hacer: pend.length - listos.length,
    hasta: listos.at(-1)?.cuando ?? null,
    publicados: pubs.slice(-5).map((i) => ({ carta: i.carta, cuando: i.cuando, ig: i.instagram.publicado?.permalink ?? null, yt: i.youtube?.publicado?.url ?? null, tt: i.tiktok?.publicado?.url ?? null })),
    atrasados: cal.items.filter((i) => Date.parse(i.cuando) < ahora - 3 * 3600e3 && listo(i) && ['instagram', 'youtube', 'tiktok'].some((r) => !i[r]?.publicado)).map((i) => ({ carta: i.carta })),
    historias: historias(dir),
  };
}

/** Hace un pedido del panel. → texto del resultado (o tira error). */
export function hacer(p, cal, guardar, { repo, correr = (args) => execFileSync('gh', args, { stdio: 'inherit' }), dir = DIR } = {}) {
  if (p.tipo === 'pausar' || p.tipo === 'seguir') {
    cal.pausado = p.tipo === 'pausar'; guardar();
    return cal.pausado ? 'calendario pausado' : 'calendario sigue';
  }
  if (p.tipo === 'historia') {
    const a = p.datos?.archivo;
    if (!HISTORIA.test(a || '') || !existsSync(new URL(a, dir))) throw new Error(`no existe ${a}`);
    correr(['workflow', 'run', 'historia', '-R', repo, '--ref', 'main', '-f', `archivo=${a}`, '-f', 'publicar=si']);
    return 'workflow historia disparado (publicar=si)';
  }
  if (p.tipo === 'status') {
    correr(['workflow', 'run', 'status', '-R', repo, '--ref', 'main']);
    return 'workflow status disparado';
  }
  throw new Error(`pedido desconocido: ${p.tipo}`);
}

/** Pedidos + foto del calendario. Nunca tira: si la web no responde, lo anota y sigue. */
export async function control({ cal, guardar, env = process.env, log = console.log, repo, f = fetch, correr } = {}) {
  if (!env.HT_STATS_TOKEN) return log('panel: sin HT_STATS_TOKEN (se saltea)');
  const h = { authorization: `Bearer ${env.HT_STATS_TOKEN}`, 'content-type': 'application/json' };
  try {
    const r = await f(`${CONTROL}/pedidos`, { headers: h });
    if (!r.ok) throw new Error(`pedidos HTTP ${r.status}`);
    const { pedidos = [] } = await r.json();
    for (const p of pedidos) {
      let estado = 'hecho', resultado;
      try {
        if (p.tipo !== 'pausar' && p.tipo !== 'seguir' && !env.GITHUB_ACTIONS) throw new Error('solo desde GitHub Actions');
        resultado = hacer(p, cal, guardar, { repo, correr });
      } catch (e) { estado = 'error'; resultado = String(e.message || e).slice(0, 200); }
      log(`panel: pedido ${p.id} ${p.tipo} → ${estado}: ${resultado}`);
      await f(`${CONTROL}/pedidos/${p.id}`, { method: 'POST', headers: h, body: JSON.stringify({ estado, resultado }) });
    }
    const e = await f(`${CONTROL}/estado/calendario`, { method: 'PUT', headers: h, body: JSON.stringify(fotoCalendario(cal)) });
    if (!e.ok) throw new Error(`estado HTTP ${e.status}`);
  } catch (e) { log(`⚠️ panel: ${e.message}`); }
}

/** El status manda las métricas por red al panel (sección Redes). */
export async function mandarRedes(datos, { env = process.env, f = fetch } = {}) {
  if (!env.HT_STATS_TOKEN) return;
  try {
    await f(`${CONTROL}/estado/redes`, { method: 'PUT', headers: { authorization: `Bearer ${env.HT_STATS_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(datos) });
  } catch {}
}
