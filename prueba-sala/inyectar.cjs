// Se inyecta en cada pestaña antes que la sala (evaluateOnNewDocument). Cada participante «habla» con un tono propio
// (frecuencia = 400 + 120·índice Hz) y cada pestaña escucha los audios que le llegan y anota cuándo aparece y desaparece
// el tono de cada uno. Así se mide, sin nadie real: cuánto tarda en oírse alguien desde que prende el mic y si se corta.
// La cámara es un canvas chico (320×180, 10 fps) para que 18 navegadores entren en una sola máquina de GitHub.
function inyectar(YO, NP) {
  const FREQ = (i) => 400 + 120 * i;
  let AC = null;
  const ac = () => { if (!AC) { AC = new AudioContext(); } if (AC.state !== 'running') AC.resume().catch(() => {}); return AC; };
  window.__hablando = false;
  const ganancias = [];
  window.__setHablar = (b) => {
    window.__hablando = b; const a = ac();
    for (const g of ganancias) g.gain.setValueAtTime(b ? 0.25 : 0, a.currentTime);
  };
  function voz() {
    const a = ac(), o = a.createOscillator(), g = a.createGain(), d = a.createMediaStreamDestination();
    o.frequency.value = FREQ(YO); g.gain.value = window.__hablando ? 0.25 : 0;
    o.connect(g); g.connect(d); o.start(); ganancias.push(g);
    return d.stream.getAudioTracks()[0];
  }
  function camara() {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const x = c.getContext('2d'), color = `hsl(${(YO * 47) % 360} 60% 45%)`;
    setInterval(() => { x.fillStyle = color; x.fillRect(0, 0, 320, 180); x.fillStyle = '#fff'; x.font = '28px sans-serif'; x.fillText('P' + YO + ' ' + (Date.now() % 100000), 10, 100); }, 100);
    return c.captureStream(10).getVideoTracks()[0];
  }
  const md = navigator.mediaDevices;
  md.getUserMedia = async (c = {}) => {
    const t = [];
    if (c.audio) t.push(voz());
    if (c.video) t.push(camara());
    return new MediaStream(t);
  };

  // conexiones de la sala (para getStats) y los audios que llegan (para oír los tonos)
  window.__pcs = [];
  const Orig = window.RTCPeerConnection;
  const PC = function (...a) {
    const pc = new Orig(...a); window.__pcs.push(pc);
    pc.addEventListener('track', (e) => { if (e.track.kind === 'audio') vigilar(e.track); });
    return pc;
  };
  PC.prototype = Orig.prototype; Object.setPrototypeOf(PC, Orig);
  window.RTCPeerConnection = PC;

  const AN = [];
  function vigilar(track) {
    try {
      const a = ac(), src = a.createMediaStreamSource(new MediaStream([track])), an = a.createAnalyser();
      an.fftSize = 2048; an.smoothingTimeConstant = 0; src.connect(an);
      AN.push({ an, track, buf: new Float32Array(an.frequencyBinCount) });
    } catch (e) { window.__fallas.push(['vigilar', String(e)]); }
  }
  window.__fallas = [];
  window.__ev = []; // [ms, quién, 1 = se oye / 0 = deja de oírse]
  const oigo = new Array(NP).fill(false);
  setInterval(() => {
    if (!AC) return;
    const ahora = Date.now(), hay = new Array(NP).fill(false), ancho = AC.sampleRate / 2048;
    for (const x of AN) {
      if (x.track.readyState !== 'live') continue;
      x.an.getFloatFrequencyData(x.buf);
      let mb = 0, mv = -Infinity;
      for (let b = 10; b < 140; b++) if (x.buf[b] > mv) { mv = x.buf[b]; mb = b; }
      if (mv < -50) continue; // silencio
      const s = Math.round((mb * ancho - 400) / 120);
      if (s >= 0 && s < NP && s !== YO && Math.abs(FREQ(s) - mb * ancho) < 2.5 * ancho) hay[s] = true;
    }
    for (let s = 0; s < NP; s++) if (hay[s] !== oigo[s]) { oigo[s] = hay[s]; window.__ev.push([ahora, s, hay[s] ? 1 : 0]); }
  }, 20);

  // errores de la señalización que ve el navegador (pulls que fallan, HTTP 4xx/5xx)
  window.__err = [];
  const f0 = window.fetch;
  window.fetch = async (u, o) => {
    const r = await f0(u, o);
    try {
      const url = String(u?.url || u);
      if (url.includes('/api/sala/')) {
        const ruta = url.split('/api/sala/')[1].split('?')[0];
        if (!r.ok && ruta !== 'stats') window.__err.push([Date.now(), ruta, r.status]);
        else if (ruta === 'tracks') r.clone().json().then((j) => (j.tracks || []).forEach((t) => t.errorCode && window.__err.push([Date.now(), ruta, t.errorCode]))).catch(() => {});
      }
    } catch (e) {}
    return r;
  };

  // resumen de getStats de todas mis conexiones (acumulado; la prueba saca las diferencias)
  window.__stats = async () => {
    const o = { lost: 0, recv: 0, jbd: 0, jbe: 0, conc: 0, tot: 0, jit: [], rtt: null, audios: 0, videos: 0 };
    for (const pc of window.__pcs) {
      if (pc.connectionState === 'closed') continue;
      (await pc.getStats()).forEach((x) => {
        if (x.type === 'inbound-rtp' && x.kind === 'audio') {
          o.audios++; o.lost += x.packetsLost || 0; o.recv += x.packetsReceived || 0;
          o.jbd += x.jitterBufferDelay || 0; o.jbe += x.jitterBufferEmittedCount || 0;
          o.conc += x.concealedSamples || 0; o.tot += x.totalSamplesReceived || 0;
          if (x.jitter != null && x.packetsReceived) o.jit.push(x.jitter);
        }
        if (x.type === 'inbound-rtp' && x.kind === 'video' && x.framesDecoded) o.videos++;
        if (x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded' && x.currentRoundTripTime != null) o.rtt = x.currentRoundTripTime;
      });
    }
    return o;
  };
}
module.exports = { inyectar };
