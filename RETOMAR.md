# Retomar Hermes Tarot 444 (después de la Mac rota)

Escrito el 27/10/2026. Retoma la sesión "Hermes Tarot: web y cursos" (15 al 25 de octubre), que corría en la Mac por Remote Control.

> Este repo es **público**. Acá no hay tokens, links privados (Meet, WhatsApp) ni IDs de cuentas. El detalle completo está en el repo privado `academia` (ver más abajo).

## Dónde está todo

| Qué | Dónde | Estado |
|---|---|---|
| Publicador automático + `calendario.json` | este repo (`hermes-media`) | A salvo, sigue andando solo |
| Motor de los videos (Remotion, guiones, escenas, Modal) | `matiasosuna/hermes-videos` (privado) | A salvo |
| **Recuperación completa de la sesión** | `matiasosuna/academia`, rama `recuperado-mac`, carpeta `recuperado/hermes-tarot/` | Hecha el 26/10 |
| Web publicada, base D1, worker del bot | Cloudflare (proyecto Pages `hermestarot444`, worker `hermes-comentarios`) | En vivo |
| Apps `hermes-render` y `hermes-voz` | Modal, perfil `tarot` | Desplegadas |
| Código fuente de la web (`~/Projects/tarot-web`) | **Solo estaba en la Mac, sin git** | Perdido; recuperado en parte (ver abajo) |

En `academia` → `recuperado-mac` → `recuperado/hermes-tarot/` están:
- `RESUMEN.md`: resumen largo de todo el proyecto, el pipeline paso a paso, los servicios, los nombres de las variables de entorno y los links.
- `archivos/sesion/compactaciones.md`: los 16 resúmenes técnicos automáticos de la sesión.
- `archivos/sesion/mensajes-del-usuario.txt`: todos tus mensajes, en orden.
- `archivos/sesion/informes-subagentes.md`: lo que reportó cada subagente.
- `archivos/tarot-web/`: la web bajada del sitio en vivo (compilada, sin la API) y ~45 archivos reconstruidos de la transcripción (varios parciales).
- `archivos/memoria-claude/`: 14 notas de la memoria de Claude.

## Qué es el proyecto

**Hermes Tarot 444**: marca de tarot en inglés, con IG/TikTok @hermestarot444 y canal de YouTube.
- **Web** hermestarot444.pages.dev: lecturas (USD 44, por Cal.com), cursos, clase gratis los miércoles a las 4:44 pm NY, Hermes Journal (las 78 cartas, con login de Google), `/links`, `/practice`, `/card`, `/panel`.
- **Reels**: una carta por video, con tu voz clonada (Chatterbox), subtítulos karaoke y personajes hechos con el motor de Myths on Clay.
- **Bot de IG**: si alguien escribe "card" (comentario o DM, hasta 3 palabras), le llega por DM la carta del día. Una por persona por día (hora de NY).

## Cómo funciona este repo

- `publicar.yml` corre cada ~14 min y publica en Instagram, YouTube Shorts y TikTok (por Buffer) lo que toca según `calendario.json`. Solo publica ítems que tengan `v2` (video con el inicio nuevo).
- `status.yml` / `status.mjs` arman el STATUS (métricas, historias activas de IG, crédito de Modal).
- `menores-diario.yml`: arma arcanos menores en Modal a mano (sin cron desde el 24/10).
- `tiktok-videos.yml`: arma la versión de TikTok de cada video.
- El `v2` lo pone el cron `cola` de Modal (`hermes-videos/scripts/modal_render.py`, 10:00 UTC) para lo que sale dentro de las 36 h.

## Decisiones tomadas

- **Ritmo**: día por medio a las 09:00 NY desde el 27/10. Antes se probó 4 por día (saturaba), 2 por día (más seguidores) y 1 por día (bajó el alcance de la web).
- **Gancho**: "Most people think X is about… / It isn't. / I'm going to tell you {his/her/their} story…". Nada de "They're wrong" ni remate después de "It isn't". Sin silencios largos.
- **Subtítulos** centrados entre la carta y "HERMES TAROT 444".
- **Preparar solo las próximas 2–3 cartas**, nada por adelantado.
- **Historia automática apagada**: compartir el reel en historias lo hacés vos.
- **Bot propio** (worker + D1) en lugar de ManyChat, SendPulse, LinkDM o Zorcha.
- **Stripe afuera**: las lecturas se cobran después (Wise, Venmo, Mercado Pago). Cal.com sin pago y sin confirmación manual.
- **Modal**: no usar más la cuenta `osuna-devs`. Hermes usa `tarot`.
- La web y los mails a alumnos salen siempre desde el Gmail de la marca, uno por persona, nunca con CCO.

## Dónde quedó (27/10, 09:00 UTC)

- Publicadas: las 22 mayores + Ace y Two of Wands (hasta el 25/10).
- **Hoy 27/10, 13:00 UTC**: Three of Wands, ya tiene `v2`.
- Después: Four of Wands el 29/10, Five el 31/10, Six el 2/11, Seven el 4/11, Eight el 6/11… Todas sin `v2` todavía; las prepara el cron de Modal un día antes.
- Modal `tarot` tenía ~USD 12–13 de crédito hasta el 1/11 (alcanza: ~USD 0,15 por carta).
- Después de la sesión vieja, otras sesiones tocaron este repo: compactación de contexto al 30% (`.claude/settings.json`, 25/10) y el STATUS ahora suma las historias de IG activas (26/10).

## Lo que se perdió (solo existía en la Mac)

- **El código fuente de `tarot-web`**: la API (`worker/api.js`, `functions/api/[[path]].js`), el worker del bot en su versión final, el Journal como fuente, el panel, `build.sh`, la mayoría de los tests, las lecturas de las 78 cartas (`lecturas.json`), varios scripts (voz, Instagram, YouTube) y las plantillas de historias.
- **`.env`** con los tokens locales (IG, YouTube, Gemini, Buffer) y `~/.modal.toml` con los perfiles de Modal. Los secretos de GitHub y Cloudflare siguen guardados del lado del servidor.
- **`lib/voz-matias-ref.wav`**, la referencia de tu voz. La app `hermes-voz` desplegada en Modal la sigue usando, pero si hay que redesplegarla hace falta encontrarla (Modal o el repo de Myths) o grabarla de nuevo.
- Renders locales, hojas de contacto, PNG de personajes. Los videos publicados están en el release `videos` de este repo.
- La memoria de Claude de la Mac (se recuperaron 14 notas, varias parciales).

**Cómo recuperar parte de la web**:
- Worker `hermes-comentarios`: en Cloudflare → Workers → hermes-comentarios → "Edit code" está el script desplegado.
- Functions de Pages: el último deployment de `hermestarot444` guarda el bundle compilado.
- Lecturas del bot: están en la tabla D1 `ig_cartas`.

## Archivos de este repo que estaban solo en la Mac

- `mazos.mjs` (publicador único del video de relevamiento de mazos, en pausa) y `historias/pregunta.py` (generador viejo de historias, parcial) estaban sin commitear en la Mac.
- Están copiados en `academia` → `recuperado-mac` → `recuperado/hermes-tarot/archivos/hermes-media/`. No los subí acá porque este repo es público: decidí vos si van.

## Próximos pasos

1. **Urgente**: armar un repo privado `tarot-web` con lo recuperado + el código bajado de Cloudflare (worker y Functions), para que la web no dependa de una sola máquina.
2. Recrear el entorno: `pip install modal`, `modal token new` para el perfil `tarot`, y un `.env` nuevo con los tokens (o correr todo desde GitHub Actions).
3. Confirmar que Three of Wands salió hoy y que el cron de Modal arma Four of Wands el 28/10.
4. Antes del 1/11: revisar el crédito de Modal `tarot`.
5. Pendientes que habías dejado:
   - Poner el tope de USD 30 en la cuenta de Modal `familia`.
   - Decidir si seguir día por medio o pasar a cada 36 h.
   - Opcional: que el bot entienda "another card" / "new card".
   - Horario de la clase, Tarot Club pago, títulos de YouTube, historias de Club y Curso.
