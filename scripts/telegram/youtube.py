#!/usr/bin/env python3
"""Sube la grabación de una clase a YouTube como NO LISTADA (canal Hermes Tarot 444) para verla en /club/recordings/
con un embed (Matías, 5/11/2026: nadie entra a Telegram, todo se ve en la página; Telegram queda de respaldo).

Variables (las mismas del publicador; nunca se imprimen): HT_YT_CLIENT_ID, HT_YT_CLIENT_SECRET, HT_YT_REFRESH_TOKEN.
Cuota de la API: 1600 de 10.000 unidades por día cada subida.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CLAVES = ('HT_YT_CLIENT_ID', 'HT_YT_CLIENT_SECRET', 'HT_YT_REFRESH_TOKEN')
PEDAZO = 64 * 1024 * 1024  # múltiplo de 256 KB, como pide YouTube


def hay() -> bool:
    return all(os.environ.get(k) for k in CLAVES)


def token() -> str:
    datos = urllib.parse.urlencode({'client_id': os.environ['HT_YT_CLIENT_ID'], 'client_secret': os.environ['HT_YT_CLIENT_SECRET'],
                                    'refresh_token': os.environ['HT_YT_REFRESH_TOKEN'], 'grant_type': 'refresh_token'}).encode()
    with urllib.request.urlopen(urllib.request.Request('https://oauth2.googleapis.com/token', data=datos), timeout=30) as r:
        return json.loads(r.read())['access_token']


def _put(url: str, tok: str, datos: bytes, rango: str):
    """→ ('listo', id) | ('sigue', próximo byte). 308 = YouTube recibió hasta Range."""
    req = urllib.request.Request(url, data=datos, method='PUT', headers={
        'Authorization': f'Bearer {tok}', 'Content-Length': str(len(datos)), 'Content-Range': rango})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return 'listo', json.loads(r.read())['id']
    except urllib.error.HTTPError as e:
        if e.code != 308:
            raise
        r = e.headers.get('Range') or ''
        return 'sigue', (int(r.rsplit('-', 1)[1]) + 1 if r else 0)


def subir(archivo: Path, titulo: str, fecha: str = '') -> str:
    """Sube el mp4 (subida reanudable, en pedazos) → id del video. Errores → excepción (quien llama sigue sin YouTube)."""
    tok, tam = token(), archivo.stat().st_size
    meta = {'snippet': {'title': titulo[:100], 'categoryId': '27',
                        'description': 'Hermes Tarot 444 · Tarot Club class' + (f' · {fecha}' if fecha else '')},
            'status': {'privacyStatus': 'unlisted', 'embeddable': True, 'selfDeclaredMadeForKids': False}}
    req = urllib.request.Request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
                                 data=json.dumps(meta).encode(), method='POST', headers={
                                     'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json; charset=UTF-8',
                                     'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': str(tam)})
    with urllib.request.urlopen(req, timeout=60) as r:
        url = r.headers['Location']
    inicio, fallas = 0, 0
    with open(archivo, 'rb') as f:
        while True:
            try:
                f.seek(inicio)
                datos = f.read(PEDAZO)
                estado, valor = _put(url, tok, datos, f'bytes {inicio}-{inicio + len(datos) - 1}/{tam}')
                if estado == 'listo':
                    return valor
                inicio, fallas = valor, 0
                print(f'  YouTube: {inicio * 100 // tam}%', flush=True)
            except (urllib.error.HTTPError, OSError) as e:
                code = getattr(e, 'code', 0)
                if (code and code < 500) or fallas >= 5:
                    raise
                fallas += 1
                time.sleep(10 * fallas)
                estado, valor = _put(url, tok, b'', f'bytes */{tam}')  # ¿hasta dónde llegó?
                if estado == 'listo':
                    return valor
                inicio = valor
