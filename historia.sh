#!/usr/bin/env bash
# Historia de IG para un reel recién publicado: los primeros 15 s del video, achicado al centro (zona segura de las
# historias), sobre el fondo azul de la marca, con "NEW CARD ON MY PROFILE" arriba y la invitación a responder abajo
# (las respuestas a una historia llegan como DM).
# Uso: ./historia.sh entrada.mp4 salida.mp4
set -euo pipefail
ENT="$1"; SAL="$2"
F="$(cd "$(dirname "$0")" && pwd)/fuentes"
ffmpeg -v error -y -t 15 -i "$ENT" -filter_complex "
  color=c=0x0d1430:s=1080x1920:d=15,format=yuv420p[fondo];
  [0:v]scale=702:1248,setsar=1[v];
  [fondo][v]overlay=(W-w)/2:330[base];
  [base]drawtext=fontfile=$F/Cinzel.ttf:text='NEW CARD':fontcolor=0xE8C877:fontsize=72:x=(w-text_w)/2:y=168,
        drawtext=fontfile=$F/Cinzel.ttf:text='ON MY PROFILE':fontcolor=0xE8C877:fontsize=40:x=(w-text_w)/2:y=258,
        drawtext=fontfile=$F/EBGaramond-Italic.ttf:text='Reply and tell me':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=1606,
        drawtext=fontfile=$F/EBGaramond-Italic.ttf:text='what you felt':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=1672[out]" \
  -map "[out]" -map 0:a? -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$SAL"
