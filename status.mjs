// Status diario de Hermes Tarot 444 → STATUS.md (se guarda en el repo privado hermes-videos).
// Calendario (qué salió y hasta cuándo hay contenido), métricas por red (IG, YouTube, TikTok) y de la web (/api/panel).
// Uso: node status.mjs > STATUS.md   (env: HT_PAGE_TOKEN, HT_IG_USER_ID, HT_YT_*, HT_STATS_TOKEN)
import { readFileSync } from 'node:fs';
import { comentarios, dms } from './comentarios.mjs';
import { mandarRedes } from './control.mjs'; // sección Redes del panel de la web

const env = process.env;
const cal = JSON.parse(readFileSync(new URL('./calendario.json', import.meta.url), 'utf8'));
const ny = (iso) => new Date(iso).toLocaleString('es', { timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const intentar = async (f) => { try { return await f(); } catch (e) { return { error: String(e.message || e).slice(0, 120) }; } };
const n = (x) => (x == null ? '–' : Number(x).toLocaleString('es'));
const out = [];
const p = (s = '') => out.push(s);

// ---------- calendario ----------
const items = cal.items, ahora = Date.now();
const hecho = (red) => items.filter((i) => i[red].publicado).length;
const prox = items.filter((i) => Date.parse(i.cuando) > ahora).sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando));
const fallas = items.filter((i) => Date.parse(i.cuando) < ahora - 3 * 3600e3 && ['instagram', 'youtube', 'tiktok'].some((r) => !i[r]?.publicado && !i[r]?.omitir));
p(`# Status Hermes Tarot 444 — ${ny(new Date().toISOString())} NY`);
p();
p('| Qué | Estado |');
p('|---|---|');
p(`| Publicador | ${cal.pausado ? '⏸ pausado' : '✅ activo, cada 6 h'} |`);
p(`| Publicados | IG ${hecho('instagram')} · YouTube ${hecho('youtube')} · TikTok ${hecho('tiktok')} de ${items.length} en calendario |`);
p(`| Próximo | ${prox[0] ? `${prox[0].carta} — ${ny(prox[0].cuando)}` : '⚠️ nada agendado'} |`);
p(`| Contenido hasta | ${prox.at(-1) ? ny(prox.at(-1).cuando) : '⚠️ sin contenido'} (${prox.length} videos en cola) |`);
p(`| Atrasados/fallados | ${fallas.length ? '⚠️ ' + fallas.map((i) => `${i.carta} (${['instagram', 'youtube', 'tiktok'].filter((r) => !i[r]?.publicado && !i[r]?.omitir).join(', ')})`).join('; ') : '✅ ninguno'} |`);

// ---------- Instagram ----------
const G = 'https://graph.facebook.com/v21.0';
// igual que tarot-web/comentarios: "tarot"/"class" en un comentario corto (≤ 3 palabras)
const pide = (t = '') => { const w = String(t).toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean); return w.length > 0 && w.length <= 3 && w.some((x) => ['tarot', 'class', 'clase'].includes(x)); };
const ig = await intentar(async () => {
  const perfil = await (await fetch(`${G}/${env.HT_IG_USER_ID}?fields=followers_count,media_count&access_token=${env.HT_PAGE_TOKEN}`)).json();
  if (perfil.error) throw new Error(perfil.error.message);
  const vids = [];
  for (const i of items.filter((x) => x.instagram.publicado).slice(-10)) {
    const id = i.instagram.publicado.id;
    const m = await (await fetch(`${G}/${id}?fields=like_count,comments_count&access_token=${env.HT_PAGE_TOKEN}`)).json();
    const ins = await (await fetch(`${G}/${id}/insights?metric=views,saved,shares&access_token=${env.HT_PAGE_TOKEN}`)).json();
    const v = Object.fromEntries((ins.data || []).map((d) => [d.name, d.values?.[0]?.value]));
    vids.push({ carta: i.carta, views: v.views, likes: m.like_count, coment: m.comments_count, guardados: v.saved, compart: v.shares });
  }
  // comentarios de los últimos 7 días (sin los nuestros) y cuántos pidieron "class"
  let c7 = 0, clase7 = 0;
  const media = (await (await fetch(`${G}/${env.HT_IG_USER_ID}/media?fields=id,comments_count&limit=25&access_token=${env.HT_PAGE_TOKEN}`)).json()).data || [];
  for (const m of media.filter((x) => x.comments_count)) {
    const cs = (await (await fetch(`${G}/${m.id}/comments?fields=text,username,timestamp&limit=100&access_token=${env.HT_PAGE_TOKEN}`)).json()).data || [];
    for (const c of cs) if (c.username !== 'hermestarot444' && Date.parse(c.timestamp) > ahora - 7 * 864e5) { c7++; if (pide(c.text)) clase7++; }
  }
  return { seguidores: perfil.followers_count, posts: perfil.media_count, vids, c7, clase7 };
});

// ---------- YouTube ----------
const yt = await intentar(async () => {
  const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    client_id: env.HT_YT_CLIENT_ID, client_secret: env.HT_YT_CLIENT_SECRET, refresh_token: env.HT_YT_REFRESH_TOKEN, grant_type: 'refresh_token' }) })).json();
  if (!tok.access_token) throw new Error('sin token de YouTube');
  const h = { authorization: `Bearer ${tok.access_token}` };
  const ch = (await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', { headers: h })).json()).items?.[0]?.statistics || {};
  const pubs = items.filter((x) => x.youtube.publicado).slice(-10);
  const ids = pubs.map((i) => i.youtube.publicado.id).join(',');
  const vs = ids ? (await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}`, { headers: h })).json()).items || [] : [];
  const st = Object.fromEntries(vs.map((v) => [v.id, v.statistics]));
  return { subs: ch.subscriberCount, vistas: ch.viewCount, vids: pubs.map((i) => ({ carta: i.carta, ...(st[i.youtube.publicado.id] || {}) })) };
});

// ---------- TikTok (página pública) ----------
const tt = await intentar(async () => {
  const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
  const html = await (await fetch('https://www.tiktok.com/@hermestarot444', { headers: ua })).text();
  const seg = html.match(/"followerCount":(\d+)/)?.[1], likes = html.match(/"heartCount":(\d+)/)?.[1];
  const vids = [];
  for (const i of items.filter((x) => x.tiktok.publicado?.url).slice(-10)) {
    const h = await (await fetch(i.tiktok.publicado.url, { headers: ua })).text();
    vids.push({ carta: i.carta, views: h.match(/"playCount":(\d+)/)?.[1], likes: h.match(/"diggCount":(\d+)/)?.[1] });
  }
  return { seguidores: seg, likes, vids };
});

// ---------- prueba sin intro (pedido de Matías, 22/11/2026) ----------
// La 49 (King of Cups) sale sin la intro (pausa, clase gratis, CARD, 100k): «Here's the story.» y directo la historia
// (hermes-videos src/carta-49/sin-intro.json). Se compara con la 47 y la 48, que la tienen. Duración = la del mp4 (ffprobe).
// Desde la 49 la voz tiene menos emoción (exaggeration 0,6 → 0,4, pedido de Matías 22/11/2026): la 50 (con intro, voz 0,4)
// es la comparación con la misma voz; la 47 y la 48 tienen la de antes.
// IG no da por API el % que lo mira entero ni los seguidores de cada reel: «% visto prom.» = tiempo promedio ÷ duración y
// los seguidores nuevos son de toda la cuenta, por día. Se deja de mostrar 14 días después de que sale la 49.
const PRUEBA = [['47-knight-of-cups', 'con', '0,6', 93.7], ['48-queen-of-cups', 'con', '0,6', 89.2], ['49-king-of-cups', 'sin', '0,4', 73.4],
  ['50-ace-of-swords', 'con', '0,4', 89.8]];
const p49 = items.find((i) => i.id === PRUEBA[2][0]);
const prueba = !p49 || ahora > Date.parse(p49.cuando) + 14 * 864e5 ? null : await intentar(async () => {
  const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
    client_id: env.HT_YT_CLIENT_ID, client_secret: env.HT_YT_CLIENT_SECRET, refresh_token: env.HT_YT_REFRESH_TOKEN, grant_type: 'refresh_token' }) })).json();
  const its = PRUEBA.map(([id, intro, voz, dur]) => ({ ...items.find((i) => i.id === id), intro, voz, dur }));
  const ytIds = its.map((i) => i.youtube?.publicado?.id).filter(Boolean);
  const ytSt = tok.access_token && ytIds.length ? Object.fromEntries(((await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ytIds.join(',')}`,
    { headers: { authorization: `Bearer ${tok.access_token}` } })).json()).items || []).map((v) => [v.id, v.statistics])) : {};
  const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
  const filas = [];
  for (const i of its) {
    const f = { carta: i.carta, intro: i.intro, voz: i.voz, dur: i.dur, sale: i.cuando };
    const igId = i.instagram?.publicado?.id;
    if (igId) for (const k of ['views', 'reach', 'ig_reels_avg_watch_time']) {
      const ins = await (await fetch(`${G}/${igId}/insights?metric=${k}&access_token=${env.HT_PAGE_TOKEN}`)).json();
      f[k] = ins.data?.[0]?.values?.[0]?.value ?? ins.data?.[0]?.total_value?.value;
    }
    f.yt = ytSt[i.youtube?.publicado?.id]?.viewCount;
    if (i.tiktok?.publicado?.url) f.tt = (await (await fetch(i.tiktok.publicado.url, { headers: ua })).text()).match(/"playCount":(\d+)/)?.[1];
    filas.push(f);
  }
  const desde = Math.floor(Date.parse('2026-11-20T08:00:00Z') / 1000), hasta = Math.min(Math.floor(ahora / 1000), desde + 30 * 86400);
  const seg = await (await fetch(`${G}/${env.HT_IG_USER_ID}/insights?metric=follower_count&period=day&since=${desde}&until=${hasta}&access_token=${env.HT_PAGE_TOKEN}`)).json();
  // el último día viene en 0 hasta que IG lo cierra (~1 día de demora): no se muestra
  return { filas, seg: (seg.data?.[0]?.values || []).filter((v, i, a) => !(i === a.length - 1 && !v.value)) };
});

// ---------- web ----------
const web = await intentar(async () => {
  const r = await fetch('https://hermestarot444.pages.dev/api/panel', { headers: { authorization: `Bearer ${env.HT_STATS_TOKEN}` } });
  if (!r.ok) throw new Error(`panel HTTP ${r.status}`);
  return r.json();
});

// historias activas (la API solo da las de las últimas 24 h); métricas de a una para que una que no aplica no tire las otras
const HIST_MET = [['Views', 'views'], ['Alcance', 'reach'], ['Respuestas', 'replies'], ['Compart.', 'shares'], ['Visitas perfil', 'profile_visits'], ['Seguidores', 'follows']];
const hist = await intentar(async () => {
  const r = await (await fetch(`${G}/${env.HT_IG_USER_ID}/stories?fields=id,media_type,timestamp&access_token=${env.HT_PAGE_TOKEN}`)).json();
  if (r.error) throw new Error(r.error.message);
  const filas = [];
  for (const h of r.data || []) {
    const f = { carta: `${ny(h.timestamp)} · ${h.media_type === 'VIDEO' ? 'video' : 'imagen'}` };
    for (const [, k] of HIST_MET) {
      const ins = await (await fetch(`${G}/${h.id}/insights?metric=${k}&access_token=${env.HT_PAGE_TOKEN}`)).json();
      f[k] = ins.data?.[0]?.values?.[0]?.value ?? ins.data?.[0]?.total_value?.value;
    }
    filas.push(f);
  }
  return filas.sort((a, b) => a.carta.localeCompare(b.carta));
});

const tabla = (filas, cols, primera = 'Carta') => { p(`| ${primera} | ${cols.map((c) => c[0]).join(' | ')} |`); p(`|---|${cols.map(() => '---:').join('|')}|`); for (const f of filas) p(`| ${f.carta} | ${cols.map((c) => n(f[c[1]])).join(' | ')} |`); };
if (prueba) {
  p(); p('## Prueba: King of Cups sin intro');
  p('Sale sin la intro (pausa, clase gratis, CARD, 100k): «Here\'s the story.» y directo la historia. Se compara con Knight y Queen of Cups, que la tienen.');
  p('Desde la 49 la voz tiene menos emoción (0,4; antes 0,6): la comparación justa de la intro es King of Cups contra Ace of Swords, con la misma voz.');
  p();
  if (prueba.error) p(`⚠️ ${prueba.error}`); else {
    p('| Carta | Intro | Voz | Duración | Sale (NY) | IG views | IG alcance | Tiempo prom. | % visto prom. | YouTube views | TikTok views |');
    p('|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|');
    for (const f of prueba.filas) {
      const s = f.ig_reels_avg_watch_time != null ? f.ig_reels_avg_watch_time / 1000 : null;
      p(`| ${f.carta} | ${f.intro} | ${f.voz} | ${f.dur ? f.dur.toFixed(1).replace('.', ',') + ' s' : '–'} | ${ny(f.sale)} | ${n(f.views)} | ${n(f.reach)} | ${s == null ? '–' : s.toFixed(1).replace('.', ',') + ' s'} | ${s == null || !f.dur ? '–' : Math.round((100 * s) / f.dur) + ' %'} | ${n(f.yt)} | ${n(f.tt)} |`);
    }
    const dia = (iso) => new Date(Date.parse(iso) - 864e5).toLocaleDateString('es', { timeZone: 'UTC', day: 'numeric', month: 'short' });
    if (prueba.seg.length) p(`\nSeguidores nuevos en IG por día (toda la cuenta): ${prueba.seg.map((v) => `${dia(v.end_time)} ${n(v.value)}`).join(' · ')}`);
    p('\n_IG no da por API el % que lo mira entero ni los seguidores de cada reel: están en la app (estadísticas del reel). «% visto prom.» = tiempo promedio ÷ duración._');
  }
}
p(); p('## Instagram');
// metas de la bio (300 ya tachado): avisar cuando se cruza la próxima para tacharla
const METAS = [300, 500, 1000, 5000, 10000, 100000];
if (ig.error) p(`⚠️ ${ig.error}`); else { p(`Seguidores **${n(ig.seguidores)}** · posts ${n(ig.posts)}`);
  const cruzadas = METAS.filter((m) => ig.seguidores >= m);
  p(`Metas de la bio: ${METAS.map((m) => (ig.seguidores >= m ? `~~${n(m)}~~` : n(m))).join(' · ')}${cruzadas.at(-1) > 300 ? ` — ⚠️ tachar ${n(cruzadas.at(-1))} en la bio si todavía no está` : ''}`);
  p(`Comentarios 7 d **${n(ig.c7)}** · pidieron el link ${n(ig.clase7)} · DM enviados ${web.clase?.dms ? n(web.clase.dms.d7) : '–'} (ver todos en hermestarot444.pages.dev/panel/)`); p(); tabla(ig.vids, [['Views', 'views'], ['Likes', 'likes'], ['Coment.', 'coment'], ['Guardados', 'guardados'], ['Compart.', 'compart']]); }
p(); p('### Historias (últimas 24 h)');
if (hist.error) p(`⚠️ ${hist.error}`); else if (!hist.length) p('Ninguna activa.'); else tabla(hist, HIST_MET, 'Subida (NY)');
p(); p('## YouTube');
if (yt.error) p(`⚠️ ${yt.error}`); else { p(`Suscriptores **${n(yt.subs)}** · vistas del canal ${n(yt.vistas)}`); p(); tabla(yt.vids, [['Views', 'viewCount'], ['Likes', 'likeCount'], ['Coment.', 'commentCount']]); }
p(); p('## TikTok');
if (tt.error) p(`⚠️ ${tt.error}`); else { p(`Seguidores **${n(tt.seguidores)}** · likes ${n(tt.likes)}`); p(); tabla(tt.vids, [['Views', 'views'], ['Likes', 'likes']]); }
p(); p('## Web (hermestarot444.pages.dev)');
if (web.error) p(`⚠️ ${web.error}`); else {
  const r7 = web.ranges.d7, tot = web.ranges.total;
  p('| | 7 días | Total |'); p('|---|---:|---:|');
  p(`| Visitas | ${n(r7.visits)} | ${n(tot.visits)} |`);
  for (const [k, v] of Object.entries(r7.refs)) p(`| desde ${k} | ${n(v)} | ${n(tot.refs[k])} |`);
  for (const [k, v] of Object.entries(r7.clicks)) p(`| clic ${k} | ${n(v)} | ${n(tot.clicks[k])} |`);
  if (web.clase) {
    const c = web.clase, k = (x) => `${n(r7.clicks[x] || 0)} (7 d) · ${n(tot.clicks[x] || 0)} total`;
    p(); p('### Clase gratis'); p('| | |'); p('|---|---|');
    p(`| Anotados | ${n(c.inscriptos)} (${n(c.d7)} en 7 d) |`);
    p(`| Por origen | ${Object.entries(c.por_origen || {}).map(([o, v]) => `${o} ${n(v)}`).join(' · ') || '–'} |`);
    p(`| Agregaron al calendario | ${k('clase_calendario')} |`);
    p(`| Entraron a la clase | ${k('clase_entrar')} |`);
    p(`| Clic grupo WhatsApp | ${k('whatsapp')} |`);
  }
  if (web.journal) p(`\nJournal: ${Object.entries(web.journal).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k} ${n(v)}`).join(' · ')}`);
}
// ---------- cuentas (créditos y cupos) ----------
p(); p('## Cuentas');
const gh = await intentar(async () => {
  const f = new Date(); const r = await fetch(`https://api.github.com/users/matiasosuna/settings/billing/usage?year=${f.getUTCFullYear()}&month=${f.getUTCMonth() + 1}`,
    { headers: { authorization: `Bearer ${env.PRIVADO_TOKEN}`, accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
  const privados = new Set((env.REPOS_PRIVADOS || 'mitologias hermes-videos').split(' '));
  return (await r.json()).usageItems.filter((i) => i.product === 'actions' && privados.has(i.repositoryName)).reduce((s, i) => s + i.quantity, 0);
});
let modal = { error: 'sin datos' };
try { modal = JSON.parse(readFileSync('modal.json', 'utf8')); } catch {}
const md = modal.error ? null : Object.fromEntries((modal.items || modal.rows || []).map((x) => [x.name ?? x.label, x.value ?? x.amount]));
p('| Cuenta | Uso del mes |'); p('|---|---|');
p(`| Modal (crédito USD 30) | ${modal.error ? '⚠️ ' + modal.error : modal.texto} |`);
p(`| GitHub Actions privados (2.000 min) | ${gh.error ? '⚠️ ' + gh.error : `${n(Math.round(gh))} min${gh >= 2000 ? ' ⚠️ agotado (render va por Modal)' : ''}`} |`);
p('| GitHub Actions públicos | ilimitado (publicador y status) |');
p('| Gemini (proyecto Hermes Tarot) | gratis, cupo diario propio |');
p('| Cloudflare (web) | plan USD 5/mes |');
p();
try { for (const l of await comentarios()) p(l); } catch (e) { p(`⚠️ comentarios: ${String(e.message || e).slice(0, 120)}`); }
p();
try { for (const l of await dms()) p(l); } catch (e) { p(`⚠️ DMs: ${String(e.message || e).slice(0, 120)}`); }
await mandarRedes({ ig, yt, tt, historias: hist });
console.log(out.join('\n'));
