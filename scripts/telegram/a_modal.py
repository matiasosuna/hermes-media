#!/usr/bin/env python3
"""Una grabación que ya está en el canal de Telegram → Modal, para escucharla (o verla) en Recordings (24/11/2026).

Para las que pasaron por el robot antes de que el audio fuera a Modal (p. ej. la reading del 24/11/2026): la baja del canal
con la cuenta (TELEGRAM_SESSION: sin el tope de 20 MB de la Bot API), la pasa a M4A si hace falta y la sube al Volume como
g<ID>.m4a (solo audio) o g<ID>.mp4 + .jpg (video), con el ID de la fila de D1 «grabaciones».

  python3 a_modal.py <ID de la fila> <número del mensaje en el canal>

No escribe en la D1: después el admin guarda video = 'g<ID>' en esa fila. Los logs son públicos: solo tamaños y duración.
Variables: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION, TELEGRAM_CANAL y MODAL_TOKEN_ID/SECRET (como pendientes.py).
"""
import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import modal_video  # noqa: E402
import subir  # noqa: E402


async def bajar(mensaje: int, carpeta: Path) -> Path:
    async with subir.canal() as (client, destino):
        msg = await client.get_messages(destino, ids=mensaje)
        if not msg or not msg.file:
            raise SystemExit(f'El mensaje {mensaje} no tiene archivo')
        print(f'Bajando el mensaje {mensaje}: {subir.mb(msg.file.size)}, {msg.file.mime_type}…', flush=True)
        return Path(await client.download_media(msg, file=str(carpeta / ('archivo' + (msg.file.ext or '')))))


def main() -> int:
    if len(sys.argv) != 3 or not all(a.isdigit() for a in sys.argv[1:]):
        sys.exit('Uso: a_modal.py <ID de la fila> <número del mensaje>')
    gid, mensaje = int(sys.argv[1]), int(sys.argv[2])
    if not modal_video.hay():
        sys.exit('Faltan MODAL_TOKEN_ID / MODAL_TOKEN_SECRET')
    with tempfile.TemporaryDirectory(prefix='a-modal-') as tmp:
        carpeta = Path(tmp)
        archivo = asyncio.run(bajar(mensaje, carpeta))
        audio = subir.es_audio(archivo.name) or subir.sin_video(archivo)
        if audio and archivo.suffix.lower() != '.m4a':
            archivo = subir.a_m4a(archivo, carpeta)
        print(f'{archivo.suffix}: {subir.mb(archivo.stat().st_size)}, {subir.duracion(archivo) // 60} min', flush=True)
        nombre = modal_video.subir_audio(archivo, gid) if audio else modal_video.subir(archivo, gid, carpeta)
    print(f'En Modal: {nombre}{".m4a" if audio else ".mp4"} (guardar video = {nombre} en la fila {gid})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
