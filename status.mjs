// Status diario de Hermes Tarot 444 → STATUS.md (se guarda en el repo privado hermes-videos).
// Calendario (qué salió y hasta cuándo hay contenido), métricas por red (IG, YouTube, TikTok) y de la web (/api/panel).
// Uso: node status.mjs > STATUS.md   (env: HT_PAGE_TOKEN, HT_IG_USER_ID, HT_YT_*, HT_STATS_TOKEN)
import { readFileSync } from 'node:fs';

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
const fallas = items.filter((i) => Date.parse(i.cuando) < ahora - 3 * 3600e3 && (!i.instagram.publicado || !i.youtube.publicado || !i.tiktok.publicado));
p(`# Status Hermes Tarot 444 — ${ny(new Date().toISOString())} NY`);
p();
p('| Qué | Estado |');
p('|---|---|');
p(`| Publicador | ${cal.pausado ? '⏸ pausado' : '✅ activo, cada 6 h'} |`);
p(`| Publicados | IG ${hecho('instagram')} · YouTube ${hecho('youtube')} · TikTok ${hecho('tiktok')} de ${items.length} en calendario |`);
p(`| Próximo | ${prox[0] ? `${prox[0].carta} — ${ny(prox[0].cuando)}` : '⚠️ nada agendado'} |`);
p(`| Contenido hasta | ${prox.at(-1) ? ny(prox.at(-1).cuando) : '⚠️ sin contenido'} (${prox.length} videos en cola) |`);
p(`| Atrasados/fallados | ${fallas.length ? '⚠️ ' + fallas.map((i) => `${i.carta} (${['instagram', 'youtube', 'tiktok'].filter((r) => !i[r].publicado).join(', ')})`).join('; ') : '✅ ninguno'} |`);

// ---------- Instagram ----------
const G = 'https://graph.facebook.com/v21.0';
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
    for (const c of cs) if (c.username !== 'hermestarot444' && Date.parse(c.timestamp) > ahora - 7 * 864e5) { c7++; if (/\b(class|clase)\b/i.test(c.text || '')) clase7++; }
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

// ---------- web ----------
const web = await intentar(async () => {
  const r = await fetch('https://hermestarot444.pages.dev/api/panel', { headers: { authorization: `Bearer ${env.HT_STATS_TOKEN}` } });
  if (!r.ok) throw new Error(`panel HTTP ${r.status}`);
  return r.json();
});

const tabla = (filas, cols) => { p(`| Carta | ${cols.map((c) => c[0]).join(' | ')} |`); p(`|---|${cols.map(() => '---:').join('|')}|`); for (const f of filas) p(`| ${f.carta} | ${cols.map((c) => n(f[c[1]])).join(' | ')} |`); };
p(); p('## Instagram');
if (ig.error) p(`⚠️ ${ig.error}`); else { p(`Seguidores **${n(ig.seguidores)}** · posts ${n(ig.posts)}`);
  p(`Comentarios 7 d **${n(ig.c7)}** · pidieron class ${n(ig.clase7)} · DM enviados ${web.clase?.dms ? n(web.clase.dms.d7) : '–'} (ver todos en hermestarot444.pages.dev/panel/)`); p(); tabla(ig.vids, [['Views', 'views'], ['Likes', 'likes'], ['Coment.', 'coment'], ['Guardados', 'guardados'], ['Compart.', 'compart']]); }
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
    p(); p('### Clase de los miércoles'); p('| | |'); p('|---|---|');
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
console.log(out.join('\n'));
