// Registro por voz: dictado del navegador + intérprete local. Sin servicios pagos ($0).
import { parse, norm } from './parser.js';
import { crearConsultas } from './consultas.js';
import { parseRecordatorio, crearRecordatorios, TRIGGER } from './recordatorios.js';
import { crearGrabadora, cargarModelo } from './voz-local.js';

export function initAgente({ db, perfil, cats, fs, refrescar, mostrarMensaje }) {
  const { addDoc, collection } = fs;
  const COP = v => '$' + Math.round(v || 0).toLocaleString('es-CO');

  // Orbe: capa base + núcleo recortado que se mueve; al escuchar crece y cicla colores.
  document.head.insertAdjacentHTML('beforeend', `<style>
    .orb{position:fixed;right:14px;bottom:14px;width:84px;height:84px;padding:0;border:0;background:none;cursor:pointer;z-index:9999;
      touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .35s cubic-bezier(.34,1.56,.64,1);filter:drop-shadow(0 6px 12px #1a1f3a55)}
    .orb img{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;user-select:none}
    .orb .nucleo{clip-path:circle(37% at 50% 50%);transform-origin:50% 50%}
    .orb::before{content:'';position:absolute;inset:8%;border-radius:50%;opacity:0;transition:opacity .3s}
    .orb:active{transform:scale(.94)}
    .orb.on{transform:scale(1.18)}
    .orb.on::before{opacity:1;animation:halo 1.6s ease-in-out infinite}
    .orb.on .nucleo{animation:tono 2s linear infinite,mover 2.6s ease-in-out infinite}
    @keyframes tono{from{filter:hue-rotate(0deg) saturate(1.5) brightness(1.1)}to{filter:hue-rotate(360deg) saturate(1.5) brightness(1.1)}}
    @keyframes mover{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(14deg) scale(1.05)}50%{transform:rotate(-8deg) scale(.96)}75%{transform:rotate(10deg) scale(1.04)}}
    @keyframes halo{0%,100%{box-shadow:0 0 0 2px #9aa3ad55,0 0 10px 3px #9aa3ad44}50%{box-shadow:0 0 0 7px #9aa3ad33,0 0 22px 9px #9aa3ad33}}
    @media (prefers-reduced-motion:reduce){.orb.on .nucleo,.orb.on::before{animation-duration:6s}}
  </style>`);
  const mic = Object.assign(document.createElement('button'), { className: 'orb', title: 'Dictar gasto', ariaLabel: 'Dictar gasto' });
  mic.innerHTML = '<img src="img/orb.png" alt=""><img class="nucleo" src="img/orb.png" alt="">';
  const tst = document.createElement('div');
  tst.style.cssText = 'position:fixed;right:18px;bottom:112px;max-width:80vw;padding:10px 14px;border-radius:10px;color:#fff;font:600 15px system-ui;box-shadow:0 4px 14px #0004;z-index:9999;display:none';
  document.body.append(mic, tst);
  let ultimo = null;
  const aviso = (t, tipo = 'exito', ms = 4000) => {
    if (ms) ultimo = [t, tipo, Math.max(ms, 5000)];
    tst.textContent = t; tst.style.background = tipo === 'error' ? '#b3261e' : tipo === 'info' ? '#33475b' : '#1f7a55';
    tst.style.display = 'block'; if (tipo === 'exito') navigator.vibrate?.(120);
    clearTimeout(aviso.h); if (ms) aviso.h = setTimeout(() => (tst.style.display = 'none'), ms);
  };
  // Habla y resuelve al terminar (máx. 15 s).
  const hablar = t => new Promise(ok => {
    if (!('speechSynthesis' in window)) return ok(); speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.replace(/\$([\d.]+)/g, '$1 pesos')); u.lang = 'es-CO';
    u.onend = u.onerror = ok; setTimeout(ok, 15000); speechSynthesis.speak(u);
  });

  // iPhone: la voz del navegador solo funciona una vez por apertura → se usa grabación + Whisper local (voz-local.js).
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const previo = sessionStorage.getItem('avisoVoz');
  if (previo) { sessionStorage.removeItem('avisoVoz'); aviso(...JSON.parse(previo)); }

  const fecha = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return { fecha: d, mes: d.getMonth() + 1, año: d.getFullYear() }; };
  // Confirmación optimista: aviso inmediato, la escritura sigue en segundo plano.
  function guardar(p, txt) {
    const ing = p.tipo === 'ingreso', base = { usuario: perfil, descripcion: (p.desc || txt).slice(0, 120), monto: p.monto, ...fecha(p.dias) };
    const datos = ing ? { ...base, tipoIngreso: p.subcategoria, tipoMov: 'ingreso' }
      : { ...base, categoria: p.categoria, subcategoria: p.subcategoria, metodoPago: p.metodo, tipoMov: 'gasto' };
    aviso(`✅ ${ing ? 'Ingreso' : 'Gasto'} registrado: ${COP(p.monto)} · ${ing ? p.subcategoria : p.categoria + ' - ' + p.subcategoria}`);
    return addDoc(collection(db, ing ? 'ingresos' : 'gastos'), datos).then(() => { consultas.limpiar(); refrescar(); })
      .catch(e => { aviso('❌ No se guardó: ' + (e?.code || e?.message), 'error', 8000); mostrarMensaje('No se guardó el registro', 'error'); });
  }
  const consultas = crearConsultas({ db, perfil, cats, fs });
  const recs = crearRecordatorios({ db, perfil, fs });
  const avisarPendientes = () => recs.avisoInicio().then(m => m && aviso(m, 'info', 10000)).catch(() => {});
  if (!previo) avisarPendientes();
  // Al volver a la app (iPhone/Android): recarga completa de la página.
  let oculta = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { oculta = Date.now(); if (ses) { ses.descartar = true; detener(); } grab?.cancelar(); return; }
    if (Date.now() - oculta > 1000) location.reload(); // volver a la app (minimizada) = recarga completa
  });
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); }); // restaurada desde caché
  const PEND = /pendiente|por pagar|recordatorio|vence|venc|proxim\w* pago|tengo que pagar|que debo/;

  // Orden: pregunta ("dime") → recordatorio (fecha a futuro) → gasto/ingreso → "ya pagué X".
  async function procesar(txt) {
    const p = parse(txt, cats), t = norm(txt);
    if (p.pregunta) { const r = PEND.test(t) ? await recs.listar() : await consultas.responder(txt); aviso(r, 'info', 10000); return hablar(r); }
    const rc = parseRecordatorio(txt);
    if (rc?.falta && !p.ok) return aviso('¿Para qué fecha? Ej: "recuérdame pagar la hipoteca el 27 de noviembre"', 'error', 7000);
    if (rc && !rc.falta) return aviso(await recs.crear(rc), 'exito', 6000);
    if (p.ok) { const [, m] = await Promise.all([guardar(p, txt), recs.marcarSiCoincide(txt).catch(() => null)]); if (m) aviso(m, 'exito', 5000); return; }
    if (/\b(pague|pagado|pagada|ya se pago)\b/.test(t)) { const m = await recs.marcarSiCoincide(txt); if (m) return aviso(m, 'exito', 5000); }
    aviso(txt ? `No entendí "${txt}". Ej: "almuerzo 25 mil"` : 'No te escuché. Toca y habla.', 'error', 6000);
  }

  // Dictado con UNA instancia reutilizable (iOS falla al crear instancias nuevas o usar abort()).
  // Estados: idle → listening → stopping → idle. Un toque durante "stopping" queda en cola.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let r = null, estado = 'idle', ses = null, enCola = false, tFin;
  const libre = () => { clearTimeout(tFin); estado = 'idle'; ses = null; mic.classList.remove('on'); if (enCola) { enCola = false; empezar(); } };
  function nuevo() {
    const x = new SR(); x.lang = 'es-CO'; x.interimResults = true; x.maxAlternatives = 1; x.continuous = false;
    x.onaudiostart = () => { if (x === r && ses) ses.oye = true; };
    x.onresult = e => { if (x === r && ses) ses.resultado(e); };
    x.onerror = e => { if (x !== r || !ses) return; if (!['no-speech', 'aborted'].includes(e.error)) { ses.descartar = true; aviso('Micrófono: ' + e.error, 'error', 5000); } };
    x.onend = () => { if (x !== r) return; ses?.finalizar(); libre(); };
    return x;
  }
  function detener() {
    const s = ses; if (!s || estado !== 'listening') return;
    s.finalizar(); estado = 'stopping';
    try { r.stop(); } catch {}
    tFin = setTimeout(() => { r = null; libre(); }, 1500); // onend nunca llegó → instancia nueva la próxima vez
  }
  function empezar(esReintento = false) {
    if (estado === 'stopping') { enCola = true; return; }
    if (estado === 'listening') return;
    if (!r) r = nuevo();
    const s = ses = { txt: '', hecho: false, oye: false };
    s.finalizar = () => {
      if (s.hecho) return; s.hecho = true; clearTimeout(s.t); clearTimeout(s.wd); clearTimeout(s.wa);
      if (!s.descartar) procesar(s.txt).catch(e => aviso('❌ ' + (e?.code || e?.message), 'error', 6000));
    };
    s.resultado = e => {
      if (s.hecho) return; s.oye = true;
      // Android a veces repite la frase acumulada en cada resultado: si un trozo contiene lo anterior, lo reemplaza.
      s.txt = [...e.results].reduce((acc, x) => { const v = x[0].transcript.trim(); return norm(v).startsWith(norm(acc)) ? v : (acc + ' ' + v).trim(); }, '');
      aviso('🎧 ' + s.txt, 'info', 0); clearTimeout(s.t);
      if (e.results[e.results.length - 1].isFinal) return detener();
      const p = parse(s.txt, cats);
      if (p.ok && p.monto >= 1000 && !TRIGGER.test(norm(s.txt))) s.t = setTimeout(detener, 900); // frase completa: no esperar el silencio
    };
    s.wd = setTimeout(detener, 20000); // seguro: nunca queda "pegada"
    // Si el micrófono no arranca en 4 s: descartar la instancia y reintentar una vez con una nueva.
    s.wa = setTimeout(() => {
      if (s.oye || s.hecho || ses !== s) return;
      s.descartar = true; s.finalizar(); try { r.abort(); } catch {} r = null; libre();
      if (!esReintento) empezar(true); else aviso('El micrófono no responde. Toca de nuevo.', 'error', 5000);
    }, 4000);
    estado = 'listening'; mic.classList.add('on'); aviso('🎧 Te escucho…', 'info', 0);
    try { r.start(); } catch { try { r = nuevo(); r.start(); } catch { s.descartar = true; s.finalizar(); r = null; libre(); aviso('Micrófono ocupado, toca de nuevo.', 'error', 4000); } }
  }
  mic.onclick = () => {
    if (!SR) return aviso('Este navegador no tiene dictado. Usa Chrome, Edge o Safari.', 'error', 6000);
    if (estado === 'listening') return detener(); // tocar mientras escucha: detener y procesar
    if ('speechSynthesis' in window) speechSynthesis.cancel(); // la voz de una respuesta ocupa el audio
    empezar();
  };

  // iPhone: un toque → graba → detecta silencio → Whisper local → mismo procesamiento.
  var grab = null;
  if (IOS && navigator.mediaDevices?.getUserMedia) {
    grab = crearGrabadora({
      alEstado: e => {
        mic.classList.toggle('on', e === 'escuchando');
        if (e === 'escuchando') aviso('🎧 Te escucho… (v18)', 'info', 0);
        if (e === 'procesando') aviso('⏳ Procesando…', 'info', 0);
      },
      alTexto: txt => { if (txt) aviso('🎧 ' + txt, 'info', 0); procesar(txt).catch(e => aviso('❌ ' + (e?.code || e?.message), 'error', 6000)); },
      alError: e => aviso('Voz: ' + (e?.message || e), 'error', 7000)
    });
    mic.onclick = () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); grab.alternar(); };
    // Precarga silenciosa del modelo (descarga única, luego queda en caché del teléfono).
    setTimeout(() => cargarModelo().catch(() => {}), 800);
  }
}
