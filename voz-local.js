// Voz → texto en el propio teléfono (Whisper vía transformers.js). Gratis, privado, sin servidor.
// Se usa en iPhone, donde el reconocimiento de voz del navegador solo funciona una vez por apertura.
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
let asrP = null;
const OPC = { language: 'spanish', task: 'transcribe', max_new_tokens: 48 }; // frases cortas: decodificación acotada

// whisper-base cuantizado (76 MB, una sola descarga; luego queda en caché). Probado: "Gasolina 30.000 en primax." exacto.
export function cargarModelo(progreso) {
  return asrP ??= import(TJS).then(async ({ pipeline, env }) => {
    env.allowLocalModels = false;
    const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', { device: 'wasm', dtype: 'q8', progress_callback: progreso });
    await asr(new Float32Array(16000), OPC).catch(() => {}); // calentamiento: la 1.ª inferencia es la lenta
    return asr;
  }).catch(e => { asrP = null; throw e; });
}

const a16k = (buf, sr) => {
  if (sr === 16000) return buf;
  const r = sr / 16000, n = Math.floor(buf.length / r), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * r, j = Math.floor(x), f = x - j; o[i] = buf[j] * (1 - f) + (buf[j + 1] || 0) * f; }
  return o;
};
// Frases que Whisper "inventa" con ruido o silencio.
const ALUCINA = /amara\.org|suscr[ií]bete|gracias por ver|subt[ií]tulos/i;

/** Graba hasta detectar silencio tras hablar (o toque), transcribe y entrega el texto. */
export function crearGrabadora({ alEstado, alTexto, alError }) {
  let ctx, stream, src, proc, chunks = [], activo = false, ocupado = false;

  async function iniciar() {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    const reanudar = ctx.resume(); // dentro del toque (requisito iOS)
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await reanudar;
    src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    chunks = []; activo = true; alEstado('escuchando');
    const t0 = performance.now(); let habla = false, ultimaVoz = 0, voz = 0; // voz = ms acumulados hablando
    proc.onaudioprocess = e => {
      if (!activo) return;
      const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      const rms = Math.sqrt(s / d.length), ahora = performance.now();
      if (rms > 0.02) { if (habla) voz += ahora - ultimaVoz < 300 ? ahora - ultimaVoz : 0; habla = true; ultimaVoz = ahora; }
      if (habla && ahora - ultimaVoz > (voz < 1200 ? 1700 : 750)) detener(); // frase corta ("dime…"): espera más; si no, 0,75 s
      else if (!habla && ahora - t0 > 6000) detener(true);       // no habló
      else if (ahora - t0 > 15000) detener();                    // máximo 15 s
    };
    src.connect(proc); proc.connect(ctx.destination);
  }

  async function detener(sinVoz = false) {
    if (!activo) return; activo = false;
    try { proc.disconnect(); src.disconnect(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    if (sinVoz || !chunks.length) { alEstado('listo'); return alTexto(''); }
    const total = chunks.reduce((n, c) => n + c.length, 0), buf = new Float32Array(total);
    let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
    ocupado = true; alEstado('procesando');
    try {
      const asr = await cargarModelo();
      const { text } = await asr(a16k(buf, ctx.sampleRate), OPC);
      alTexto(ALUCINA.test(text) ? '' : text.trim());
    } catch (e) { alError(e); }
    finally { ocupado = false; alEstado('listo'); }
  }

  return {
    alternar() {
      if (ocupado) return;
      if (activo) return detener();
      iniciar().catch(e => { activo = false; alEstado('listo'); alError(e); });
    },
    cancelar() { if (activo) { chunks = []; detener(true); } }
  };
}
