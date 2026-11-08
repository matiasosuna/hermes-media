"""El video de una clase → Modal, para verlo en Club > Recordings (Matías, 8/11/2026: reemplaza a YouTube no listado).

Sube al Volume «hermes-grabaciones» g<ID>.mp4 (el video) y g<ID>.jpg (miniatura: un cuadro del minuto 1), con el ID de la
fila de D1. Los sirve modal/grabaciones.py con link firmado. Devuelve 'g<ID>', que va a /api/grabaciones/hecha/ID como «video».
Variables: MODAL_TOKEN_ID y MODAL_TOKEN_SECRET (bóveda modal-tarot; secretos de hermes-media). Sin ellas, hay() = False.
"""
import os
import shutil
import subprocess
from pathlib import Path

VOLUMEN = 'hermes-grabaciones'


def hay() -> bool:
    return bool(os.environ.get('MODAL_TOKEN_ID') and os.environ.get('MODAL_TOKEN_SECRET'))


def _ffmpeg(args: list, salida: Path, timeout: int) -> bool:
    try:
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', *args, str(salida)], capture_output=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0 and salida.exists() and salida.stat().st_size > 0


def para_web(video: Path, carpeta: Path) -> Path:
    """MP4 que el navegador puede empezar a ver y adelantar enseguida: el índice al principio (+faststart).
    Solo se reacomoda (sin recodificar, segundos). Lo que viene de a_mp4 ya está así; el .mp4 de Safari o de Meet, no siempre."""
    if not shutil.which('ffmpeg'):
        return video
    salida = carpeta / 'web.mp4'
    if _ffmpeg(['-i', str(video), '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart'], salida, 1800):
        return salida
    salida.unlink(missing_ok=True)
    return video


def miniatura(video: Path, carpeta: Path):
    if not shutil.which('ffmpeg'):
        return None
    salida = carpeta / 'miniatura.jpg'
    for t in ('60', '5', '0'):  # si la clase dura menos de un minuto, un cuadro de antes
        if _ffmpeg(['-ss', t, '-i', str(video), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4'], salida, 120):
            return salida
    return None


def subir(video: Path, gid, carpeta: Path) -> str:
    """→ 'g<ID>'. Cualquier error sale como excepción (el video ya está en Telegram: queda solo ahí)."""
    import modal  # pip install modal (solo en el robot)
    nombre = f'g{int(gid)}'
    web = para_web(video, carpeta)
    jpg = miniatura(web, carpeta)
    vol = modal.Volume.from_name(VOLUMEN, create_if_missing=True)
    with vol.batch_upload(force=True) as b:
        b.put_file(str(web), f'/{nombre}.mp4')
        if jpg:
            b.put_file(str(jpg), f'/{nombre}.jpg')
    if web != video:
        web.unlink(missing_ok=True)
    return nombre
