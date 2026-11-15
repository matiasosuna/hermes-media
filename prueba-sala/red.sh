#!/usr/bin/env bash
# Red de alguien lejos (India/Europa → la sala): solo al tráfico UDP (el audio y el video con Realtime), ida y vuelta.
# Cada sentido: RETARDO ms (± JITTER) y PERDIDA % → RTT ≈ 2·RETARDO; entre dos personas la pérdida se suma (subida + bajada).
# La señalización (TCP, al servidor local y de ahí a la API de Realtime) no pasa por acá: la atrasa server.mjs.
set -euo pipefail
RETARDO=${RETARDO:-100} JITTER=${JITTER:-10} PERDIDA=${PERDIDA:-1.5}
DEV=$(ip route show default | awk '{print $5; exit}')
# subida (la máquina de GitHub ya trae una qdisc en la raíz: se reemplaza)
tc qdisc del dev "$DEV" root 2>/dev/null || true
tc qdisc replace dev "$DEV" root handle 1: prio
tc qdisc add dev "$DEV" parent 1:3 handle 30: netem delay ${RETARDO}ms ${JITTER}ms distribution normal loss ${PERDIDA}%
tc filter add dev "$DEV" protocol ip parent 1:0 prio 3 u32 match ip protocol 17 0xff flowid 1:3
# bajada (por ifb)
modprobe ifb numifbs=1
ip link set dev ifb0 up
tc qdisc del dev "$DEV" ingress 2>/dev/null || true
tc qdisc add dev "$DEV" handle ffff: ingress
tc filter add dev "$DEV" parent ffff: protocol ip u32 match ip protocol 17 0xff action mirred egress redirect dev ifb0
tc qdisc add dev ifb0 root netem delay ${RETARDO}ms ${JITTER}ms distribution normal loss ${PERDIDA}%
tc -s qdisc show dev "$DEV" | head -20
echo "red: ${RETARDO}±${JITTER} ms y ${PERDIDA}% por sentido en UDP ($DEV)"
