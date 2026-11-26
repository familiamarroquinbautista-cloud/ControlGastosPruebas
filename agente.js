// Registro por voz: dictado del navegador + intérprete local. Sin servicios pagos ($0).
import { parse, norm } from './parser.js';
import { crearConsultas } from './consultas.js';
import { parseRecordatorio, crearRecordatorios, TRIGGER } from './recordatorios.js';

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
  const aviso = (t, tipo = 'exito', ms = 4000) => {
    tst.textContent = t; tst.style.background = tipo === 'error' ? '#b3261e' : tipo === 'info' ? '#33475b' : '#1f7a55';
    tst.style.display = 'block'; if (tipo === 'exito') navigator.vibrate?.(120);
    clearTimeout(aviso.h); if (ms) aviso.h = setTimeout(() => (tst.style.display = 'none'), ms);
  };
  const hablar = t => { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.replace(/\$([\d.]+)/g, '$1 pesos')); u.lang = 'es-CO'; speechSynthesis.speak(u); };

  const fecha = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return { fecha: d, mes: d.getMonth() + 1, año: d.getFullYear() }; };
  // Confirmación optimista: aviso inmediato, la escritura sigue en segundo plano.
  function guardar(p, txt) {
    const ing = p.tipo === 'ingreso', base = { usuario: perfil, descripcion: (p.desc || txt).slice(0, 120), monto: p.monto, ...fecha(p.dias) };
    const datos = ing ? { ...base, tipoIngreso: p.subcategoria, tipoMov: 'ingreso' }
      : { ...base, categoria: p.categoria, subcategoria: p.subcategoria, metodoPago: p.metodo, tipoMov: 'gasto' };
    aviso(`✅ ${ing ? 'Ingreso' : 'Gasto'} registrado: ${COP(p.monto)} · ${ing ? p.subcategoria : p.categoria + ' - ' + p.subcategoria}`);
    addDoc(collection(db, ing ? 'ingresos' : 'gastos'), datos).then(() => { consultas.limpiar(); refrescar(); })
      .catch(e => { aviso('❌ No se guardó: ' + (e?.code || e?.message), 'error', 8000); mostrarMensaje('No se guardó el registro', 'error'); });
  }
  const consultas = crearConsultas({ db, perfil, cats, fs });
  const recs = crearRecordatorios({ db, perfil, fs });
  const avisarPendientes = () => recs.avisoInicio().then(m => m && aviso(m, 'info', 10000)).catch(() => {});
  avisarPendientes();
  // Al volver a la app (iPhone/Android): refresca datos sin recargar la página.
  // Recargar la página haría que iOS vuelva a pedir el permiso del micrófono.
  let oculta = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { oculta = Date.now(); sesion?.cancelar(); return; }
    if (Date.now() - oculta < 3000) return;
    consultas.limpiar(); recs.limpiar(); refrescar(); avisarPendientes();
  });
  const PEND = /pendiente|por pagar|recordatorio|vence|venc|proxim\w* pago|tengo que pagar|que debo/;

  // Orden: pregunta ("dime") → recordatorio (fecha a futuro) → gasto/ingreso → "ya pagué X".
  async function procesar(txt) {
    const p = parse(txt, cats), t = norm(txt);
    if (p.pregunta) { const r = PEND.test(t) ? await recs.listar() : await consultas.responder(txt); aviso(r, 'info', 10000); return hablar(r); }
    const rc = parseRecordatorio(txt);
    if (rc?.falta && !p.ok) return aviso('¿Para qué fecha? Ej: "recuérdame pagar la hipoteca el 27 de noviembre"', 'error', 7000);
    if (rc && !rc.falta) return aviso(await recs.crear(rc), 'exito', 6000);
    if (p.ok) { guardar(p, txt); recs.marcarSiCoincide(txt).then(m => m && setTimeout(() => aviso(m, 'exito', 5000), 2500)).catch(() => {}); return; }
    if (/\b(pague|pagado|pagada|ya se pago)\b/.test(t)) { const m = await recs.marcarSiCoincide(txt); if (m) return aviso(m, 'exito', 5000); }
    aviso(txt ? `No entendí "${txt}". Ej: "almuerzo 25 mil"` : 'No te escuché. Toca y habla.', 'error', 6000);
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let sesion = null;
  mic.onclick = () => {
    if (!SR) return aviso('Este navegador no tiene dictado. Usa Chrome, Edge o Safari.', 'error', 6000);
    // Tocar mientras escucha cierra la sesión directamente (no depende de que el navegador dispare onend).
    if (sesion) return sesion.cerrar();
    // La voz de la respuesta anterior ocupa el audio (iOS): callarla y esperar antes de abrir el micrófono.
    const hablaba = 'speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending);
    if (hablaba) speechSynthesis.cancel();
    dictar(0, 0); // arranca dentro del toque (requisito iOS); si el audio sigue ocupado, el reintento lo resuelve
  };
  function dictar(intento, espera) {
    // Cada sesión es independiente: los eventos tardíos de una sesión anterior no afectan la nueva.
    let txt = '', hecho = false, t;
    const r = new SR(), yo = {};
    const wd = setTimeout(() => yo.cerrar(), 20000); // seguro: nunca queda "pegada"
    const soltar = () => { clearTimeout(t); clearTimeout(wd); if (sesion === yo) { sesion = null; mic.classList.remove('on'); } };
    yo.cancelar = () => { hecho = true; soltar(); try { r.abort(); } catch {} };
    const cerrar = yo.cerrar = () => {
      if (hecho) return; hecho = true; soltar(); try { r.abort(); } catch {}
      procesar(txt).catch(e => aviso('❌ ' + (e?.code || e?.message), 'error', 6000));
    };
    r.lang = 'es-CO'; r.interimResults = true; r.maxAlternatives = 1;
    let oye = false;
    r.onaudiostart = () => (oye = true);
    r.onresult = e => {
      if (hecho) return; oye = true;
      // Android a veces repite la frase acumulada en cada resultado: si un trozo contiene lo anterior, lo reemplaza.
      txt = [...e.results].reduce((acc, x) => { const s = x[0].transcript.trim(); return norm(s).startsWith(norm(acc)) ? s : (acc + ' ' + s).trim(); }, '');
      aviso('🎧 ' + txt, 'info', 0);
      clearTimeout(t);
      if (e.results[e.results.length - 1].isFinal) return cerrar();
      const p = parse(txt, cats);
      if (p.ok && p.monto >= 1000 && !TRIGGER.test(norm(txt))) t = setTimeout(cerrar, 900); // frase completa: no esperar el silencio del navegador
    };
    r.onerror = e => { if (hecho) return; if (!['no-speech', 'aborted'].includes(e.error)) { hecho = true; soltar(); return aviso('Micrófono: ' + e.error, 'error', 5000); } cerrar(); };
    r.onend = cerrar;
    sesion = yo; mic.classList.add('on'); aviso('🎧 Te escucho…', 'info', 0);
    // Si el micrófono no arranca en 4 s (audio aún ocupado), reinicia la escucha una vez.
    if (!intento) setTimeout(() => { if (!oye && !hecho && sesion === yo) { yo.cancelar(); dictar(1, 300); } }, 4000);
    const iniciar = (n = 0) => { try { r.start(); } catch { if (n < 3) setTimeout(() => iniciar(n + 1), 250); else { hecho = true; soltar(); aviso('Micrófono ocupado, toca de nuevo.', 'error', 4000); } } };
    if (espera) setTimeout(iniciar, espera); else iniciar();
  }
}
