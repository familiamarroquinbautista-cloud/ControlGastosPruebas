// Agente de voz ElevenLabs (bajo costo): carga diferida, sesión máx. 60 s, tope diario, respuestas ya calculadas.
import { parse } from './parser.js';
const AGENT_ID = 'agent_1101m8c46spmf6vv3avb4tzgew6f';
const SEG_SESION = 60, SEG_DIA = 180;

export function initAgente({ db, perfil, cats, ingresos, fs, refrescar, mostrarMensaje }) {
  const { addDoc, collection, getDocs, query, where } = fs;
  const n = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const COP = v => '$' + Math.round(v || 0).toLocaleString('es-CO');
  const hoy = () => new Date().toISOString().slice(0, 10);
  const uso = () => +(localStorage.getItem('agente_' + hoy()) || 0);
  const pick = (lista, v, def) => lista.find(x => n(x) === n(v)) || def;

  const boton = (txt, title, css) => { const b = Object.assign(document.createElement('button'), { textContent: txt, title });
    b.style.cssText = 'position:fixed;border-radius:50%;border:0;box-shadow:0 4px 14px #0004;cursor:pointer;z-index:9999;background:#3fb68b;' + css;
    document.body.appendChild(b); return b; };
  const mic = boton('🎙️', 'Dictar gasto (rápido, gratis)', 'right:18px;bottom:18px;width:68px;height:68px;font-size:30px');
  const btn = boton('🤖', 'Agente de voz (preguntas)', 'right:29px;bottom:98px;width:46px;height:46px;font-size:20px;background:#33475b');
  const tst = document.createElement('div');
  tst.style.cssText = 'position:fixed;right:18px;bottom:154px;max-width:80vw;padding:10px 14px;border-radius:10px;background:#1f7a55;color:#fff;font:600 15px system-ui;box-shadow:0 4px 14px #0004;z-index:9999;display:none';
  document.body.appendChild(tst);
  const aviso = (t, tipo = 'exito', ms = 4000) => {
    if (tipo === 'info' && Date.now() < (aviso.lock || 0)) return; // no tapar confirmaciones/errores
    if (tipo !== 'info') { mostrarMensaje(t, tipo); aviso.lock = Date.now() + ms; }
    tst.textContent = t; tst.style.background = tipo === 'error' ? '#b3261e' : tipo === 'info' ? '#33475b' : '#1f7a55';
    tst.style.display = 'block'; if (tipo === 'exito') navigator.vibrate?.(120);
    clearTimeout(aviso.h); if (ms) aviso.h = setTimeout(() => (tst.style.display = 'none'), ms);
  };
  // Precarga del SDK (solo descarga, sin costo): el toque del usuario no se pierde esperando red (iOS/Android).
  const sdk = import('https://esm.sh/@elevenlabs/client');
  // Si una herramienta falla, se ve en pantalla y el agente recibe el error.
  const seguro = f => async a => { try { return await f(a || {}); } catch (e) { aviso('❌ No se guardó: ' + (e?.code || e?.message || e), 'error', 6000); return 'error: ' + (e?.code || e?.message); } };

  // Guarda sin bloquear al agente (responde al instante) y cuelga: deja de escuchar y de consumir minutos.
  const guardar = (col, datos, ok) => {
    aviso('💾 Guardando…', 'info', 0);
    addDoc(collection(db, col), datos).then(() => { aviso(ok, 'exito'); refrescar(); })
      .catch(e => aviso('❌ No se guardó: ' + (e?.code || e?.message || e), 'error', 8000));
    setTimeout(() => conv?.endSession(), 400);
  };
  const fecha = (dias = 0) => { const d = new Date(); d.setDate(d.getDate() - Math.min(31, Math.max(0, +dias || 0))); return { fecha: d, mes: d.getMonth() + 1, año: d.getFullYear() }; };
  const tools = Object.fromEntries(Object.entries({
    registrar_gasto: async a => {
      const monto = Math.round(+a.monto); if (!(monto > 0)) return 'error: monto inválido';
      const categoria = pick(Object.keys(cats), a.categoria, 'Otros');
      const subcategoria = pick(cats[categoria], a.subcategoria, cats[categoria][0]);
      guardar('gastos', {
        usuario: perfil, categoria, subcategoria, descripcion: (a.descripcion || 'Sin descripción').slice(0, 120), monto,
        metodoPago: a.metodo === 'credito' ? 'credito' : 'debito', ...fecha(a.dias_atras), tipoMov: 'gasto'
      }, `✅ Gasto registrado: ${COP(monto)} en ${categoria} - ${subcategoria}`);
      return `ok ${COP(monto)} ${categoria}/${subcategoria}`;
    },
    registrar_ingreso: async a => {
      const monto = Math.round(+a.monto); if (!(monto > 0)) return 'error: monto inválido';
      const tipoIngreso = pick(ingresos, a.tipo, 'Otros');
      guardar('ingresos', { usuario: perfil, tipoIngreso, descripcion: (a.descripcion || 'Sin descripción').slice(0, 120), monto, ...fecha(a.dias_atras), tipoMov: 'ingreso' },
        `✅ Ingreso registrado: ${COP(monto)} (${tipoIngreso})`);
      return `ok ingreso ${COP(monto)} ${tipoIngreso}`;
    },
    consultar_gastos: async a => {
      const { mes, año } = fecha();
      const s = await getDocs(query(collection(db, 'gastos'), where('usuario', '==', perfil), where('año', '==', año), where('mes', '==', mes)));
      const por = {}; let tot = 0;
      s.forEach(d => { const g = d.data(); tot += g.monto; por[g.categoria] = (por[g.categoria] || 0) + g.monto; });
      if (a.categoria) { const c = pick(Object.keys(por), a.categoria, a.categoria); return `${c} este mes: ${COP(por[c])} de ${COP(tot)} total`; }
      const top = Object.entries(por).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, v]) => `${c} ${COP(v)}`).join(', ');
      return `Total gastos del mes ${COP(tot)}. Mayores: ${top || 'ninguno'}`;
    }
  }).map(([k, f]) => [k, seguro(f)]));

  let conv = null, t0 = 0, timer;
  const fin = () => {
    clearTimeout(timer); btn.style.background = '#33475b'; conv = null; if (tst.textContent.startsWith('🎧') || tst.textContent.startsWith('🗣️') || tst.textContent.startsWith('⏳')) tst.style.display = 'none';
    if (t0) localStorage.setItem('agente_' + hoy(), uso() + Math.ceil((Date.now() - t0) / 1000));
    t0 = 0;
  };

  btn.onclick = async () => {
    if (conv) return conv.endSession();
    const libre = SEG_DIA - uso();
    if (libre <= 0) return aviso('Límite diario del agente alcanzado', 'error');
    btn.disabled = true;
    try {
      aviso('⏳ Conectando…', 'info', 0);
      const { Conversation } = await sdk;
      conv = await Conversation.startSession({
        agentId: AGENT_ID, connectionType: 'websocket',
        dynamicVariables: { usuario: perfil, hoy: hoy(), categorias: Object.entries(cats).map(([c, s]) => c + ':' + s.join(',')).join(';') },
        clientTools: tools, onDisconnect: fin,
        onModeChange: ({ mode }) => aviso(mode === 'speaking' ? '🗣️ Hablando…' : '🎧 Te escucho…', 'info', 0),
        onError: e => aviso('Agente: ' + (e?.message || e), 'error', 6000)
      });
      t0 = Date.now(); btn.style.background = '#e5534b';
      timer = setTimeout(() => conv?.endSession(), Math.min(SEG_SESION, libre) * 1000);
    } catch (e) { fin(); aviso('No se pudo iniciar el agente: ' + (e?.message || e), 'error', 8000); }
    btn.disabled = false;
  };

  // Dictado rápido: voz del navegador + intérprete local → guarda en ~1 s, sin ElevenLabs ($0).
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hablar = t => { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.replace(/\$([\d.]+)/g, '$1 pesos')); u.lang = 'es-CO'; speechSynthesis.speak(u); };
  let rec = null;
  mic.onclick = () => {
    if (!SR) return aviso('Este navegador no tiene dictado: usa 🤖', 'error', 5000);
    if (rec) return rec.stop();
    rec = new SR(); rec.lang = 'es-CO'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = async e => {
      const txt = e.results[0][0].transcript, p = parse(txt, cats);
      if (p.pregunta) { const r = await tools.consultar_gastos({ categoria: p.categoria }); aviso(r, 'info', 9000); return hablar(r); }
      if (!p.ok) return aviso(`No entendí "${txt}". Ej: "almuerzo 25 mil". O usa 🤖`, 'error', 7000);
      if (p.tipo === 'ingreso') tools.registrar_ingreso({ monto: p.monto, tipo: p.subcategoria, descripcion: txt, dias_atras: p.dias });
      else tools.registrar_gasto({ monto: p.monto, categoria: p.categoria, subcategoria: p.subcategoria, descripcion: txt, metodo: p.metodo, dias_atras: p.dias });
    };
    rec.onerror = e => e.error !== 'no-speech' && e.error !== 'aborted' && aviso('Micrófono: ' + e.error, 'error', 5000);
    rec.onend = () => { rec = null; mic.style.background = '#3fb68b'; if (tst.textContent.startsWith('🎧')) tst.style.display = 'none'; };
    mic.style.background = '#e5534b'; aviso('🎧 Dime el gasto…', 'info', 0); rec.start();
  };
}
