// Recordatorios de pago (colección "recordatorios"): {titulo, fecha:'YYYY-MM-DD', monto, mensual, dia, pagado, usuario, creado}
// La fecha como texto ISO permite que un job diario (GitHub Actions) consulte "fecha == mañana".
import { norm, monto as montoDe } from './parser.js';
import { updateDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const COP = v => '$' + Math.round(v || 0).toLocaleString('es-CO');
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const deIso = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const hoy0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const diaDelMes = (a, m, d) => new Date(a, m, Math.min(d, new Date(a, m + 1, 0).getDate())); // 31 → último día
const siguienteMes = (s, dia) => { const d = deIso(s); return iso(diaDelMes(d.getFullYear(), d.getMonth() + 1, dia || d.getDate())); };

export const TRIGGER = /\b(recuerda\w*|recordar|recordatorio|vence|vencimiento|fecha limite|limite de pago|hay que pagar|tengo que pagar|toca pagar|recibo)\b/;
const FECHA = new RegExp(`\\b(?:el |dia )?(\\d{1,2}|primero) de (${MESES.join('|')})(?: de (\\d{4}))?\\b`);
const MENSUAL = /\b(cada mes|todos los meses|mensual\w*)\b/;

/** Frase → {titulo, fecha, monto, mensual, dia} | {falta:'fecha'} | null (no es recordatorio) */
export function parseRecordatorio(raw, now = new Date()) {
  let t = norm(raw);
  if (!TRIGGER.test(t)) return null;
  const h = new Date(now); h.setHours(0, 0, 0, 0);
  let fecha, quitar;
  const m = t.match(FECHA), mens = MENSUAL.test(t) || /\bcada \d/.test(t);
  if (m) {
    const dia = m[1] === 'primero' ? 1 : +m[1], mes = MESES.indexOf(m[2]);
    let a = m[3] ? +m[3] : h.getFullYear(); let d = diaDelMes(a, mes, dia);
    if (!m[3] && d < h) d = diaDelMes(a + 1, mes, dia);
    fecha = d; quitar = m[0];
  } else if (/\bpasado manana\b/.test(t)) { fecha = new Date(h); fecha.setDate(h.getDate() + 2); quitar = 'pasado manana'; }
  else if (/\bmanana\b/.test(t)) { fecha = new Date(h); fecha.setDate(h.getDate() + 1); quitar = 'manana'; }
  else {
    const d = t.match(/\b(?:el |dia |cada )(\d{1,2})\b/);
    if (d && +d[1] >= 1 && +d[1] <= 31) {
      fecha = diaDelMes(h.getFullYear(), h.getMonth(), +d[1]);
      if (fecha < h) fecha = diaDelMes(h.getFullYear(), h.getMonth() + 1, +d[1]);
      quitar = d[0];
    }
  }
  if (!fecha) return { falta: 'fecha' };
  t = t.replace(quitar, ' ');
  const monto = montoDe(t);
  const titulo = t.replace(TRIGGER, ' ').replace(MENSUAL, ' ')
    .replace(/\b(me|que|pagar|pago|el|la|los|las|de|del|un|una|por|para|en|a|al|y|dia|cada|mil|millones?|pesos|\d[\d.,]*)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const orig = Object.fromEntries(raw.split(/\s+/).map(w => [norm(w), w.replace(/[^\p{L}\p{N}]/gu, '')])); // recupera tildes
  const tit = titulo.split(' ').map(w => orig[w] || w).join(' ').toLowerCase();
  return { titulo: tit ? tit[0].toUpperCase() + tit.slice(1) : 'Pago', fecha: iso(fecha), monto, mensual: mens, dia: fecha.getDate() };
}

export function crearRecordatorios({ db, perfil, fs: { addDoc, collection, getDocs, query, where } }) {
  const col = () => collection(db, 'recordatorios');
  let cache = null;
  const pendientes = async () => {
    if (cache && Date.now() - cache.t < 60000) return cache.d;
    const d = (await getDocs(query(col(), where('pagado', '==', false)))).docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => a.fecha.localeCompare(b.fecha));
    cache = { t: Date.now(), d }; return d;
  };
  const cuando = f => {
    const n = Math.round((deIso(f) - hoy0()) / 864e5);
    return n < 0 ? `vencido hace ${-n} ${n === -1 ? 'día' : 'días'}` : n === 0 ? 'hoy' : n === 1 ? 'mañana' : `el ${deIso(f).getDate()} de ${MESES[deIso(f).getMonth()]}`;
  };
  const linea = r => `${r.titulo}${r.monto ? ' ' + COP(r.monto) : ''} ${cuando(r.fecha)}`;

  return {
    async crear(r) {
      await addDoc(col(), { ...r, pagado: false, usuario: perfil, creado: new Date() }); cache = null;
      return `📅 Recordatorio: ${r.titulo}${r.monto ? ' ' + COP(r.monto) : ''} ${cuando(r.fecha)}${r.mensual ? ', cada mes' : ''}.`;
    },
    // "dime qué tengo pendiente" → vencidos + próximos 30 días
    async listar() {
      const lim = iso(new Date(hoy0().getTime() + 30 * 864e5)), l = (await pendientes()).filter(r => r.fecha <= lim);
      return l.length ? 'Pendientes: ' + l.map(linea).join('; ') + '.' : 'No tienes pagos pendientes en los próximos 30 días.';
    },
    // Marca pagado el recordatorio cuyo título aparezca en la frase (mensual → pasa al mes siguiente).
    async marcarSiCoincide(texto) {
      const t = norm(texto), lim = iso(new Date(hoy0().getTime() + 15 * 864e5));
      const r = (await pendientes()).find(r => r.fecha <= lim && norm(r.titulo).split(' ').filter(w => w.length > 2).some(w => new RegExp(`\\b${w}`).test(t)));
      if (!r) return null;
      await updateDoc(doc(db, 'recordatorios', r.id), r.mensual ? { fecha: siguienteMes(r.fecha, r.dia) } : { pagado: true }); cache = null;
      return `✔️ ${r.titulo} marcado como pagado${r.mensual ? '; próximo ' + cuando(siguienteMes(r.fecha, r.dia)) : ''}.`;
    },
    // Aviso al abrir la app: lo vencido y lo de hoy/mañana.
    async avisoInicio() {
      const lim = iso(new Date(hoy0().getTime() + 864e5)), l = (await pendientes()).filter(r => r.fecha <= lim);
      return l.length ? '📅 ' + l.map(linea).join('; ') : null;
    }
  };
}
