// Se inyecta en cada pestaña antes que la sala (evaluateOnNewDocument). Cada participante «habla» con un tono propio
// (frecuencia = 400 + 120·índice Hz) y cada pestaña escucha los audios que le llegan y anota cuándo aparece y desaparece
// el tono de cada uno. Así se mide, sin nadie real: cuánto tarda en oírse alguien desde que prende el mic y si se corta.
// La cámara es un canvas chico (320×180, 10 fps) para que 18 navegadores entren en una sola máquina de GitHub.
function inyectar(YO, NP, SIN_DTX) {
  // la prueba no tiene placa de video: sin animaciones ni filtros (no cambian el audio, solo bajan la CPU)
  document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;filter:none!important;box-shadow:none!important}'; document.head.appendChild(st); });
  const FREQ = (i) => 400 + 100 * i; // hasta 30 personas debajo de 3,4 kHz (más arriba el detector no los veía)
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
  // pantalla compartida: un lienzo de 640×360 (sin sonido)
  md.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d');
    setInterval(() => { x.fillStyle = '#123'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#fd0'; x.font = '40px sans-serif'; x.fillText('pantalla ' + (Date.now() % 100000), 20, 180); }, 100);
    return c.captureStream(10);
  };
  // música (la pone el anfitrión): un archivo WAV de 4 s con un tono de 300 Hz que se repite (debajo de las voces)
  window.__musica = async (on) => {
    if (!on) return pararMusica();
    const sr = 8000, n = sr * 4, b = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, t) => [...t].forEach((ch, k) => b.setUint8(o + k, ch.charCodeAt(0)));
    w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
    for (let k = 0; k < n; k++) b.setInt16(44 + k * 2, Math.round(9000 * Math.sin(2 * Math.PI * 300 * k / sr)), true);
    await musicaArchivo(new File([b.buffer], 'tono.wav', { type: 'audio/wav' }));
    if (S.musica?.el) S.musica.el.loop = true;
    return !!S.musica;
  };
  md.getUserMedia = async (c = {}) => {
    const t = [];
    if (c.audio) t.push(voz());
    if (c.video) t.push(camara());
    return new MediaStream(t);
  };

  // conexiones de la sala (para getStats) y los audios que llegan (para oír los tonos)
  window.__pcs = []; window.__pcev = [];
  const Orig = window.RTCPeerConnection;
  const PC = function (...a) {
    const pc = new Orig(...a); window.__pcs.push(pc); const n = window.__pcs.length;
    pc.addEventListener('connectionstatechange', () => window.__pcev.push([Date.now(), n, 'c', pc.connectionState]));
    pc.addEventListener('iceconnectionstatechange', () => window.__pcev.push([Date.now(), n, 'i', pc.iceConnectionState]));
    pc.addEventListener('track', (e) => { if (e.track.kind === 'audio') vigilar(e.track); });
    return pc;
  };
  if (SIN_DTX) { // variante de la prueba: la misma sala pero sin DTX (para ver si el DTX del silencio atrasa la voz)
    const srd = Orig.prototype.setRemoteDescription;
    Orig.prototype.setRemoteDescription = function (d, ...r) { if (d?.sdp) d = { type: d.type, sdp: d.sdp.replace(/;usedtx=1/g, '').replace(/usedtx=1;?/g, '') }; return srd.call(this, d, ...r); };
  }
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
  const oigo = new Array(NP + 2).fill(false); // NP = la música del anfitrión (300 Hz), NP + 1 = veo la pantalla de otro
  setInterval(() => {
    if (!AC) return;
    const ahora = Date.now(), hay = new Array(NP + 2).fill(false), ancho = AC.sampleRate / 2048;
    const vp = document.querySelector('.tile.pantalla:not(.yo) video');
    hay[NP + 1] = !!(vp && vp.videoWidth > 0 && vp.readyState >= 2 && !vp.paused);
    for (const x of AN) {
      if (x.track.readyState !== 'live') continue;
      x.an.getFloatFrequencyData(x.buf);
      let mb = 0, mv = -Infinity;
      for (let b = 10; b < 140; b++) if (x.buf[b] > mv) { mv = x.buf[b]; mb = b; }
      if (mv < -50) continue; // silencio
      if (Math.abs(mb * ancho - 300) < 2 * ancho) { hay[NP] = true; continue; }
      const s = Math.round((mb * ancho - 400) / 100);
      if (s >= 0 && s < NP && s !== YO && Math.abs(FREQ(s) - mb * ancho) < 2 * ancho) hay[s] = true;
    }
    for (let s = 0; s <= NP + 1; s++) if (hay[s] !== oigo[s]) { oigo[s] = hay[s]; window.__ev.push([ahora, s, hay[s] ? 1 : 0]); }
  }, 40);

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
    const o = { lost: 0, recv: 0, jbd: 0, jbe: 0, conc: 0, tot: 0, jit: [], rtt: null, audios: 0, videos: 0, enviados: 0,
      ac: typeof S !== 'undefined' && S.ac ? S.ac.state : 'sin', mic: typeof S !== 'undefined' ? !!S.mic : null,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
      trans: typeof S !== 'undefined' && S.pc ? S.pc.getTransceivers().length : null,
      sdp: typeof S !== 'undefined' && S.pc?.localDescription ? Math.round(S.pc.localDescription.sdp.length / 1000) : null };
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
        if (x.type === 'outbound-rtp' && x.kind === 'audio') o.enviados += x.packetsSent || 0;
        if (x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded' && x.currentRoundTripTime != null) o.rtt = x.currentRoundTripTime;
      });
    }
    return o;
  };
}
module.exports = { inyectar };
