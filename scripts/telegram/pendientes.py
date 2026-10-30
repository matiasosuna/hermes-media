#!/usr/bin/env python3
"""Pasa las grabaciones de la sala (/sala/) que quedaron en R2 al canal privado de Telegram y a la Biblioteca de /comunidad/.

  python3 pendientes.py

Por cada grabación pendiente: la baja de /api/grabaciones/archivo/{id}, la pasa a MP4, la sube a Telegram (leyenda = título),
saca transcripción y resumen con Gemini (resumen.py: la transcripción va al canal como .txt; el resumen, a la descripción),
la agrega a la biblioteca (más un ítem "Transcripción · título") y avisa /hecha/{id} con el link (el servidor borra el
archivo de R2). Si Gemini o la transcripción fallan, la grabación se sube y se marca hecha igual.
Si una grabación falla, avisa /error/{id} (no se vuelve a listar) y sigue con la próxima; al final sale con código 1 si alguna falló.
Si la sesión de Telegram no sirve, corta todo sin marcar nada (las grabaciones siguen pendientes).

Variables: las mismas de subir.py (TELEGRAM_*, BIBLIOTECA_TOKEN; nunca se imprimen), GEMINI_API_KEY (sin ella no hay
transcripción ni resumen) y GRABACIONES_URL (opcional) → por defecto https://hermestarot444.pages.dev/api/grabaciones
"""
import asyncio
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resumen  # noqa: E402  (transcribir_y_resumir)
import subir  # noqa: E402  (bajar, subir_telegram, subir_documento, agregar_biblioteca)

API = 'https://hermestarot444.pages.dev/api/grabaciones'


def base() -> str:
    return (os.environ.get('GRABACIONES_URL', '').strip() or API).rstrip('/')


def auth() -> dict:
    return {'Authorization': f'Bearer {subir.falta("BIBLIOTECA_TOKEN")}'}


def pedir(ruta: str, cuerpo=None, intentos: int = 3) -> dict:
    """GET (sin cuerpo) o POST JSON a /api/grabaciones/<ruta>, con reintentos ante 5xx o cortes. Errores → RuntimeError."""
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    ultimo = ''
    for intento in range(intentos):
        req = urllib.request.Request(f'{base()}/{ruta}', data=datos, method='POST' if datos else 'GET', headers={
            **auth(), 'Content-Type': 'application/json', 'User-Agent': subir.UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            ultimo = f'{e.code}: {e.read()[:200].decode(errors="replace")}'
            if e.code < 500:
                break
        except OSError as e:  # URLError, timeout, conexión cortada
            ultimo = str(getattr(e, 'reason', '') or e.__class__.__name__)
        if intento < intentos - 1:
            time.sleep(3 * (intento + 1))
    raise RuntimeError(f'/{ruta.split("/")[0]} respondió {ultimo}')


def bajar_con_reintentos(g: dict, carpeta: Path) -> Path:
    url = f'{base()}/archivo/{g["id"]}'
    for intento in range(3):
        try:
            return subir.bajar(url, carpeta, headers=auth())
        except urllib.error.HTTPError as e:
            if e.code < 500 or intento == 2:
                raise RuntimeError(f'no se pudo bajar el archivo ({e.code})') from None
        except OSError as e:
            if intento == 2:
                raise RuntimeError(f'no se pudo bajar el archivo ({getattr(e, "reason", "") or e.__class__.__name__})') from None
        print('  reintento la descarga…', flush=True)
        time.sleep(10 * (intento + 1))
    raise RuntimeError('no se pudo bajar el archivo')


def nombre_txt(titulo: str) -> str:
    return 'Transcripcion - ' + (re.sub(r'[^\w\- ]+', '-', titulo).strip(' -') or 'clase')[:80] + '.txt'


def extras(archivo: Path, titulo: str, fecha: str, carpeta: Path):
    """Transcripción (.txt al canal) y resumen, con Gemini → (resumen, link del .txt). Nunca corta la subida:
    si algo falla, devuelve lo que haya ('' / None). En el log solo tamaños y estados (el repo es público)."""
    r = resumen.transcribir_y_resumir(archivo, carpeta)
    if not r:
        return '', None
    link_txt = None
    try:
        txt = carpeta / nombre_txt(titulo)
        txt.write_text(f'{titulo}' + (f' · {fecha}' if fecha else '') +
                       '\nTranscripción automática (Gemini): puede tener errores.\n\n' + r['transcripcion'] + '\n', encoding='utf-8')
        link_txt = asyncio.run(subir.subir_documento(txt, f'Transcripción · {titulo}'))
        print(f'Transcripción en Telegram: {link_txt}')
    except (Exception, SystemExit) as e:  # incluye SesionInvalida: el video ya está, esto es un extra
        print(f'  (no se pudo subir la transcripción: {e.__class__.__name__})')
    return r['resumen'], link_txt


def procesar(g: dict) -> str:
    """Una grabación de punta a punta → link de Telegram. Cualquier error sale como excepción (o SystemExit de subir.py).
    La transcripción y el resumen son extras: si fallan, la grabación cuenta como hecha igual."""
    fecha = str(g.get('fecha') or '')[:10]
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', fecha):
        fecha = ''
    titulo = (str(g.get('titulo') or '').strip() or f'Session · {fecha}'.strip(' ·'))[:120]
    if int(g.get('tamano') or 0) > subir.MAX_BYTES:
        raise RuntimeError(f'pesa {subir.mb(int(g["tamano"]))}: Telegram acepta hasta 4000 MB')
    with tempfile.TemporaryDirectory(prefix='grabacion-') as tmp:  # se borra al terminar cada una (disco del runner)
        carpeta = Path(tmp)
        archivo = bajar_con_reintentos(g, carpeta)
        archivo = subir.a_mp4(archivo, carpeta)
        # primero el video: si Telegram falla no se gasta el cupo gratis de Gemini en cada corrida
        link = asyncio.run(subir.subir_telegram(archivo, titulo, carpeta))
        print(f'En Telegram: {link}')
        descripcion, link_txt = extras(archivo, titulo, fecha, carpeta)
    try:
        subir.agregar_biblioteca({'tipo': 'recording', 'titulo': titulo, 'descripcion': descripcion[:8000], 'link': link, 'fecha': fecha})
    except SystemExit as e:
        raise RuntimeError(f'subida a {link} pero no se agregó a la biblioteca: {e.code}') from None
    if link_txt:
        try:
            subir.agregar_biblioteca({'tipo': 'file', 'titulo': f'Transcripción · {titulo}'[:120],
                                      'descripcion': 'Transcripción automática de la clase (Gemini): puede tener errores.',
                                      'link': link_txt, 'fecha': fecha})
        except SystemExit as e:
            print(f'  (la transcripción está en {link_txt} pero no se agregó a la biblioteca: {e.code})')
    return link


def main() -> int:
    subir.falta('BIBLIOTECA_TOKEN')
    lista = pedir('pendientes').get('grabaciones') or []
    if not lista:
        print('No hay grabaciones pendientes.')
        return 0
    for v in ('TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION', 'TELEGRAM_CANAL'):
        subir.falta(v)  # antes de tocar nada: si falta un secreto no se marca ninguna como error
    print(f'{len(lista)} grabación(es) pendiente(s).')
    fallas = 0
    for g in lista:
        gid = g.get('id')
        print(f'\n— #{gid} {g.get("titulo") or ""} ({g.get("nombre") or "?"}, {subir.mb(int(g.get("tamano") or 0))})', flush=True)
        try:
            link = procesar(g)
        except subir.SesionInvalida:
            raise  # no es culpa de la grabación: queda pendiente para la próxima corrida
        except (Exception, SystemExit) as e:
            fallas += 1
            mensaje = str(e.code if isinstance(e, SystemExit) else e) or e.__class__.__name__
            print(f'  ✗ falló: {mensaje}', flush=True)
            try:
                pedir(f'error/{gid}', {'mensaje': mensaje[:500]})
            except RuntimeError as e2:
                print(f'  (tampoco se pudo marcar el error: {e2})')
            continue
        try:
            pedir(f'hecha/{gid}', {'link': link})
            print(f'  ✓ #{gid} lista')
        except RuntimeError as e:
            fallas += 1
            print(f'  ✗ subida a {link} pero no se pudo marcar hecha: {e}')
            try:  # para que la próxima corrida no la suba dos veces
                pedir(f'error/{gid}', {'mensaje': f'Ya está en Telegram ({link}) y en la biblioteca; no se pudo marcar hecha'})
            except RuntimeError:
                pass
    print(f'\nListo: {len(lista) - fallas} bien, {fallas} con error.')
    return 1 if fallas else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except RuntimeError as e:  # no se pudo ni listar: no se marca nada
        sys.exit(f'Grabaciones: {e}')
