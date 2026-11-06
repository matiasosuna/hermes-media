#!/usr/bin/env bash
# Imagen de historia para un hito de seguidores (1080x1920, fondo azul y dorado de la marca, una carta al centro).
# Corre en GitHub Actions (workflow "imagen"), no en la Mac.
# Uso: ./imagenes/hito.sh "5,000" "Next: 10,000" imagenes/XXI.jpg salida.png
set -euo pipefail
NUM="$1"; SIG="$2"; CARTA="$3"; SAL="$4"
D="$(cd "$(dirname "$0")/.." && pwd)"; F="$D/fuentes"
T="$(mktemp -d)"
printf '%s' "$NUM" > "$T/num"; printf 'THANK YOU' > "$T/gracias"; printf '%s' "$SIG" > "$T/sig"
ffmpeg -v error -y -f lavfi -i "color=c=0x0d1430:s=1080x1920" -i "$CARTA" -filter_complex "
  [1:v]scale=474:820,setsar=1[c];
  [0:v]drawbox=x=297:y=634:w=486:h=832:color=0xE8C877:t=2[f];
  [f][c]overlay=303:640,
  drawtext=fontfile=$F/Cinzel.ttf:textfile=$T/num:fontcolor=0xE8C877:fontsize=200:x=(w-text_w)/2:y=300,
  drawtext=fontfile=$F/Cinzel.ttf:textfile=$T/gracias:fontcolor=white:fontsize=50:x=(w-text_w)/2:y=530,
  drawtext=fontfile=$F/EBGaramond-Italic.ttf:textfile=$T/sig:fontcolor=0xE8C877:fontsize=62:x=(w-text_w)/2:y=1520" \
  -frames:v 1 "$SAL"
