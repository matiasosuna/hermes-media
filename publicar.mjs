// Publicador diario de Hermes Tarot 444. Corre en GitHub Actions (este repo público), sin la Mac.
// Lee calendario.json y publica lo que ya venció: Reel en Instagram + Short en YouTube + TikTok (por Buffer), con el
// video del release "videos" de este repo (TikTok usa tiktok-<id>.mp4: el mismo video sin perfil ICC, que TikTok rechaza). Anota cada link en calendario.json (el workflow lo commitea).
// Nunca publica dos veces: antes de publicar busca la primera línea (IG) o el título (YT) entre lo último del canal.
// Uso:
//   node publicar.mjs                      → publica lo vencido (1 por plataforma por corrida)
//   node publicar.mjs --dry-run            → próximo pendiente: URL del video, HEAD, parámetros del contenedor; no publica
//   node publicar.mjs --contenedor-prueba  → crea el contenedor de IG del próximo pendiente y espera FINISHED; NO publica
//   node publicar.mjs --seguir             → ¿la cadena del workflow sigue? (no si todo está publicado o "pausado": true)
// Secretos (variables de entorno): HT_PAGE_TOKEN, HT_IG_USER_ID, HT_YT_CLIENT_ID, HT_YT_CLIENT_SECRET, HT_YT_REFRESH_TOKEN,
// BUFFER_API_KEY
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REPO = process.env.GITHUB_REPOSITORY || 'matiasosuna/hermes-media';
export const RELEASE = 'videos';
export const CANAL_YT = 'UC3J5gCPR3fWBIXEKcUQk9Qw';
const CAL = new URL('./calendario.json', import.meta.url);
const V = 'v21.0';
const env = process.env;
const SECRETOS = ['HT_PAGE_TOKEN', 'HT_YT_CLIENT_SECRET', 'HT_YT_REFRESH_TOKEN', 'BUFFER_API_KEY'].map((k) => env[k]).filter(Boolean);
export const PLATAFORMAS = ['instagram', 'youtube', 'tiktok'];
export const BUFFER_ORG = '6acc932a96c596c8b8c17194', BUFFER_TIKTOK = '6ad3219a778b240e2f368ecb';
const falta = (i) => PLATAFORMAS.some((p) => !i[p]?.publicado);

export const assetUrl = (archivo, repo = REPO) => `https://github.com/${repo}/releases/download/${RELEASE}/${archivo}`;
export const primeraLinea = (t) => String(t ?? '').split('\n')[0].trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const limpio = (s) => SECRETOS.reduce((t, x) => t.split(x).join('***'), String(s));
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a.map(limpio));

/** Qué toca publicar en una plataforma ahora: el pendiente más viejo ya vencido, respetando la separación mínima
 *  desde el último publicado (si el workflow estuvo apagado, se pone al día de a uno, sin ráfagas). */
export function siguiente(cal, plataforma, ahora = Date.now()) {
  const gap = (cal.separacion_minima_horas ?? 0.5) * 3600e3;
  const fechas = cal.items.map((i) => i[plataforma]?.publicado?.fecha).filter(Boolean).map((f) => Date.parse(f));
  const ultimo = fechas.length ? Math.max(...fechas) : 0;
  const item = cal.items.filter((i) => !i[plataforma]?.publicado).sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando))[0];
  if (!item) return { item: null, motivo: 'no queda nada pendiente' };
  if (Date.parse(item.cuando) > ahora) return { item: null, proximo: item, motivo: `el próximo es ${item.id} (${item.cuando})` };
  // con "requiere_v2": nada sale sin el video rehecho con el inicio nuevo (lo marca modal_render.py::preparar)
  if (cal.requiere_v2 && !item.v2) return { item: null, proximo: item, motivo: `${item.id} todavía no tiene el video con el inicio nuevo (v2)` };
  if (ahora - ultimo < gap) return { item: null, proximo: item, motivo: `espera ${cal.separacion_minima_horas} h desde el último post` };
  return { item };
}

/** La cadena de corridas sigue mientras quede algo por publicar y el calendario no diga "pausado": true. */
export const seguirCadena = (cal) => !cal.pausado && cal.items.some(falta);

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

// ── Historia de IG con cada reel nuevo: primeros 15 s + "NEW CARD ON MY PROFILE" / "Reply and tell me what you felt"
// (historia.sh). Solo para reels publicados hace menos de 12 h; se arma en el runner, se sube al release y se publica.
export const HISTORIA_HORAS = 12, HISTORIA_DESDE = '2026-10-24T11:00:00Z'; // reels anteriores no llevan historia
export const pideHistoria = (item, ahora = Date.now()) => {
  const pub = item.instagram?.publicado;
  if (!pub || item.instagram.historia) return false;
  const t = Date.parse(pub.fecha);
  return t >= Date.parse(HISTORIA_DESDE) && ahora - t < HISTORIA_HORAS * 3600e3;
};
async function publicarHistoria(item, guardar) {
  let cont = item.instagram.historia_contenedor;
  if (!cont || Date.now() - Date.parse(cont.creado) > 20 * 3600e3) {
    const arch = `historia-${item.id}.mp4`;
    if (!existsSync(arch)) {
      const r = await fetch(assetUrl(item.archivo));
      if (!r.ok) throw new Error(`no pude bajar ${item.archivo} (${r.status})`);
      writeFileSync('reel.mp4', Buffer.from(await r.arrayBuffer()));
      execFileSync('bash', ['historia.sh', 'reel.mp4', arch], { stdio: 'inherit' });
    }
    execFileSync('gh', ['release', 'upload', RELEASE, arch, '--clobber', '-R', REPO], { stdio: 'inherit' });
    await verificarAsset(assetUrl(arch));
    const c = await g('POST', `/${env.HT_IG_USER_ID}/media`, { media_type: 'STORIES', video_url: assetUrl(arch) });
    cont = item.instagram.historia_contenedor = { id: c.id, creado: new Date().toISOString() };
    guardar();
  }
  try { await esperarContenedor(cont.id); }
  catch (e) { if (/ERROR|EXPIRED/.test(e.message)) { delete item.instagram.historia_contenedor; guardar(); } throw e; }
  const pub = await g('POST', `/${env.HT_IG_USER_ID}/media_publish`, { creation_id: cont.id });
  delete item.instagram.historia_contenedor;
  return { id: pub.id, fecha: new Date().toISOString() };
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

// ── TikTok por Buffer (canal @hermestarot444): shareNow y se espera a que quede "sent" para anotar el link
export const assetTikTok = (item) => `tiktok-${item.id}.mp4`;
export const buscarDuplicadoTT = (posts, caption) =>
  posts.find((p) => p.status !== 'error' && primeraLinea(p.text) === primeraLinea(caption)) ?? null;
export const mutacionTikTok = (item, repo = REPO) => `mutation { createPost(input: { text: ${JSON.stringify(item.instagram.caption)}, channelId: "${BUFFER_TIKTOK}", schedulingType: automatic, mode: shareNow, assets: [{ video: { url: "${assetUrl(assetTikTok(item), repo)}", metadata: { thumbnailOffset: 100 } } }] }) { ... on PostActionSuccess { post { id } } ... on MutationError { message } } }`;
const hayTT = () => Boolean(env.BUFFER_API_KEY);
async function gql(query) {
  const r = await fetch('https://api.buffer.com', { method: 'POST', headers: { authorization: `Bearer ${env.BUFFER_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors) throw new Error(`Buffer: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data;
}
const CAMPOS_POST = 'id status text externalLink sentAt error { message }';
async function recientesTT() {
  const d = await gql(`{ posts(first: 50, input: { organizationId: "${BUFFER_ORG}", filter: { channelIds: ["${BUFFER_TIKTOK}"] } }) { edges { node { ${CAMPOS_POST} } } } }`);
  return d.posts.edges.map((e) => e.node);
}
/** Espera a que Buffer termine de mandar el post a TikTok (suele tardar 1–3 min) y devuelve el link. */
async function esperarEnviado(id, vueltas = 40) {
  for (let i = 0; i < vueltas; i++) {
    const p = (await gql(`{ post(input: { id: "${id}" }) { ${CAMPOS_POST} } }`)).post;
    if (p.status === 'sent' && p.externalLink) return { id: p.id, url: p.externalLink, fecha: new Date(p.sentAt ?? Date.now()).toISOString() };
    if (p.status === 'error') throw new Error(`Buffer no pudo publicar en TikTok: ${p.error?.message ?? 'error'}`);
    if (i % 4 === 0) log(`  TikTok: ${p.status}…`);
    await sleep(15000);
  }
  throw new Error(`el post ${id} de Buffer sigue sin salir; se retoma en la próxima corrida`);
}
async function publicarTT(item, guardar) {
  const previo = buscarDuplicadoTT(await recientesTT(), item.instagram.caption);
  if (previo) {
    log(`TT ${item.id}: ya está en Buffer (${previo.status}), solo lo anoto`);
    return previo.status === 'sent' && previo.externalLink
      ? { id: previo.id, url: previo.externalLink, fecha: new Date(previo.sentAt ?? Date.now()).toISOString() }
      : esperarEnviado(previo.id);
  }
  const info = await verificarAsset(assetUrl(assetTikTok(item)));
  log(`TT ${item.id}: video ok (${(info.bytes / 1e6).toFixed(1)} MB); mandando a Buffer…`);
  const r = (await gql(mutacionTikTok(item))).createPost;
  if (!r.post) throw new Error(`Buffer rechazó el post: ${r.message}`);
  item.tiktok.post = { id: r.post.id, creado: new Date().toISOString() };
  guardar();
  return esperarEnviado(r.post.id);
}

// ── corridas
function cargar() {
  const cal = JSON.parse(readFileSync(CAL, 'utf8'));
  return { cal, guardar: () => writeFileSync(CAL, `${JSON.stringify(cal, null, 2)}\n`) };
}
const proximoPendiente = (cal) => cal.items.filter(falta)
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
  const tt = assetUrl(assetTikTok(item));
  log(`TikTok: ${tt}`);
  log('HEAD TikTok:', JSON.stringify(await verificarAsset(tt)));
  for (const p of PLATAFORMAS) log(`${p}: ${siguiente(cal, p).item ? 'le toca publicar en esta corrida' : siguiente(cal, p).motivo}`);
  if (hayTT()) {
    const previo = buscarDuplicadoTT(await recientesTT(), item.instagram.caption);
    log(`TikTok por Buffer: clave ok; ${previo ? `ya está en Buffer (${previo.status})` : 'el próximo no está en Buffer todavía'}`);
  } else log('TikTok por Buffer: sin BUFFER_API_KEY (se saltea)');
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
  if (cal.pausado) return log('calendario en pausa ("pausado": true): no se publica nada');
  let fallas = 0;
  for (const p of PLATAFORMAS) {
    const { item, motivo } = siguiente(cal, p);
    if (!item) { log(`${p}: nada que publicar ahora (${motivo})`); continue; }
    if ((p === 'youtube' && !hayYT()) || (p === 'tiktok' && !hayTT())) { log(`${p}: toca ${item.id} pero faltan credenciales en los secretos; queda pendiente`); continue; }
    log(`${p}: toca ${item.id} (programado ${item.cuando})`);
    try {
      const res = p === 'instagram' ? await publicarIG(item, guardar) : p === 'youtube' ? await publicarYT(item) : await publicarTT(item, guardar);
      item[p].publicado = res;
      delete item[p].contenedor;
      delete item[p].post;
      guardar();
      log(`${p}: ✅ ${item.id} → ${res.permalink ?? res.url}`);
    } catch (e) {
      fallas++;
      guardar();
      log(`${p}: ❌ ${item.id}: ${e.message} (se reintenta en la próxima corrida)`);
    }
  }
  for (const item of cal.items.filter((i) => pideHistoria(i))) {
    try {
      item.instagram.historia = await publicarHistoria(item, guardar);
      guardar();
      log(`historia: ✅ ${item.id}`);
    } catch (e) {
      fallas++;
      guardar();
      log(`historia: ❌ ${item.id}: ${e.message} (se reintenta en la próxima corrida)`);
    }
  }
  if (fallas) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const seguir = async () => {
    const sigue = seguirCadena(cargar().cal);
    log(sigue ? 'la cadena sigue' : 'la cadena se detiene: todo publicado o calendario en pausa');
    if (env.GITHUB_OUTPUT) writeFileSync(env.GITHUB_OUTPUT, `seguir=${sigue}\n`, { flag: 'a' });
  };
  const run = a.includes('--dry-run') ? dryRun : a.includes('--contenedor-prueba') ? contenedorPrueba : a.includes('--seguir') ? seguir : publicar;
  run().catch((e) => { log(`❌ ${e.message}`); process.exitCode = 1; });
}
