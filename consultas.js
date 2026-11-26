// Preguntas sobre gastos/ingresos respondidas localmente ($0). Lee Firestore con caché de 60 s.
import { norm, categoria } from './parser.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const COP = v => '$' + Math.round(v || 0).toLocaleString('es-CO');
const suma = a => a.reduce((s, x) => s + (+x.monto || 0), 0);
const fechaDe = x => x.fecha?.toDate ? x.fecha.toDate() : new Date(x.fecha);

// Periodo mencionado → meses a leer + filtro de fechas + etiqueta hablada.
function periodo(t, now = new Date()) {
  const a = now.getFullYear(), m = now.getMonth() + 1, ini = new Date(now); ini.setHours(0, 0, 0, 0);
  if (/\bhoy\b/.test(t)) return { meses: [[a, m]], desde: ini, label: 'hoy' };
  if (/\bayer\b/.test(t)) { const d = new Date(ini); d.setDate(d.getDate() - 1); return { meses: [[d.getFullYear(), d.getMonth() + 1]], desde: d, hasta: ini, label: 'ayer' }; }
  if (/\bsemana\b/.test(t)) { const d = new Date(ini); d.setDate(d.getDate() - 6); return { meses: [...new Set([[d.getFullYear(), d.getMonth() + 1], [a, m]].map(String))].map(s => s.split(',').map(Number)), desde: d, label: 'en los últimos 7 días' }; }
  if (/\b(este|del|en el) ano\b|\banual\b/.test(t)) return { anio: a, label: 'este año' };
  if (/\b(mes pasado|mes anterior)\b/.test(t)) { const d = new Date(a, m - 2, 1); return { meses: [[d.getFullYear(), d.getMonth() + 1]], label: 'el mes pasado' }; }
  const i = MESES.findIndex(x => new RegExp(`\\b${x}\\b`).test(t));
  if (i >= 0) { const y = i + 1 > m ? a - 1 : a; return { meses: [[y, i + 1]], label: 'en ' + MESES[i] }; }
  return { meses: [[a, m]], label: 'este mes' };
}
const anterior = ([a, m]) => (m === 1 ? [a - 1, 12] : [a, m - 1]);

export function crearConsultas({ db, perfil, cats, fs: { collection, getDocs, query, where } }) {
  const cache = new Map();
  async function leer(col, a, m) {
    const k = `${col}|${a}|${m}`, c = cache.get(k);
    if (c && Date.now() - c.t < 60000) return c.d;
    const w = [where('año', '==', a)]; if (m) w.push(where('mes', '==', m));
    const d = (await getDocs(query(collection(db, col), ...w))).docs.map(x => x.data());
    cache.set(k, { t: Date.now(), d }); return d;
  }
  async function datos(col, per, quien) {
    const arr = per.anio ? await leer(col, per.anio) : (await Promise.all(per.meses.map(([a, m]) => leer(col, a, m)))).flat();
    return arr.filter(x => (!quien || x.usuario === quien) && (!per.desde || fechaDe(x) >= per.desde) && (!per.hasta || fechaDe(x) < per.hasta));
  }
  const top = (arr, k, n = 3) => Object.entries(arr.reduce((o, x) => (o[x[k]] = (o[x[k]] || 0) + (+x.monto || 0), o), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([c, v]) => `${c} ${COP(v)}`).join(', ');

  async function responder(texto) {
    const t = norm(texto), cs = categoria(t, cats), comp = /evolucion|compar|tendencia|\bvs\b|versus|mas que|menos que|subi|baj/.test(t);
    let per = periodo(t); if (comp && per.label === 'el mes pasado') per = periodo('');
    let quien = /\b(hogar|ambos|los dos|la casa|juntos|familia|en total)\b/.test(t) ? null : perfil;
    for (const n of ['Maria', 'Andres']) if (new RegExp(`\\b${norm(n)}\\b`).test(t)) quien = n;
    const de = quien ? (quien === perfil ? '' : ` de ${quien}`) : ' del hogar', L = per.label;

    if (/\bingres/.test(t)) {
      const I = await datos('ingresos', per, quien);
      return `Ingresos ${L}${de}: ${COP(suma(I))}.${I.length ? ' ' + top(I, 'tipoIngreso') + '.' : ''}`;
    }
    const G = await datos('gastos', per, quien);
    if (/balance|saldo|me queda|nos queda|disponible|ahorr|sobra/.test(t)) {
      const i = suma(await datos('ingresos', per, quien)), g = suma(G);
      return `Balance ${L}${de}: ingresos ${COP(i)}, gastos ${COP(g)}, ${i - g >= 0 ? 'quedan' : 'déficit de'} ${COP(Math.abs(i - g))}.`;
    }
    if (/\bultim/.test(t)) {
      const u = [...G].sort((a, b) => fechaDe(b) - fechaDe(a)).slice(0, 3);
      return u.length ? 'Últimos gastos: ' + u.map(x => `${COP(x.monto)} en ${x.subcategoria || x.categoria} el ${fechaDe(x).getDate()}`).join('; ') + '.' : `Sin gastos ${L}.`;
    }
    const entera = cs && (cs[2] || cs[1] === 'Otros' || cs[1] === cs[0]);
    const filtro = arr => cs ? arr.filter(x => x.categoria === cs[0] && (entera || x.subcategoria === cs[1])) : arr;
    const nombre = cs ? (entera ? cs[0] : cs[1]) : 'Gastos';
    if (comp && per.meses?.length === 1) {
      const prev = anterior(per.meses[0]);
      const g0 = suma(filtro(await datos('gastos', { meses: [prev] }, quien))), g1 = suma(filtro(G));
      const pct = g0 ? Math.round((g1 - g0) / g0 * 100) : 0;
      return `${nombre}${de}: ${COP(g1)} ${L} vs ${COP(g0)} en ${MESES[prev[1] - 1]}${g0 ? `, ${pct >= 0 ? 'subió' : 'bajó'} ${Math.abs(pct)}%` : ''}.`;
    }
    if (/credito|tarjeta/.test(t)) {
      const c = filtro(G).filter(x => x.metodoPago === 'credito');
      return `A crédito ${L}${de}: ${COP(suma(c))} en ${c.length} ${c.length === 1 ? 'gasto' : 'gastos'}.`;
    }
    if (cs) {
      const F = filtro(G), sub = nombre !== cs[0];
      return `${nombre} ${L}${de}: ${COP(suma(F))}${sub ? ` (total ${cs[0]} ${COP(suma(G.filter(x => x.categoria === cs[0])))})` : F.length ? `. Mayores: ${top(F, 'subcategoria')}` : ''}.`;
    }
    return `Gastos ${L}${de}: ${COP(suma(G))} en ${G.length} ${G.length === 1 ? 'registro' : 'registros'}.${G.length ? ' Mayores: ' + top(G, 'categoria') + '.' : ''}`;
  }
  return { responder, limpiar: () => cache.clear() };
}
