// Registro por voz: dictado del navegador + intérprete local. Sin servicios pagos ($0).
import { parse } from './parser.js';

export function initAgente({ db, perfil, cats, fs, refrescar, mostrarMensaje }) {
  const { addDoc, collection, getDocs, query, where } = fs;
  const COP = v => '$' + Math.round(v || 0).toLocaleString('es-CO');

  const mic = Object.assign(document.createElement('button'), { textContent: '🎙️', title: 'Dictar gasto' });
  mic.style.cssText = 'position:fixed;right:18px;bottom:18px;width:68px;height:68px;border-radius:50%;border:0;font-size:30px;box-shadow:0 4px 14px #0004;cursor:pointer;z-index:9999;background:#3fb68b;touch-action:manipulation';
  const tst = document.createElement('div');
  tst.style.cssText = 'position:fixed;right:18px;bottom:96px;max-width:80vw;padding:10px 14px;border-radius:10px;color:#fff;font:600 15px system-ui;box-shadow:0 4px 14px #0004;z-index:9999;display:none';
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
    addDoc(collection(db, ing ? 'ingresos' : 'gastos'), datos).then(refrescar)
      .catch(e => { aviso('❌ No se guardó: ' + (e?.code || e?.message), 'error', 8000); mostrarMensaje('No se guardó el registro', 'error'); });
  }
  async function consultar(categoria) {
    const d = new Date(), s = await getDocs(query(collection(db, 'gastos'), where('usuario', '==', perfil), where('año', '==', d.getFullYear()), where('mes', '==', d.getMonth() + 1)));
    const por = {}; let tot = 0;
    s.forEach(x => { const g = x.data(); tot += g.monto; por[g.categoria] = (por[g.categoria] || 0) + g.monto; });
    if (categoria) return `${categoria} este mes: ${COP(por[categoria])} de ${COP(tot)}`;
    return `Gastos del mes ${COP(tot)}. Mayores: ${Object.entries(por).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => c + ' ' + COP(v)).join(', ') || 'ninguno'}`;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  mic.onclick = () => {
    if (!SR) return aviso('Este navegador no tiene dictado. Usa Chrome, Edge o Safari.', 'error', 6000);
    if (rec) return rec.stop();
    let txt = '', hecho = false, t;
    const cerrar = () => {
      if (hecho) return; hecho = true; rec?.abort();
      const p = parse(txt, cats);
      if (p.pregunta) return consultar(p.categoria).then(r => { aviso(r, 'info', 9000); hablar(r); }).catch(e => aviso('❌ ' + e.code, 'error'));
      if (p.ok) return guardar(p, txt);
      aviso(txt ? `No entendí "${txt}". Ej: "almuerzo 25 mil"` : 'No te escuché. Toca y habla.', 'error', 6000);
    };
    rec = new SR(); rec.lang = 'es-CO'; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = e => {
      txt = [...e.results].map(r => r[0].transcript).join(' ').trim();
      aviso('🎧 ' + txt, 'info', 0);
      clearTimeout(t);
      if (e.results[e.results.length - 1].isFinal) return cerrar();
      const p = parse(txt, cats);
      if (p.ok) t = setTimeout(cerrar, 800); // frase completa: no esperar el silencio del navegador
    };
    rec.onerror = e => { if (!['no-speech', 'aborted'].includes(e.error)) aviso('Micrófono: ' + e.error, 'error', 5000); };
    rec.onend = () => { clearTimeout(t); rec = null; mic.style.background = '#3fb68b'; cerrar(); };
    mic.style.background = '#e5534b'; aviso('🎧 Te escucho…', 'info', 0); rec.start();
  };
}
