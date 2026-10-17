// Publicador diario de Hermes Tarot 444. Corre en GitHub Actions (este repo público), sin la Mac.
// Lee calendario.json y publica lo que ya venció: Reel en Instagram + Short en YouTube, con el video del
// release "videos" de este repo. Anota cada link en calendario.json (el workflow lo commitea).
// Nunca publica dos veces: antes de publicar busca la primera línea (IG) o el título (YT) entre lo último del canal.
// Uso:
//   node publicar.mjs                      → publica lo vencido (1 por plataforma por corrida)
//   node publicar.mjs --dry-run            → próximo pendiente: URL del video, HEAD, parámetros del contenedor; no publica
//   node publicar.mjs --contenedor-prueba  → crea el contenedor de IG del próximo pendiente y espera FINISHED; NO publica
// Secretos (variables de entorno): HT_PAGE_TOKEN, HT_IG_USER_ID, HT_YT_CLIENT_ID, HT_YT_CLIENT_SECRET, HT_YT_REFRESH_TOKEN
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REPO = process.env.GITHUB_REPOSITORY || 'matiasosuna/hermes-media';
export const RELEASE = 'videos';
export const CANAL_YT = 'UC3J5gCPR3fWBIXEKcUQk9Qw';
const CAL = new URL('./calendario.json', import.meta.url);
const V = 'v21.0';
const env = process.env;
const SECRETOS = ['HT_PAGE_TOKEN', 'HT_YT_CLIENT_SECRET', 'HT_YT_REFRESH_TOKEN'].map((k) => env[k]).filter(Boolean);

export const assetUrl = (archivo, repo = REPO) => `https://github.com/${repo}/releases/download/${RELEASE}/${archivo}`;
export const primeraLinea = (t) => String(t ?? '').split('\n')[0].trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const limpio = (s) => SECRETOS.reduce((t, x) => t.split(x).join('***'), String(s));
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a.map(limpio));

/** Qué toca publicar en una plataforma ahora: el pendiente más viejo ya vencido, respetando la separación mínima
 *  desde el último publicado (si el workflow estuvo apagado, se pone al día de a uno, sin ráfagas). */
export function siguiente(cal, plataforma, ahora = Date.now()) {
  const gap = (cal.separacion_minima_horas ?? 0.5) * 3600e3;
  const fechas = cal.items.map((i) => i[plataforma].publicado?.fecha).filter(Boolean).map((f) => Date.parse(f));
  const ultimo = fechas.length ? Math.max(...fechas) : 0;
  const item = cal.items.filter((i) => !i[plataforma].publicado).sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando))[0];
  if (!item) return { item: null, motivo: 'no queda nada pendiente' };
  if (Date.parse(item.cuando) > ahora) return { item: null, proximo: item, motivo: `el próximo es ${item.id} (${item.cuando})` };
  if (ahora - ultimo < gap) return { item: null, proximo: item, motivo: `espera ${cal.separacion_minima_horas} h desde el último post` };
  return { item };
}

export const buscarDuplicadoIG = (media, caption) => media.find((m) => primeraLinea(m.caption) === primeraLinea(caption)) ?? null;
export const buscarDuplicadoYT = (videos, titulo) => videos.find((v) => v.titulo.trim() === titulo.trim()) ?? null;
export const parametrosContenedor = (item, repo = REPO) => ({
  media_type: 'REELS', video_url: assetUrl(item.archivo, repo), caption: item.instagram.caption, share_to_feed: 'true',
});

/** El video tiene que estar en el release y responder (GitHub redirige a su CDN; Instagram sigue la redirección). */
async function verificarAsset(url) {
  const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  const bytes = Number(r.headers.get('content-length') || 0);
  if (!r.ok || bytes < 1e6) throw new Error(`el video no está en el release (${r.status}, ${bytes} bytes): ${url}`);
  return { status: r.status, bytes, tipo: r.headers.get('content-type'), servidor: new URL(r.url).host };
}

// ── Instagram (Graph API, token de página que no vence)
async function g(metodo, ruta, q = {}) {
  if (!env.HT_PAGE_TOKEN || !env.HT_IG_USER_ID) throw new Error('faltan HT_PAGE_TOKEN / HT_IG_USER_ID');
  const params = new URLSearchParams({ ...q, access_token: env.HT_PAGE_TOKEN });
  const r = metodo === 'GET'
    ? await fetch(`https://graph.facebook.com/${V}${ruta}?${params}`)
    : await fetch(`https://graph.facebook.com/${V}${ruta}`, { method: metodo, body: params });
  const j = await r.json();
  if (j.error) throw new Error(`${ruta}: ${j.error.message}`);
  return j;
}
const recientesIG = async () => (await g('GET', `/${env.HT_IG_USER_ID}/media`, { fields: 'id,caption,permalink,timestamp', limit: '50' })).data ?? [];

/** Espera a que Instagram procese el contenedor (hasta ~12 min por corrida). */
async function esperarContenedor(id, vueltas = 72) {
  for (let i = 0; i < vueltas; i++) {
    const st = await g('GET', `/${id}`, { fields: 'status_code,status' });
    if (st.status_code === 'FINISHED') return 'FINISHED';
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`contenedor ${id}: ${st.status_code} ${st.status ?? ''}`);
    if (i % 6 === 0) log(`  IG procesando… (${st.status_code})`);
    await sleep(10000);
  }
  throw new Error(`contenedor ${id}: Instagram sigue procesando; se retoma en la próxima corrida`);
}

async function publicarIG(item, guardar) {
  const previo = buscarDuplicadoIG(await recientesIG(), item.instagram.caption);
  if (previo) {
    log(`IG ${item.id}: ya estaba publicado, solo lo anoto → ${previo.permalink}`);
    return { id: previo.id, permalink: previo.permalink, fecha: new Date(previo.timestamp ?? Date.now()).toISOString() };
  }
  // Un contenedor de una corrida anterior (menos de 20 h) se reaprovecha en vez de crear otro.
  let cont = item.instagram.contenedor;
  if (!cont || Date.now() - Date.parse(cont.creado) > 20 * 3600e3) {
    const info = await verificarAsset(assetUrl(item.archivo));
    log(`IG ${item.id}: video ok (${(info.bytes / 1e6).toFixed(1)} MB desde ${info.servidor}); creando contenedor…`);
    const c = await g('POST', `/${env.HT_IG_USER_ID}/media`, parametrosContenedor(item));
    cont = item.instagram.contenedor = { id: c.id, creado: new Date().toISOString() };
    guardar();
  } else log(`IG ${item.id}: retomo el contenedor ${cont.id}`);
  try { await esperarContenedor(cont.id); }
  catch (e) { if (/ERROR|EXPIRED/.test(e.message)) { delete item.instagram.contenedor; guardar(); } throw e; }
  try {
    const pub = await g('POST', `/${env.HT_IG_USER_ID}/media_publish`, { creation_id: cont.id });
    const { permalink } = await g('GET', `/${pub.id}`, { fields: 'permalink' });
    return { id: pub.id, permalink, fecha: new Date().toISOString() };
  } catch (e) {
    // a veces publica y devuelve error: confirmar antes de dar la corrida por fallida
    log(`IG ${item.id}: media_publish respondió error (${e.message}); reviso si igual salió…`);
    await sleep(60000);
    const m = buscarDuplicadoIG(await recientesIG(), item.instagram.caption);
    if (m) return { id: m.id, permalink: m.permalink, fecha: new Date().toISOString() };
    throw e;
  }
}

// ── YouTube (cliente OAuth propio de "hermes-tarot-444", en producción: el refresh token no vence)
const hayYT = () => Boolean(env.HT_YT_CLIENT_ID && env.HT_YT_CLIENT_SECRET && env.HT_YT_REFRESH_TOKEN);
async function accesoYT() {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    client_id: env.HT_YT_CLIENT_ID, client_secret: env.HT_YT_CLIENT_SECRET, refresh_token: env.HT_YT_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`token de YouTube: ${j.error} ${j.error_description ?? ''}`);
  return j.access_token;
}
async function yt(token, ruta) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3${ruta}`, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`YouTube ${ruta.split('?')[0]}: ${j.error?.message ?? r.status}`);
  return j;
}
async function recientesYT(token) {
  const canal = (await yt(token, '/channels?part=contentDetails,snippet&mine=true')).items?.[0];
  if (canal?.id !== CANAL_YT) throw new Error(`el token es del canal "${canal?.snippet?.title ?? '?'}", no de Hermes Tarot 444`);
  const lista = canal.contentDetails.relatedPlaylists.uploads;
  const j = await yt(token, `/playlistItems?part=snippet&maxResults=50&playlistId=${lista}`);
  return (j.items ?? []).map((x) => ({ id: x.snippet.resourceId.videoId, titulo: x.snippet.title, fecha: x.snippet.publishedAt }));
}
export const cuerpoYT = (item) => ({
  snippet: { title: item.youtube.titulo, description: item.youtube.descripcion, tags: item.youtube.etiquetas ?? [], categoryId: '27', defaultLanguage: 'en', defaultAudioLanguage: 'en' },
  status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: false },
});

async function publicarYT(item) {
  const token = await accesoYT();
  const previo = buscarDuplicadoYT(await recientesYT(token), item.youtube.titulo);
  if (previo) {
    log(`YT ${item.id}: ya estaba subido, solo lo anoto → https://youtube.com/shorts/${previo.id}`);
    return { id: previo.id, url: `https://youtube.com/shorts/${previo.id}`, fecha: new Date(previo.fecha ?? Date.now()).toISOString() };
  }
  const r = await fetch(assetUrl(item.archivo), { redirect: 'follow' });
  if (!r.ok) throw new Error(`no pude bajar ${item.archivo} del release (${r.status})`);
  const video = Buffer.from(await r.arrayBuffer());
  log(`YT ${item.id}: subiendo ${(video.length / 1e6).toFixed(1)} MB…`);
  const ini = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(video.length) },
    body: JSON.stringify(cuerpoYT(item)),
  });
  if (!ini.ok) throw new Error(`YouTube (inicio de subida): ${ini.status} ${await ini.text()}`);
  const destino = ini.headers.get('location');
  const P = 16 * 1024 * 1024;
  let o = 0, fin = null;
  while (o < video.length) {
    const n = Math.min(P, video.length - o);
    const s = await fetch(destino, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-range': `bytes ${o}-${o + n - 1}/${video.length}` }, body: video.subarray(o, o + n) });
    if (s.status === 308) { const rango = s.headers.get('range'); o = rango ? Number(rango.split('-')[1]) + 1 : o + n; continue; }
    if (!s.ok) throw new Error(`YouTube (subida): ${s.status} ${await s.text()}`);
    fin = await s.json(); o = video.length;
  }
  const st = fin?.status ?? {};
  const res = { id: fin.id, url: `https://youtube.com/shorts/${fin.id}`, fecha: new Date().toISOString(), privacidad: st.privacyStatus };
  if (st.privacyStatus !== 'public' || st.rejectionReason || st.uploadStatus === 'rejected') {
    res.aviso = `quedó ${st.privacyStatus}${st.rejectionReason ? `, rechazo: ${st.rejectionReason}` : ''} (${st.uploadStatus})`;
    log(`⚠️ YT ${item.id}: ${res.aviso}. Revisar en YouTube Studio; no se borra nada.`);
  }
  return res;
}

// ── corridas
function cargar() {
  const cal = JSON.parse(readFileSync(CAL, 'utf8'));
  return { cal, guardar: () => writeFileSync(CAL, `${JSON.stringify(cal, null, 2)}\n`) };
}
const proximoPendiente = (cal) => cal.items.filter((i) => !i.instagram.publicado || !i.youtube.publicado)
  .sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando))[0];

async function dryRun() {
  const { cal } = cargar();
  const item = proximoPendiente(cal);
  if (!item) return log('no queda nada pendiente');
  log(`próximo pendiente: ${item.id} (${item.cuando})`);
  const url = assetUrl(item.archivo);
  log(`video: ${url}`);
  log('HEAD:', JSON.stringify(await verificarAsset(url)));
  log('contenedor IG:', JSON.stringify(parametrosContenedor(item), null, 2));
  log('YouTube:', JSON.stringify(cuerpoYT(item), null, 2));
  for (const p of ['instagram', 'youtube']) log(`${p}: ${siguiente(cal, p).item ? 'le toca publicar en esta corrida' : siguiente(cal, p).motivo}`);
  if (!hayYT()) return log('YouTube en la nube: sin credenciales (se saltea)');
  const subidos = await recientesYT(await accesoYT()); // verifica token y canal (no sube nada)
  const previo = buscarDuplicadoYT(subidos, item.youtube.titulo);
  log(`YouTube en la nube: token ok, canal Hermes Tarot 444, ${subidos.length} videos recientes; ${previo ? `"${item.youtube.titulo}" ya está subido (${previo.id})` : 'el próximo no está subido todavía'}`);
}

async function contenedorPrueba() {
  const { cal } = cargar();
  const item = proximoPendiente(cal);
  if (!item) return log('no queda nada pendiente');
  const info = await verificarAsset(assetUrl(item.archivo));
  log(`prueba con ${item.id}: video ok (${(info.bytes / 1e6).toFixed(1)} MB desde ${info.servidor})`);
  const c = await g('POST', `/${env.HT_IG_USER_ID}/media`, parametrosContenedor(item));
  log(`contenedor ${c.id} creado; esperando…`);
  log(`contenedor ${c.id}: ${await esperarContenedor(c.id)} — prueba OK, NO se publica (vence solo en 24 h)`);
}

async function publicar() {
  const { cal, guardar } = cargar();
  let fallas = 0;
  for (const p of ['instagram', 'youtube']) {
    const { item, motivo } = siguiente(cal, p);
    if (!item) { log(`${p}: nada que publicar ahora (${motivo})`); continue; }
    if (p === 'youtube' && !hayYT()) { log(`youtube: toca ${item.id} pero no hay credenciales en los secretos; queda pendiente`); continue; }
    log(`${p}: toca ${item.id} (programado ${item.cuando})`);
    try {
      const res = p === 'instagram' ? await publicarIG(item, guardar) : await publicarYT(item);
      item[p].publicado = res;
      delete item[p].contenedor;
      guardar();
      log(`${p}: ✅ ${item.id} → ${res.permalink ?? res.url}`);
    } catch (e) {
      fallas++;
      guardar();
      log(`${p}: ❌ ${item.id}: ${e.message} (se reintenta en la próxima corrida)`);
    }
  }
  if (fallas) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const run = a.includes('--dry-run') ? dryRun : a.includes('--contenedor-prueba') ? contenedorPrueba : publicar;
  run().catch((e) => { log(`❌ ${e.message}`); process.exitCode = 1; });
}
