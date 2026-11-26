// Agente de voz ElevenLabs (bajo costo): carga diferida, sesión máx. 60 s, tope diario, respuestas ya calculadas.
const AGENT_ID = 'agent_1101m8c46spmf6vv3avb4tzgew6f';
const SEG_SESION = 60, SEG_DIA = 180;

export function initAgente({ db, perfil, cats, ingresos, fs, refrescar, mostrarMensaje }) {
  const { addDoc, collection, getDocs, query, where } = fs;
  const n = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const COP = v => '$' + Math.round(v || 0).toLocaleString('es-CO');
  const hoy = () => new Date().toISOString().slice(0, 10);
  const uso = () => +(localStorage.getItem('agente_' + hoy()) || 0);
  const pick = (lista, v, def) => lista.find(x => n(x) === n(v)) || def;

  const btn = Object.assign(document.createElement('button'), { textContent: '🎙️', title: 'Agente de voz' });
  btn.style.cssText = 'position:fixed;right:18px;bottom:18px;width:64px;height:64px;border-radius:50%;border:0;font-size:28px;box-shadow:0 4px 14px #0004;cursor:pointer;z-index:9999;background:#3fb68b';
  document.body.appendChild(btn);
  const tst = document.createElement('div');
  tst.style.cssText = 'position:fixed;right:18px;bottom:92px;max-width:80vw;padding:10px 14px;border-radius:10px;background:#1f7a55;color:#fff;font:600 15px system-ui;box-shadow:0 4px 14px #0004;z-index:9999;display:none';
  document.body.appendChild(tst);
  const aviso = (t, tipo = 'exito') => {
    mostrarMensaje(t, tipo); tst.textContent = t; tst.style.display = 'block';
    navigator.vibrate?.(120); clearTimeout(aviso.h); aviso.h = setTimeout(() => (tst.style.display = 'none'), 4000);
  };

  const fecha = () => { const d = new Date(); return { fecha: d, mes: d.getMonth() + 1, año: d.getFullYear() }; };
  const tools = {
    registrar_gasto: async a => {
      const monto = Math.round(+a.monto); if (!(monto > 0)) return 'error: monto inválido';
      const categoria = pick(Object.keys(cats), a.categoria, 'Otros');
      const subcategoria = pick(cats[categoria], a.subcategoria, cats[categoria][0]);
      await addDoc(collection(db, 'gastos'), {
        usuario: perfil, categoria, subcategoria, descripcion: (a.descripcion || 'Sin descripción').slice(0, 120), monto,
        metodoPago: a.metodo === 'credito' ? 'credito' : 'debito', ...fecha(), tipoMov: 'gasto'
      });
      refrescar(); aviso(`✅ Gasto registrado: ${COP(monto)} en ${categoria} - ${subcategoria}`, 'exito');
      return `ok ${COP(monto)} ${categoria}/${subcategoria}`;
    },
    registrar_ingreso: async a => {
      const monto = Math.round(+a.monto); if (!(monto > 0)) return 'error: monto inválido';
      const tipoIngreso = pick(ingresos, a.tipo, 'Otros');
      await addDoc(collection(db, 'ingresos'), { usuario: perfil, tipoIngreso, descripcion: (a.descripcion || 'Sin descripción').slice(0, 120), monto, ...fecha(), tipoMov: 'ingreso' });
      refrescar(); aviso(`✅ Ingreso registrado: ${COP(monto)} (${tipoIngreso})`, 'exito');
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
  };

  let conv = null, t0 = 0, timer;
  const fin = () => {
    clearTimeout(timer); btn.style.background = '#3fb68b'; conv = null;
    if (t0) localStorage.setItem('agente_' + hoy(), uso() + Math.ceil((Date.now() - t0) / 1000));
    t0 = 0;
  };

  btn.onclick = async () => {
    if (conv) return conv.endSession();
    const libre = SEG_DIA - uso();
    if (libre <= 0) return mostrarMensaje('Límite diario del agente alcanzado', 'error');
    btn.disabled = true;
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const { Conversation } = await import('https://esm.sh/@elevenlabs/client');
      conv = await Conversation.startSession({
        agentId: AGENT_ID, connectionType: 'websocket',
        dynamicVariables: { usuario: perfil, hoy: hoy(), categorias: Object.entries(cats).map(([c, s]) => c + ':' + s.join(',')).join(';') },
        clientTools: tools, onDisconnect: fin,
        onError: e => mostrarMensaje('Agente: ' + (e?.message || e), 'error')
      });
      t0 = Date.now(); btn.style.background = '#e5534b';
      timer = setTimeout(() => conv?.endSession(), Math.min(SEG_SESION, libre) * 1000);
    } catch (e) { mostrarMensaje('No se pudo iniciar el agente: ' + (e?.message || e), 'error'); fin(); }
    btn.disabled = false;
  };
}
