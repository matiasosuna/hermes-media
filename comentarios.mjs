// Comentarios de IG sin respuesta nuestra (últimos 14 días) → COMENTARIOS.md en el repo privado hermes-videos.
// status.mjs lo suma al final de STATUS.md (correr el workflow "status" a pedido para tenerlo al día). Solo: node comentarios.mjs
const env = process.env, G = 'https://graph.facebook.com/v21.0', YO = 'hermestarot444';
const get = async (url) => { const j = await (await fetch(url + (url.includes('?') ? '&' : '?') + 'access_token=' + env.HT_PAGE_TOKEN)).json(); if (j.error) throw new Error(j.error.message); return j; };
const desde = Date.now() - 14 * 864e5;
const ny = (iso) => new Date(iso).toLocaleString('es', { timeZone: 'America/New_York', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export async function comentarios() {
const media = (await get(`${G}/${env.HT_IG_USER_ID}/media?fields=id,caption,permalink,timestamp,comments_count&limit=30`)).data || [];
const out = [`## Comentarios sin responder — ${ny(new Date().toISOString())} NY`, ''];
let total = 0;
for (const m of media.filter((x) => x.comments_count)) {
  let url = `${G}/${m.id}/comments?fields=id,text,username,timestamp,replies{username,text}&limit=100`, cs = [];
  while (url) { const j = await get(url); cs.push(...(j.data || [])); url = j.paging?.next ? j.paging.next.replace(/&?access_token=[^&]*/, '') : null; }
  const sin = cs.filter((c) => c.username !== YO && Date.parse(c.timestamp) > desde && !(c.replies?.data || []).some((r) => r.username === YO));
  if (!sin.length) continue;
  out.push(`### ${(m.caption || '').split('\n')[0].slice(0, 70)}`, m.permalink, '');
  for (const c of sin.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    out.push(`- **@${c.username}** (${ny(c.timestamp)}) \`${c.id}\`: ${(c.text || '(sin texto)').replace(/\n/g, ' ')}`);
    for (const r of c.replies?.data || []) out.push(`  - ↳ @${r.username}: ${(r.text || '').replace(/\n/g, ' ')}`);
    total++;
  }
  out.push('');
}
out.splice(1, 0, `${total} comentarios de otras personas sin respuesta de @${YO} en los últimos 14 días.`);
return out;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log((await comentarios()).join('\n'));

/** DMs de las últimas 48 h (para revisar el flow de "card": qué escribió cada uno y qué le contestó el bot). */
export async function dms() {
  const desde2 = Date.now() - 2 * 864e5;
  const convs = (await get(`${G}/${env.HT_PAGE_ID || 'me'}/conversations?platform=instagram&fields=messages.limit(12){from,message,created_time,attachments}&limit=40`)).data || [];
  const out = ['## DMs (últimas 48 h)', ''];
  for (const c of convs) {
    const ms = (c.messages?.data || []).filter((m) => Date.parse(m.created_time) > desde2).reverse();
    if (!ms.some((m) => m.from?.username !== YO)) continue;
    const quien = ms.find((m) => m.from?.username !== YO)?.from?.username || '?';
    out.push(`### @${quien}`);
    for (const m of ms) out.push(`- ${ny(m.created_time)} ${m.from?.username === YO ? '🤖' : '👤'} ${(m.message || (m.attachments ? '[adjunto]' : '(vacío)')).replace(/\n/g, ' ').slice(0, 90)}`);
    out.push('');
  }
  return out;
}
