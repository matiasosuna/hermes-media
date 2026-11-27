// Historias de IG con fecha (26/11/2026): los eventos pagos en vivo, «Siempre a la vista» (puentes/tarot investigaciones/
// promocion-eventos.md, estrategia 4). Cada una ya está renderizada y aprobada por Matías: el JPG está en el release `videos`
// tal cual lo vio. El workflow historias-programadas hace una pasada cada ~15 min (cadena propia, como publicar.yml: el cron
// de GitHub cada hora no corrió nunca, 27/11) y publica la que toca con historia-publicar.mjs.
// - Sale si ya pasó `cuando` y todavía no pasó `hasta` (la de «Today» vence al empezar el evento: nunca sale tarde).
// - Una que no salió a tiempo queda «vencida», no se publica después.
// - "pausado": true en historias-programadas.json frena todo.
// Prueba sin publicar: SECO=1 node historias-programadas.mjs
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** → { publicar: [items], vencer: [items] } para este momento. */
export function queToca(prog, ahora = Date.now()) {
  const publicar = [], vencer = [];
  if (prog.pausado) return { publicar, vencer };
  for (const h of prog.items) {
    if (h.publicada || h.vencida) continue;
    const t = Date.parse(h.cuando), fin = Date.parse(h.hasta);
    if (!(t < fin)) throw new Error(`${h.id}: cuando/hasta inválidos`);
    if (ahora < t) continue;
    (ahora >= fin ? vencer : publicar).push(h);
  }
  return { publicar, vencer };
}

const ARCH = fileURLToPath(new URL('./historias-programadas.json', import.meta.url));
/** ¿Queda alguna por salir? (la cadena del workflow sigue mientras haya; sin «pausado») */
export const quedan = (prog) => !prog.pausado && prog.items.some((h) => !h.publicada && !h.vencida);

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--seguir') {
  const seguir = quedan(JSON.parse(readFileSync(ARCH, 'utf8')));
  console.log(`seguir=${seguir}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `seguir=${seguir}\n`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prog = JSON.parse(readFileSync(ARCH, 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY || 'matiasosuna/hermes-media';
  const ahora = Date.now(), iso = () => new Date().toISOString();
  const { publicar, vencer } = queToca(prog, ahora);
  const guardar = () => { if (!process.env.SECO) writeFileSync(ARCH, JSON.stringify(prog, null, 2) + '\n'); };
  for (const h of vencer) { h.vencida = iso(); console.log(`⏭  ${h.id}: no salió antes de ${h.hasta} (queda vencida)`); }
  if (vencer.length) guardar();
  // de a una por pasada: si dos tocan a la vez, la otra sale en la próxima (~15 min)
  const h = publicar[0];
  if (!h) console.log('nada para publicar ahora');
  else {
    const url = `https://github.com/${repo}/releases/download/${prog.release}/${h.jpg}`;
    if (process.env.SECO) console.log(`(seco) publicaría ${h.id}: ${url}`);
    else {
      const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (!r.ok) throw new Error(`${h.id}: no está el JPG (${r.status}) ${url}`);
      const out = execFileSync('node', ['historia-publicar.mjs', url], { encoding: 'utf8' });
      console.log(out);
      h.publicada = { id: out.match(/historia publicada: (\S+)/)?.[1] ?? null, cuando: iso() };
      guardar();
    }
  }
}
