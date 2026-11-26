// Intérprete local de frases (instantáneo, $0). Nombres de categorías = los de app.html.
export const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!;:]|,(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const SYN = [
  ['Transporte', 'Gasolina', 'gasolina|tanque\\w*|combustible|acpm'],
  ['Transporte', 'Apps', 'uber|didi|cabify|taxi|indrive\\w*|picap'],
  ['Transporte', 'Transporte Publico', 'transmilenio|sitp|bus|buseta|metro|pasajes?|tullave|transporte publico'],
  ['Transporte', 'Mantenimientos', 'mantenimientos?|taller|cambio de aceite|llantas?|lavada del carro|soat|tecnomecanica'],
  ['Servicios', 'Agua', 'agua|acueducto'],
  ['Servicios', 'Energía', 'luz|energia|enel|codensa'],
  ['Servicios', 'Gas', 'gas|vanti'],
  ['Servicios', 'Internet', 'internet|wifi'],
  ['Servicios', 'Celular', 'celular|recarga|plan de datos'],
  ['Servicios', 'Parqueadero', 'parqueadero|parqueo'],
  ['Hogar', 'Arriendo', 'arriendo|alquiler|canon'],
  ['Hogar', 'Couta inicial apto', 'cuota inicial|couta inicial'],
  ['Finanzas', 'Couta FNA', 'fna|fondo nacional'],
  ['Finanzas', 'Couta Coasmedas', 'coasmedas'],
  ['Ocio', 'Plataformas', 'netflix|spotify|disney|hbo|prime video|youtube|plataformas?|suscripcion'],
  ['Ocio', 'Cine', 'cine|cinema|boletas?|crispetas'],
  ['Ocio', 'Viajes', 'viajes?|hotel|vuelos?|tiquetes?|airbnb'],
  ['Ocio', 'Restaurantes', 'restaurantes?|almuerzos?|cena|desayuno|domicilios?|rappi|hamburguesas?|pizza|comida'],
  ['Mercado', 'Carnes', 'carnes?|pollo|pescado|carniceria|cerdo'],
  ['Mercado', 'Aseo', 'aseo|jabon|detergente|papel higienico|limpido|suavizante'],
  ['Mercado', 'Onces', 'onces|panaderia|pan|cafe|mecato|galletas'],
  ['Mercado', 'Otros', 'mercado|supermercado|exito|d1|ara|olimpica|jumbo|carulla|fruver|verduras|frutas|tienda'],
  ['Belleza', 'Uñas', 'manicure|pedicure|(?:las|mis|de) unas'],
  ['Belleza', 'Corte de Pelo', 'peluqueria|barberia|corte de (?:pelo|cabello)|motilada'],
  ['Belleza', 'Pestañas', 'pestanas'],
  ['Adecuaciones Apto', 'Pintura y Estuco', 'pintura|estuco|pintor'],
  ['Adecuaciones Apto', 'Muebles', 'muebles?|sofa|colchon'],
  ['Adecuaciones Apto', 'Maderas', 'maderas?|carpinter\\w*'],
  ['Ropa', 'Ropa', 'ropa|zapatos|tenis|camisas?|pantalon\\w*|vestido|chaqueta'],
  ['Regalos', 'Regalos', 'regalos?|cumpleanos|detalle']
].map(([c, s, r]) => [c, s, new RegExp(`\\b(?:${r})\\b`)]);

const nombreRe = s => { const n = norm(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`\\b${n.length > 3 ? n.replace(/s$/, '') + 's?' : n}\\b`); };
// → [categoria, subcategoria, esCategoriaCompleta, posición]. Gana lo dicho primero; a igual posición, la coincidencia más larga.
export function categoria(t, cats) {
  const cand = [];
  const prueba = (re, c, s, entera) => { const m = re.exec(t); if (m) cand.push([c, s, entera, m.index, m[0].length]); };
  for (const [c, s, r] of SYN) if (cats[c]?.includes(s)) prueba(r, c, s, false);
  for (const c in cats) {
    for (const s of cats[c]) if (!['otros', 'unas'].includes(norm(s))) prueba(nombreRe(s), c, s, false);
    prueba(nombreRe(c), c, 'Otros', true);
  }
  cand.sort((a, b) => a[3] - b[3] || b[4] - a[4] || a[2] - b[2]);
  return cand[0]?.slice(0, 4) || null;
}

const W = Object.fromEntries(('un:1 uno:1 una:1 dos:2 tres:3 cuatro:4 cinco:5 seis:6 siete:7 ocho:8 nueve:9 diez:10 once:11 doce:12 trece:13 catorce:14 quince:15 dieciseis:16 diecisiete:17 dieciocho:18 diecinueve:19 veinte:20 veintiun:21 veintiuno:21 veintidos:22 veintitres:23 veinticuatro:24 veinticinco:25 veintiseis:26 veintisiete:27 veintiocho:28 veintinueve:29 treinta:30 cuarenta:40 cincuenta:50 sesenta:60 setenta:70 ochenta:80 noventa:90 cien:100 ciento:100 doscientos:200 trescientos:300 cuatrocientos:400 quinientos:500 seiscientos:600 setecientos:700 ochocientos:800 novecientos:900')
  .split(' ').map(p => { const [k, v] = p.split(':'); return [k, +v]; }));
const MULT = { mil: 1e3, k: 1e3, luca: 1e3, lucas: 1e3, millon: 1e6, millones: 1e6, palo: 1e6, palos: 1e6 };

export function monto(t) {
  const tk = t.replace(/\$/g, ' ').replace(/(\d)([a-z])/g, '$1 $2').replace(/ientas\b/g, 'ientos').split(' ');
  let best = 0, tot = 0, cur = 0, run = false, lastM = 0;
  const flush = () => {
    if (run) { if (lastM === 1e6 && cur > 0 && cur < 1000) cur *= 1000; best = Math.max(best, tot + cur); }
    tot = cur = lastM = 0; run = false;
  };
  for (let i = 0; i < tk.length; i++) {
    const w = tk[i].replace(/^[^\w]+|[^\w]+$/g, ''), nx = (tk[i + 1] || '').replace(/[^\w]/g, '');
    if (/^\d+(?:[.,]\d+)*$/.test(w)) {
      cur += /^\d+[.,]\d{1,2}$/.test(w) && has(MULT, nx) ? parseFloat(w.replace(',', '.')) : +w.replace(/[.,]/g, '');
      run = true;
    } else if (has(W, w)) { cur += W[w]; run = true; }
    else if (has(MULT, w) && (run || w === 'mil' || w === 'millon')) {
      if (MULT[w] === 1e6) tot = (tot + (cur || 1)) * 1e6; else tot += (cur || 1) * 1e3;
      cur = 0; lastM = MULT[w]; run = true;
    } else if (w === 'y' && run) continue;
    else flush();
  }
  flush();
  return Math.round(best);
}

const ING = [['Nomina', 'nomina|sueldo|salario|quincena'], ['Prima', 'prima'], ['Prestamo', 'prestamo|me prestaron'], ['Subsidio', 'subsidio'],
  ['Otros', 'ingreso|me pagaron|recibi|me consignaron|me entro|me transfirieron|gane|vendi']].map(([s, r]) => [s, new RegExp(`\\b(?:${r})\\b`)]);
const SPEND = /\b(pague|gaste|gastamos|compre|compramos|pago|tanquee)\b/;
const PREGUNTA = /^(cuanto|cuantos|cuanta|que|cual|cuales|como|muestrame|dame|resumen|en que)\b|\bdime\b/;

/** → {pregunta:true} | {tipo:'gasto'|'ingreso', categoria, subcategoria, monto, metodo, dias, ok} */
export function parse(raw, cats) {
  const t = norm(raw);
  const cs = categoria(t, cats);
  if (PREGUNTA.test(t) || raw.includes('?')) return { pregunta: true, categoria: cs?.[0] };
  const m = monto(t);
  // Empieza con categoría/subcategoría → gasto. "ingreso" → ingreso. Con categoría (sin "ingreso") → gasto.
  const ing = cs && cs[3] === 0 ? null : /\bingres/.test(t) ?(ING.slice(0, 4).find(([, r]) => r.test(t)) || ['Otros'])
    : !SPEND.test(t) && !cs && ING.find(([, r]) => r.test(t));
  return {
    tipo: ing ? 'ingreso' : 'gasto', categoria: ing ? null : cs?.[0], subcategoria: ing ? ing[0] : cs?.[1], monto: m,
    metodo: /\b(credito|con (?:la )?tarjeta|tc)\b/.test(t) ? 'credito' : 'debito',
    dias: /\b(antier|anteayer|ante ayer)\b/.test(t) ? 2 : /\bayer\b/.test(t) ? 1 : 0,
    ok: m > 0 && !!(ing || cs)
  };
}
