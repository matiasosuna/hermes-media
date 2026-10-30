#!/usr/bin/env python3
"""Transcripción y resumen de una clase grabada, con Gemini (clave gratis; nunca se paga).

  python3 resumen.py clase.mp4 [--salida carpeta]   (prueba local: guarda transcripcion.txt y resumen.txt)

transcribir_y_resumir(archivo, carpeta) → {'transcripcion': str, 'resumen': str} o None.
  1. ffmpeg saca el audio liviano (mono 16 kHz, opus ~24 kbps) en partes de 30 min dentro de `carpeta`.
  2. Cada parte se sube a la Files API de Gemini, se transcribe (idioma original, con quién habla) y se borra.
  3. Una segunda llamada, solo texto, arma el resumen para la Biblioteca (texto plano, hasta ~3500 caracteres).
Nunca lanza excepciones: si falta la clave, Gemini no responde o se pasa del tope de tiempo (RESUMEN_MAX_MIN, 15 min
por defecto), devuelve None y la grabación se sube igual. Si sale la transcripción pero no el resumen, 'resumen' = ''.
Plan gratis: da 429/503 seguido → cadena de modelos, reintentos cortos y se saltea el modelo que no existe.
El repo y los logs de Actions son PÚBLICOS: acá solo se imprimen tamaños y estados, nunca texto de la clase ni la clave.

Variables: GEMINI_API_KEY (secreto de Actions; en la Mac: boveda correr -p general -- python3 resumen.py …),
  RESUMEN_MAX_MIN (opcional).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

API = 'https://generativelanguage.googleapis.com'
MODELOS = ['gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash']  # los mismos que tarot-web/scripts/lecturas.mjs
PARTE_SEG = 30 * 60   # audio por llamada: ~8 mil tokens de salida, lejos del tope de cada modelo
MAX_RESUMEN = 3500
UA = 'hermes-resumen/1.0'

TRANSCRIBIR = """Esto es el audio de una clase del Hermes Tarot Club (clases de tarot en español y/o inglés). {parte}
Transcribí TODO lo que se dice, palabra por palabra, en el idioma en que se habla. No traduzcas: si mezclan español e inglés, dejalo así.
- Matías es el profesor. Al principio de cada intervención poné quién habla, cuando se distinga: "Matías:" para él; para los demás,
  el nombre si se escucha en la clase, o si no "Participante 1:", "Participante 2:", etc. (siempre el mismo rótulo para la misma voz).
- Un párrafo por intervención, con una línea en blanco entre párrafos.
- Más o menos cada 5 minutos, una marca de tiempo sola en su línea, como [00:05:00], contando desde el principio de la clase{desde}.
- Nada de resúmenes, comentarios, títulos ni markdown. Si algo no se entiende, poné [inaudible].
- Si en todo el audio no habla nadie, respondé solamente: [SIN VOZ]"""

RESUMIR = """Abajo está la transcripción automática de una clase del Hermes Tarot Club (el profesor es Matías).
Escribí un resumen para los miembros del club, en el idioma principal de la clase (si casi todo es en inglés, en inglés; si es en
español, en español neutro).
Formato: texto plano, sin markdown (nada de #, **, tablas ni links). Cada título de sección solo en su línea y, debajo, puntos que
empiezan con "- ". Máximo 3000 caracteres en total.
Secciones, en este orden (con estos títulos, traducidos si la clase es en inglés; si en la clase no hubo nada de una, salteala):
Temas
Cartas que se vieron
Ejercicios / dinámicas
Para practicar en casa
Solo lo que está en la transcripción: no inventes cartas, significados, ejercicios ni tareas que no se digan. No nombres a los
participantes (solo a Matías). Si la transcripción es muy corta o no se habla de tarot, decilo en una línea.

TRANSCRIPCIÓN:
{texto}"""


class _Falla(Exception):
    """Error propio: su mensaje es seguro para un log público (sin texto de la clase ni claves)."""


class _Gemini:
    def __init__(self, clave: str, limite: float):
        self.clave, self.limite = clave, limite   # limite: time.monotonic() en que hay que cortar
        self.subidos: list[str] = []              # archivos en Google, para borrarlos sí o sí
        self.caidos: set[str] = set()             # modelos que no existen / no se pueden usar: no se reintentan
        self.sin_pensar: set[str] = set()         # modelos que rechazaron thinkingConfig
        self.cortar = False

    def restante(self) -> float:
        r = self.limite - time.monotonic()
        if r < 5 or self.cortar:
            raise _Falla('se terminó el tiempo')
        return r

    def esperar(self, seg: float) -> None:
        time.sleep(max(0.0, min(seg, self.restante() - 5)))

    def http(self, url: str, datos=None, headers=None, metodo=None, timeout: float = 60):
        """→ (cabeceras, json). HTTPError y errores de red siguen de largo (los maneja quien llama)."""
        req = urllib.request.Request(url, data=datos, method=metodo, headers={
            'x-goog-api-key': self.clave, 'User-Agent': UA, **(headers or {})})  # la clave va en cabecera, nunca en la URL
        with urllib.request.urlopen(req, timeout=max(5.0, min(timeout, self.restante()))) as r:
            cuerpo = r.read()
            return r.headers, (json.loads(cuerpo) if cuerpo else {})

    # ---------- Files API ----------
    def subir(self, ruta: Path, mime: str) -> dict:
        tam = ruta.stat().st_size
        for intento in range(3):
            try:
                cab, _ = self.http(f'{API}/upload/v1beta/files', json.dumps({'file': {'display_name': ruta.stem}}).encode(), {
                    'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
                    'X-Goog-Upload-Header-Content-Length': str(tam), 'X-Goog-Upload-Header-Content-Type': mime,
                    'Content-Type': 'application/json'}, 'POST', 30)
                url = cab.get('X-Goog-Upload-URL')
                if not url:
                    raise _Falla('la subida no devolvió URL')
                _, j = self.http(url, ruta.read_bytes(), {'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize',
                                                          'Content-Type': mime}, 'POST', 180)
                break
            except urllib.error.HTTPError as e:
                if e.code < 500 and e.code != 429 or intento == 2:
                    raise _Falla(f'subida a Gemini: HTTP {e.code}') from None
            except (OSError, ValueError) as e:  # timeout, conexión cortada, json raro
                if intento == 2:
                    raise _Falla(f'subida a Gemini: {e.__class__.__name__}') from None
            self.esperar(10 * (intento + 1))
        info = j.get('file') or {}
        if not info.get('name'):
            raise _Falla('la subida no devolvió el archivo')
        self.subidos.append(info['name'])
        while info.get('state') == 'PROCESSING':
            self.esperar(3)
            try:
                _, info = self.http(f'{API}/v1beta/{info["name"]}', timeout=20)
            except (OSError, ValueError):
                continue  # un corte al consultar el estado: se vuelve a preguntar
        if info.get('state') != 'ACTIVE':
            raise _Falla(f'Gemini dejó el audio en estado {info.get("state")}')
        return info

    def borrar(self, nombre: str) -> None:
        try:
            req = urllib.request.Request(f'{API}/v1beta/{nombre}', method='DELETE', headers={'x-goog-api-key': self.clave, 'User-Agent': UA})
            urllib.request.urlopen(req, timeout=15).close()
        except Exception:
            pass  # igual se borra solo a las 48 h
        if nombre in self.subidos:
            self.subidos.remove(nombre)

    def borrar_todo(self) -> None:
        for n in list(self.subidos):
            self.borrar(n)

    # ---------- generateContent con cadena de modelos ----------
    def generar(self, partes: list, max_tokens: int, timeout: float) -> tuple[str, str]:
        """→ (texto, modelo). Prueba los modelos en orden, dos rondas (la segunda después de esperar un poco)."""
        ultimo = 'sin modelos'
        for ronda in range(2):
            for m in MODELOS:
                if m in self.caidos:
                    continue
                for intento in range(2):
                    cfg = {'maxOutputTokens': max_tokens}
                    if m not in self.sin_pensar:  # pensar no ayuda a transcribir y se come tokens de salida
                        cfg['thinkingConfig'] = {'thinkingBudget': 0} if m.startswith('gemini-2.') else {'thinkingLevel': 'low'}
                    cuerpo = json.dumps({'contents': [{'role': 'user', 'parts': partes}], 'generationConfig': cfg}).encode()
                    try:
                        _, d = self.http(f'{API}/v1beta/models/{m}:generateContent', cuerpo, {'Content-Type': 'application/json'}, 'POST', timeout)
                    except urllib.error.HTTPError as e:
                        ultimo = f'{m}: HTTP {e.code}'
                        print(f'  gemini {ultimo}', flush=True)
                        if e.code == 400 and 'thinkingConfig' in cfg:
                            self.sin_pensar.add(m)  # probablemente no acepta esa opción: otra vez sin ella
                            continue
                        if e.code in (400, 403, 404):
                            self.caidos.add(m)
                            break
                        if e.code == 429:
                            break  # sin cupo: al siguiente modelo
                        self.esperar(8)  # 500/503: uno más con el mismo
                        continue
                    except (OSError, ValueError) as e:  # timeout o corte: no colgarse con un modelo lento
                        ultimo = f'{m}: {e.__class__.__name__}'
                        print(f'  gemini {ultimo}', flush=True)
                        break
                    cand = (d.get('candidates') or [{}])[0]
                    texto = ''.join(p.get('text', '') for p in (cand.get('content') or {}).get('parts') or [] if not p.get('thought')).strip()
                    fin = cand.get('finishReason', '?')
                    if texto:
                        if fin == 'MAX_TOKENS':
                            print(f'  gemini {m}: se cortó por largo (se usa igual)', flush=True)
                            texto += '\n[…]'
                        return texto, m
                    ultimo = f'{m}: respuesta vacía ({fin})'
                    print(f'  gemini {ultimo}', flush=True)
                    break
            if ronda == 0:
                self.esperar(45)
        raise _Falla(f'Gemini no respondió ({ultimo})')


# ---------------- audio ----------------
def duracion(archivo: Path) -> float:
    try:
        out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(archivo)],
                             capture_output=True, text=True, timeout=120).stdout
        return float(out.strip() or 0)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


def sacar_audio(archivo: Path, carpeta: Path, tope: float) -> tuple[list[Path], str]:
    """Audio de voz liviano en partes de PARTE_SEG → (partes, mime). Prueba opus y, si no anda, mp3."""
    destino = carpeta / 'audio-resumen'
    for codec, ext, mime in ((['-c:a', 'libopus', '-b:a', '24k', '-application', 'voip'], 'ogg', 'audio/ogg'),
                             (['-c:a', 'libmp3lame', '-b:a', '32k'], 'mp3', 'audio/mpeg')):
        shutil.rmtree(destino, ignore_errors=True)
        destino.mkdir()
        try:
            r = subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(archivo), '-vn', '-ac', '1', '-ar', '16000', *codec,
                                '-f', 'segment', '-segment_time', str(PARTE_SEG), '-reset_timestamps', '1', str(destino / f'parte%03d.{ext}')],
                               capture_output=True, timeout=max(30, tope))
        except subprocess.TimeoutExpired:
            raise _Falla('ffmpeg tardó demasiado sacando el audio') from None
        partes = sorted(p for p in destino.glob(f'parte*.{ext}') if p.stat().st_size > 1000)
        if r.returncode == 0 and partes:
            return partes, mime
    raise _Falla('no se pudo sacar el audio (¿la grabación no tiene sonido?)')


def hhmmss(seg: float) -> str:
    s = int(seg)
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def limpiar_resumen(t: str) -> str:
    """Saca restos de markdown y lo deja en MAX_RESUMEN caracteres, cortando en un fin de línea."""
    t = re.sub(r'\*\*|__|`', '', t)
    t = re.sub(r'(?m)^\s{0,3}#{1,6}\s*', '', t)
    t = re.sub(r'(?m)^(\s*)[*•]\s+', r'\1- ', t)
    t = re.sub(r'\n{3,}', '\n\n', t).strip()
    if len(t) > MAX_RESUMEN:
        corte = t.rfind('\n', 0, MAX_RESUMEN - 2)
        t = t[:corte if corte > MAX_RESUMEN // 2 else MAX_RESUMEN - 2].rstrip() + '\n…'
    return t


# ---------------- todo junto ----------------
def _hacer(g: _Gemini, archivo: Path, carpeta: Path) -> dict:
    dur = duracion(archivo)
    partes, mime = sacar_audio(archivo, carpeta, g.restante())
    print(f'Resumen: audio de {dur / 60:.0f} min en {len(partes)} parte(s) ({sum(p.stat().st_size for p in partes) / 1024 / 1024:.1f} MB)', flush=True)
    textos: list[str] = []
    for i, p in enumerate(partes):
        info = g.subir(p, mime)
        try:
            inicio = i * PARTE_SEG
            parte = '' if len(partes) == 1 else f'Es la parte {i + 1} de {len(partes)} del audio: puede empezar o terminar en medio de una frase.'
            if textos:  # para que siga con los mismos rótulos de quién habla
                parte += f'\nAsí terminaba la parte anterior (no la repitas):\n«…{textos[-1][-1200:]}»'
            prompt = TRANSCRIBIR.format(parte=parte, desde=f' (este audio empieza en {hhmmss(inicio)})' if inicio else '')
            texto, modelo = g.generar([{'file_data': {'mime_type': mime, 'file_uri': info['uri']}}, {'text': prompt}],
                                      max_tokens=32768, timeout=360)
        finally:
            g.borrar(info['name'])
        if texto.strip() != '[SIN VOZ]':
            textos.append(texto.strip())
        print(f'  parte {i + 1}/{len(partes)}: {len(texto)} caracteres ({modelo})', flush=True)
    transcripcion = '\n\n'.join(textos).strip()
    if len(transcripcion) < 40:
        raise _Falla('no se escucha a nadie hablando')
    resumen = ''
    try:
        texto, modelo = g.generar([{'text': RESUMIR.format(texto=transcripcion)}], max_tokens=4096, timeout=180)
        resumen = limpiar_resumen(texto)
        print(f'  resumen: {len(resumen)} caracteres ({modelo})', flush=True)
    except _Falla as e:
        print(f'  resumen: no salió ({e}); queda solo la transcripción', flush=True)
    return {'transcripcion': transcripcion, 'resumen': resumen}


def transcribir_y_resumir(archivo: Path, carpeta: Path, tope_min: float | None = None) -> dict | None:
    """{'transcripcion', 'resumen'} o None. Nunca lanza: ante cualquier problema imprime una línea y devuelve None."""
    g = None
    try:
        clave = os.environ.get('GEMINI_API_KEY', '').strip()
        if not clave:
            print('Resumen: sin GEMINI_API_KEY, se sube sin transcripción.')
            return None
        if not (shutil.which('ffmpeg') and shutil.which('ffprobe')):
            print('Resumen: falta ffmpeg, se sube sin transcripción.')
            return None
        if tope_min is None:
            try:
                tope_min = float(os.environ.get('RESUMEN_MAX_MIN') or 15)
            except ValueError:
                tope_min = 15
        tope = max(60.0, tope_min * 60)
        g = _Gemini(clave, time.monotonic() + tope)
        res: dict = {}

        def trabajo():
            try:
                res['ok'] = _hacer(g, Path(archivo), Path(carpeta))
            except _Falla as e:
                res['error'] = str(e)
            except Exception as e:  # noqa: BLE001  solo el tipo: el mensaje podría traer texto de la clase
                res['error'] = f'error inesperado ({e.__class__.__name__})'
            finally:
                g.borrar_todo()

        hilo = threading.Thread(target=trabajo, name='resumen', daemon=True)
        hilo.start()
        hilo.join(tope + 30)  # tope duro: si algo se cuelga igual, el robot sigue
        if hilo.is_alive():
            g.cortar = True
            g.borrar_todo()
            print(f'Resumen: se pasó de {tope / 60:.0f} min, se sube sin transcripción.')
            return None
        if 'ok' in res:
            return res['ok']
        print(f'Resumen: {res.get("error") or "falló"}; se sube sin transcripción.')
        return None
    except BaseException as e:  # noqa: BLE001  nunca cortar la subida por esto (ni con SystemExit)
        if isinstance(e, KeyboardInterrupt):
            raise
        print(f'Resumen: error inesperado ({e.__class__.__name__}); se sube sin transcripción.')
        if g:
            g.borrar_todo()
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('archivo', help='video o audio de la clase')
    ap.add_argument('--salida', help='carpeta donde guardar transcripcion.txt y resumen.txt (por defecto, al lado del archivo)')
    a = ap.parse_args()
    archivo = Path(a.archivo)
    if not archivo.is_file():
        sys.exit(f'No existe {archivo}')
    salida = Path(a.salida) if a.salida else archivo.parent
    salida.mkdir(parents=True, exist_ok=True)
    t = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='resumen-') as tmp:
        r = transcribir_y_resumir(archivo, Path(tmp))
    if not r:
        sys.exit(1)
    (salida / 'transcripcion.txt').write_text(r['transcripcion'] + '\n', encoding='utf-8')
    (salida / 'resumen.txt').write_text(r['resumen'] + '\n', encoding='utf-8')
    print(f'Listo en {time.monotonic() - t:.0f} s: transcripción {len(r["transcripcion"])} caracteres, resumen {len(r["resumen"])} → {salida}')


if __name__ == '__main__':
    main()
