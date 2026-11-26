// Registro por voz: dictado del navegador + intérprete local. Sin servicios pagos ($0).
import { parse } from './parser.js';
import { crearConsultas } from './consultas.js';

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
    const ing = p.tipo === 'ingreso', base = { usuario: perfil, descripcion: txt.slice(0, 120), monto: p.monto, ...fecha(p.dias) };
    const datos = ing ? { ...base, tipoIngreso: p.subcategoria, tipoMov: 'ingreso' }
      : { ...base, categoria: p.categoria, subcategoria: p.subcategoria, metodoPago: p.metodo, tipoMov: 'gasto' };
    aviso(`✅ ${ing ? 'Ingreso' : 'Gasto'} registrado: ${COP(p.monto)} · ${ing ? p.subcategoria : p.categoria + ' - ' + p.subcategoria}`);
    addDoc(collection(db, ing ? 'ingresos' : 'gastos'), datos).then(() => { consultas.limpiar(); refrescar(); })
      .catch(e => { aviso('❌ No se guardó: ' + (e?.code || e?.message), 'error', 8000); mostrarMensaje('No se guardó el registro', 'error'); });
  }
  const consultas = crearConsultas({ db, perfil, cats, fs });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  mic.onclick = () => {
    if (!SR) return aviso('Este navegador no tiene dictado. Usa Chrome, Edge o Safari.', 'error', 6000);
    if (rec) return rec.stop();
    // Cada sesión es independiente: los eventos tardíos de una sesión anterior no afectan la nueva.
    let txt = '', hecho = false, t;
    const r = rec = new SR();
    const soltar = () => { clearTimeout(t); if (rec === r) { rec = null; mic.classList.remove('on'); } };
    const cerrar = () => {
      if (hecho) return; hecho = true; soltar(); try { r.abort(); } catch {}
      const p = parse(txt, cats);
      if (p.pregunta) return consultas.responder(txt).then(r => { aviso(r, 'info', 9000); hablar(r); }).catch(e => aviso('❌ ' + (e?.code || e?.message), 'error'));
      if (p.ok) return guardar(p, txt);
      aviso(txt ? `No entendí "${txt}". Ej: "almuerzo 25 mil"` : 'No te escuché. Toca y habla.', 'error', 6000);
    };
    r.lang = 'es-CO'; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = e => {
      if (hecho) return;
      txt =[...e.results].map(r => r[0].transcript).join(' ').trim();
      aviso('🎧 ' + txt, 'info', 0);
      clearTimeout(t);
      if (e.results[e.results.length - 1].isFinal) return cerrar();
      const p = parse(txt, cats);
      if (p.ok) t = setTimeout(cerrar, 800); // frase completa: no esperar el silencio del navegador
    };
    r.onerror = e => { if (!hecho && !['no-speech', 'aborted'].includes(e.error)) aviso('Micrófono: ' + e.error, 'error', 5000); };
    r.onend = cerrar;
    mic.classList.add('on'); aviso('🎧 Te escucho…', 'info', 0);
    const iniciar = (n = 0) => { try { r.start(); } catch { if (n < 3) setTimeout(() => iniciar(n + 1), 250); else { hecho = true; soltar(); aviso('Micrófono ocupado, toca de nuevo.', 'error', 4000); } } };
    iniciar();
  };
}
