#!/usr/bin/env bash
# Red de alguien lejos (India/Europa → la sala): solo al tráfico UDP (el audio y el video con Realtime).
# Todo en la subida (la máquina de GitHub no deja redirigir la bajada: su clsact ya ocupa la entrada):
# RETARDO ms (± JITTER) y PERDIDA % hacia el SFU → RTT ≈ RETARDO; entre dos personas, A→B tiene el retardo y la pérdida enteros
# (lo mismo que la mitad en la subida de A y la mitad en la bajada de B).
# La señalización (TCP, al servidor local y de ahí a la API de Realtime) no pasa por acá: la atrasa server.mjs.
set -euo pipefail
RETARDO=${RETARDO:-200} JITTER=${JITTER:-10} PERDIDA=${PERDIDA:-3}
DEV=$(ip route show default | awk '{print $5; exit}')
tc qdisc del dev "$DEV" root 2>/dev/null || true
tc qdisc replace dev "$DEV" root handle 1: prio
tc qdisc add dev "$DEV" parent 1:3 handle 30: netem delay ${RETARDO}ms ${JITTER}ms distribution normal loss ${PERDIDA}%
tc filter add dev "$DEV" protocol ip parent 1:0 prio 3 u32 match ip protocol 17 0xff flowid 1:3
tc qdisc show dev "$DEV"
echo "red: ${RETARDO}±${JITTER} ms y ${PERDIDA}% en la subida UDP ($DEV)"
