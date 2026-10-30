#!/usr/bin/env python3
"""Sube la grabación de una clase al canal privado de Telegram y la agrega a la Biblioteca de /comunidad/.

  python3 subir.py clase.mp4 --titulo "Sesión 1 · 29/10" [--descripcion "..."] [--fecha 2026-10-29]
  python3 subir.py --url https://.../clase.mp4 --titulo "..."      (la baja primero; también links de Google Drive)

Usa la cuenta de Matías (Telegram Premium: archivos de hasta 4 GB, espacio ilimitado), no un bot (los bots suben hasta 50 MB).
Variables (secretos de GitHub Actions o del entorno; nunca se imprimen):
  TELEGRAM_API_ID, TELEGRAM_API_HASH  → https://my.telegram.org
  TELEGRAM_SESSION                    → la genera login.py
  TELEGRAM_CANAL                      → id del canal privado (ej. -1001234567890)
  BIBLIOTECA_TOKEN                    → el mismo valor que el secreto BIBLIOTECA_TOKEN de Cloudflare Pages
  BIBLIOTECA_URL (opcional)           → por defecto https://hermestarot444.pages.dev/api/comunidad/biblioteca
"""
import argparse
import asyncio
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MAX_BYTES = 4000 * 1024 * 1024  # tope de Telegram Premium (4000 MiB)
API = 'https://hermestarot444.pages.dev/api/comunidad/biblioteca'
UA = 'hermes-subir/1.0'


class SesionInvalida(SystemExit):
    """La sesión de Telegram no sirve: no es culpa del video (pendientes.py corta todo sin marcar error)."""


def falta(nombre: str) -> str:
    v = os.environ.get(nombre, '').strip()
    if not v:
        sys.exit(f'Falta la variable {nombre}')
    return v


def mb(n: int) -> str:
    return f'{n / 1024 / 1024:.1f} MB'


# ---------------- descarga ----------------
def nombre_de(url: str, cabecera: str = '') -> str:
    m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", cabecera or '')
    n = urllib.parse.unquote(m.group(1)) if m else Path(urllib.parse.urlparse(url).path).name
    n = re.sub(r'[^\w.\- ]+', '_', n).strip() or 'grabacion.mp4'
    return n if '.' in n else n + '.mp4'


def bajar(url: str, carpeta: Path, headers=None) -> Path:
    """headers: cabeceras extra (ej. Authorization para /api/grabaciones/archivo). http:// solo para localhost (tests)."""
    if not url.startswith('https://') and not re.match(r'http://(127\.0\.0\.1|localhost)[:/]', url):
        sys.exit('El link tiene que ser https://')
    if 'drive.google.com' in url or 'docs.google.com' in url:
        try:
            import gdown  # maneja la confirmación de archivos grandes de Drive
        except ImportError:
            sys.exit('Para links de Google Drive: pip install gdown')
        salida = gdown.download(url, output=str(carpeta) + os.sep, quiet=False, fuzzy=True)
        if not salida:
            sys.exit('No se pudo bajar de Google Drive (¿el archivo está compartido con "cualquiera con el link"?)')
        return Path(salida)
    req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        total = int(r.headers.get('content-length') or 0)
        if total > MAX_BYTES:
            sys.exit(f'El archivo pesa {mb(total)}: Telegram acepta hasta 4000 MB')
        destino = carpeta / nombre_de(url, r.headers.get('content-disposition', ''))
        hecho, aviso = 0, time.time()
        with open(destino, 'wb') as f:
            while True:
                bloque = r.read(4 * 1024 * 1024)
                if not bloque:
                    break
                hecho += len(bloque)
                if hecho > MAX_BYTES:
                    sys.exit('El archivo supera los 4000 MB que acepta Telegram')
                f.write(bloque)
                if time.time() - aviso > 15:
                    print(f'  bajando… {mb(hecho)}' + (f' de {mb(total)}' if total else ''), flush=True)
                    aviso = time.time()
    print(f'Bajado: {destino.name} ({mb(destino.stat().st_size)})')
    return destino


# ---------------- video ----------------
def datos_video(archivo: Path, carpeta: Path):
    """Duración, tamaño y miniatura con ffprobe/ffmpeg (si están). → (duracion, ancho, alto, miniatura | None)"""
    if not shutil.which('ffprobe'):
        return None
    try:
        out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration',
                              '-of', 'json', str(archivo)], capture_output=True, text=True, timeout=120, check=True).stdout
        j = json.loads(out)
        s = (j.get('streams') or [{}])[0]
        dur = int(float(j.get('format', {}).get('duration') or 0))
        w, h = int(s.get('width') or 0), int(s.get('height') or 0)
    except Exception as e:  # no es video o ffprobe falló: se sube igual como archivo
        print(f'  (sin datos de video: {e.__class__.__name__})')
        return None
    thumb = None
    if shutil.which('ffmpeg') and w and h:
        t = carpeta / 'miniatura.jpg'
        seg = min(30, max(dur // 10, 0))
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(seg), '-i', str(archivo), '-frames:v', '1', '-vf', 'scale=320:-2', str(t)],
                           capture_output=True, timeout=120)
        thumb = t if r.returncode == 0 and t.exists() else None
    return dur, w, h, thumb


def a_mp4(archivo: Path, carpeta: Path) -> Path:
    """Las grabaciones de la sala vienen en .webm: en el celular Telegram no las reproduce ahí mismo.
    Se pasan a MP4 (H.264 + AAC, se puede ver mientras carga). Si ffmpeg falla, se sube el original."""
    if archivo.suffix.lower() not in ('.webm', '.mkv') or not shutil.which('ffmpeg'):
        return archivo
    salida = carpeta / (archivo.stem + '.mp4')
    print(f'Pasando {archivo.name} a MP4…', flush=True)
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(archivo),
                        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(salida)],
                       capture_output=True, text=True)
    if r.returncode != 0 or not salida.exists() or salida.stat().st_size == 0:
        print(f'  (no se pudo pasar a MP4, se sube el original: {r.stderr.strip()[-300:]})')
        return archivo
    archivo.unlink(missing_ok=True)  # libera el disco del runner
    print(f'  listo: {salida.name} ({mb(salida.stat().st_size)})')
    return salida


# ---------------- Telegram ----------------
async def subir_telegram(archivo: Path, leyenda: str, carpeta: Path) -> str:
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    from telethon.tl.types import DocumentAttributeVideo

    api_id, api_hash, sesion, canal = int(falta('TELEGRAM_API_ID')), falta('TELEGRAM_API_HASH'), falta('TELEGRAM_SESSION'), falta('TELEGRAM_CANAL')
    client = TelegramClient(StringSession(sesion), api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        raise SesionInvalida('La sesión de Telegram no sirve más: correr login.py de nuevo y actualizar TELEGRAM_SESSION')
    try:
        await client.get_dialogs()  # la sesión en texto no guarda canales: se cargan para poder usar el id
        destino = await client.get_entity(int(canal) if re.fullmatch(r'-?\d+', canal) else canal)
        extra = {}
        v = datos_video(archivo, carpeta)
        if v:
            dur, w, h, thumb = v
            extra['attributes'] = [DocumentAttributeVideo(duration=dur, w=w, h=h, supports_streaming=True)]
            extra['supports_streaming'] = True
            if thumb:
                extra['thumb'] = str(thumb)
        estado = {'t': 0.0}

        def progreso(hecho, total):
            if time.time() - estado['t'] > 20 or hecho == total:
                print(f'  subiendo… {hecho * 100 // max(total, 1)}% ({mb(hecho)} de {mb(total)})', flush=True)
                estado['t'] = time.time()

        print(f'Subiendo {archivo.name} ({mb(archivo.stat().st_size)}) al canal…')
        msg = await client.send_file(destino, str(archivo), caption=leyenda[:1024], progress_callback=progreso, **extra)
        usuario = getattr(destino, 'username', None)
        return f'https://t.me/{usuario}/{msg.id}' if usuario else f'https://t.me/c/{destino.id}/{msg.id}'
    finally:
        await client.disconnect()


# ---------------- biblioteca ----------------
def agregar_biblioteca(item: dict) -> None:
    token = falta('BIBLIOTECA_TOKEN')
    url = os.environ.get('BIBLIOTECA_URL', '').strip() or API
    datos = json.dumps(item).encode()
    for intento in range(4):
        req = urllib.request.Request(url, data=datos, method='POST', headers={
            'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                j = json.loads(r.read() or b'{}')
                print('Biblioteca: ' + ('ya estaba' if j.get('repetido') else 'agregada') + f' (id {j.get("item", {}).get("id")})')
                return
        except urllib.error.HTTPError as e:
            cuerpo = e.read()[:300].decode(errors='replace')
            if e.code < 500:
                sys.exit(f'La biblioteca respondió {e.code}: {cuerpo}')
            print(f'  biblioteca {e.code}, reintento…')
        except OSError as e:  # URLError, timeout, conexión cortada
            print(f'  sin conexión con la biblioteca ({getattr(e, "reason", e.__class__.__name__)}), reintento…')
        time.sleep(5 * (intento + 1))
    sys.exit('No se pudo agregar a la biblioteca (el video ya está en Telegram: agregarlo a mano desde /comunidad/)')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('archivo', nargs='?', help='video local')
    ap.add_argument('--url', help='link https para bajar el video (en vez de un archivo local)')
    ap.add_argument('--titulo', default='', help='título en la biblioteca (por defecto: "Session · fecha")')
    ap.add_argument('--descripcion', default='')
    ap.add_argument('--fecha', default='', help='YYYY-MM-DD de la clase (por defecto hoy, UTC)')
    ap.add_argument('--tipo', default='recording', choices=['recording', 'file', 'spread', 'technique'])
    ap.add_argument('--sin-biblioteca', action='store_true', help='solo subir a Telegram')
    a = ap.parse_args()
    if bool(a.archivo) == bool(a.url):
        ap.error('pasá un archivo o --url (uno de los dos)')
    fecha = a.fecha or dt.datetime.now(dt.timezone.utc).date().isoformat()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', fecha):
        ap.error('--fecha tiene que ser YYYY-MM-DD')
    titulo = (a.titulo or f'Session · {fecha}').strip()[:120]
    descripcion = a.descripcion.strip()[:2000]

    with tempfile.TemporaryDirectory(prefix='subir-') as tmp:
        carpeta = Path(tmp)
        archivo = bajar(a.url, carpeta) if a.url else Path(a.archivo)
        if not archivo.is_file():
            sys.exit(f'No existe {archivo}')
        if archivo.stat().st_size > MAX_BYTES:
            sys.exit(f'{archivo.name} pesa {mb(archivo.stat().st_size)}: Telegram acepta hasta 4000 MB')
        leyenda = titulo + (f'\n\n{descripcion}' if descripcion else '')
        link = asyncio.run(subir_telegram(archivo, leyenda, carpeta))
    print(f'En Telegram: {link}')
    if not a.sin_biblioteca:
        agregar_biblioteca({'tipo': a.tipo, 'titulo': titulo, 'descripcion': descripcion, 'link': link, 'fecha': fecha})


if __name__ == '__main__':
    main()
