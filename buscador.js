// Búsqueda híbrida, combinada por posición (RRF): el sentido del artículo (embedding del resumen),
// el parecido con las preguntas que responde (un embedding por pregunta) y, con poco peso, las
// palabras exactas (BM25 de SQLite). El resumen y las preguntas nunca se leen aquí: solo sus vectores.
import { env, pipeline } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";
import { abrirLeyes } from "./base.js";

env.cacheDir = fileURLToPath(new URL("./.modelos/", import.meta.url));
export const MODELO = "Xenova/multilingual-e5-small";
const DIMENSIONES = 384;
// Parecido mínimo con la pregunta más cercana: por debajo, no es de este corpus y no se cobra.
export const UMBRAL = Number(process.env.UMBRAL || 0.85);

const MARGEN_AVISO = 0.02;
const PESO_PALABRAS = Number(process.env.PESO_PALABRAS || 0.15);

let extractor;
// E5 pide anteponer "query: " a la pregunta y "passage: " a lo indexado
export async function embeber(textos, tipo) {
  extractor ??= await pipeline("feature-extraction", MODELO, { dtype: "q8" });
  const t = await extractor(textos.map((x) => `${tipo}: ${x}`), { pooling: "mean", normalize: true });
  return t.tolist().map((v) => Float32Array.from(v));
}

const VACIAS = new Set(
  "de la el en y a los las un una que del por para con no se su al o lo mi me es si como sin sobre este esta puede pueden puedo debe cual cuando cuanto tengo tiene hay ser son mas ya le les".split(" "),
);
// Raíz simple: "cobros", "cobro" y "cobra" caen juntas. Se usa igual al indexar y al buscar.
export const raices = (s) =>
  (s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length > 1 && !VACIAS.has(t))
    .map((t) => t.slice(0, 5));
const consultaFts = (pregunta) => [...new Set(raices(pregunta))].map((t) => `"${t}"`).join(" OR ");

const ARTICULO = `
  SELECT a.*, n.entidad, n.metodo, f.formato, f.sha256, f.descargado /*vector*/
  FROM articulos a JOIN normas n ON n.id = a.norma_id JOIN archivos_crudos f ON f.id = a.archivo_id`;

function armar(db, a) {
  const vigencia = db
    .prepare(`
      SELECT v.*, d.nombre, d.fecha, d.entidad, d.url, d.sha256, d.objeto
      FROM vigencia_articulos va JOIN vigencias v ON v.id = va.vigencia_id JOIN decisiones d ON d.id = v.decision_id
      WHERE va.articulo_id = ? ORDER BY v.id`)
    .all(a.id)
    .map((v) => ({
      alcance: v.alcance,
      tachado: v.tachado_json ? JSON.parse(v.tachado_json) : undefined,
      estado: v.estado,
      forma: v.forma ?? undefined,
      reemplazo: Boolean(v.reemplazo),
      decidido_por: v.nombre,
      fecha: v.fecha,
      efecto_desde: v.efecto_desde ?? undefined,
      decision: v.decision,
      condicion: v.condicion,
      razon: v.razon,
      // si no hay motivación, lo que la propia ley declara como su objeto
      objeto_de_la_norma: v.objeto ?? undefined,
      nota: v.nota ?? undefined,
      confirmado: Boolean(v.confirmado),
      fuente: { entidad: v.entidad, url: v.url, sha256: v.sha256 },
    }));
  return {
    id: a.id,
    cita: a.cita,
    titulo: a.titulo,
    seccion: JSON.parse(a.seccion_json),
    texto: a.texto,
    notas: JSON.parse(a.notas_json),
    derogado: Boolean(a.derogado),
    aviso: Boolean(a.aviso),
    vigencia,
    cambios: db
      .prepare("SELECT alcance, cambio, por, nota, razon, url FROM cambios WHERE articulo_id = ? ORDER BY id")
      .all(a.id)
      .map((c) => ({ ...c })),
    referencias: referenciasDe(db, a.id),
    argumento: a.argumento,
    fuente: { entidad: a.entidad, url: a.url, formato: a.formato, metodo: a.metodo, descargado: a.descargado, sha256: a.sha256 },
  };
}

// A qué otras normas remite un artículo, y cómo consultarlas
function referenciasDe(db, id) {
  return db
    .prepare(`
      SELECT r.tipo AS clase, r.contexto, r.correccion, d.id AS destino, d.tipo, d.cita, d.articulo_id, d.url, d.motivo,
        a.cita AS cita_propia, a.url AS url_propia, n.corto, (SELECT url FROM archivos_crudos WHERE norma_id = n.id ORDER BY id LIMIT 1) AS url_norma
      FROM referencias r JOIN destinos d ON d.id = r.destino_id
      LEFT JOIN articulos a ON a.id = d.articulo_id LEFT JOIN normas n ON n.id = d.norma_id
      WHERE r.articulo_id = ? ORDER BY r.tipo, d.id`)
    .all(id)
    .map((r) => {
      const consulta = r.articulo_id ?? (r.tipo === "artículo" ? `ext:${r.destino}` : null);
      return {
        tipo: r.clase,
        a: r.cita_propia ?? r.corto ?? r.cita,
        contexto: r.contexto,
        url: r.url_propia ?? r.url_norma ?? r.url ?? null,
        id: consulta,
        consultar: consulta ? `/articulo?id=${encodeURIComponent(consulta)}` : null,
        consultable: r.tipo !== "no consultable",
        motivo: r.motivo ?? undefined,
        enlace_corregido: r.correccion ?? undefined,
      };
    });
}

// Un artículo por su id ("ley-820-2003:20"), o uno externo que alguna de nuestras normas cita ("ext:12")
export function consultar(db, id) {
  const ext = id.match(/^ext:(\d+)$/);
  if (ext) {
    const d = db.prepare("SELECT * FROM destinos WHERE id = ? AND tipo = 'artículo'").get(Number(ext[1]));
    return d && { id, cita: d.cita, titulo: d.titulo, texto: d.texto, citado_por: citadoPor(db, d.id), fuente: { entidad: d.entidad, url: d.url, sha256: d.sha256 }, nota: "Disposición citada por una norma del corpus. Su vigencia no ha sido verificada; debe constatarse en la fuente oficial." };
  }
  const a = db.prepare(`${ARTICULO} WHERE a.id = ?`).get(id);
  if (!a) return undefined;
  const destinos = db.prepare("SELECT id FROM destinos WHERE articulo_id = ?").all(id);
  const { argumento, ...resto } = armar(db, a);
  return { ...resto, citado_por: destinos.flatMap((d) => citadoPor(db, d.id)) };
}
const citadoPor = (db, destino) =>
  db.prepare("SELECT a.id, a.cita, r.tipo, r.contexto FROM referencias r JOIN articulos a ON a.id = r.articulo_id WHERE r.destino_id = ? ORDER BY a.id").all(destino);

// El texto de las normas a las que remiten los artículos directos ("cita", no las notas de vigencia).
// Las nuestras que venían al caso ya salieron elegidas: aquí van sobre todo las de afuera.
export function textosCitados(db, resultados, maximo = 4) {
  const ya = new Set(resultados.map((x) => x.articulo.id));
  const salida = [];
  const elegidos = resultados.some((x) => x.relevancia);
  for (const { articulo: a } of resultados.filter((x) => !elegidos || x.relevancia === "directa").slice(0, 3)) {
    for (const r of a.referencias) {
      if (r.tipo !== "cita" || !r.id || ya.has(r.id) || salida.length >= maximo || (elegidos && !r.id.startsWith("ext:"))) continue;
      ya.add(r.id);
      const t = consultar(db, r.id);
      if (!t?.texto) continue;
      salida.push({ ref: `[R${salida.length + 1}]`, cita: t.cita, titulo: t.titulo, citado_en: a.cita, texto: t.texto.length > 4000 ? `${t.texto.slice(0, 4000)}…` : t.texto, recortado: t.texto.length > 4000, derogado: t.derogado, vigencia: t.vigencia, fuente: t.fuente, nota: t.nota });
    }
  }
  return salida;
}

export function cargarIndice() {
  const db = abrirLeyes();
  const vector = (b) => {
    const v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    if (v.length !== DIMENSIONES) throw new Error(`vector de ${v.length} dimensiones`);
    return v;
  };
  const preguntas = Map.groupBy(db.prepare("SELECT articulo_id, vector FROM vectores WHERE n > 0 AND modelo = ?").all(MODELO), (f) => f.articulo_id);
  const docs = db
    .prepare(`${ARTICULO} JOIN vectores e ON e.articulo_id = a.id AND e.n = 0 WHERE (a.en_venta = 1 OR a.aviso = 1) AND e.modelo = ? ORDER BY n.rowid, a.orden`.replace("/*vector*/", ", e.vector"))
    .all(MODELO)
    .map((a) => ({ ...armar(db, a), vector: vector(a.vector), preguntas: (preguntas.get(a.id) ?? []).map((f) => vector(f.vector)) }));
  const normas = db
    .prepare(`
      SELECT n.id, n.tipo, n.nombre, count(a.id) AS articulos,
        (SELECT url FROM archivos_crudos WHERE norma_id = n.id ORDER BY id LIMIT 1) AS fuente
      FROM normas n LEFT JOIN articulos a ON a.norma_id = n.id AND a.en_venta = 1 GROUP BY n.id ORDER BY n.rowid`)
    .all();
  // espejo → artículos que modificó y ya traen su texto; vecinos → los que se citan entre sí
  const grupos = (sql) => {
    const m = new Map();
    for (const { a, b } of db.prepare(sql).all()) if (a !== b) m.set(a, [...new Set([...(m.get(a) ?? []), b])]);
    return m;
  };
  const espejos = grupos("SELECT DISTINCT a.id AS a, c.articulo_id AS b FROM cambios c JOIN articulos a ON a.cita = c.por JOIN articulos d ON d.id = c.articulo_id WHERE d.en_venta = 1");
  const citas = "SELECT r.articulo_id AS a, d.articulo_id AS b FROM referencias r JOIN destinos d ON d.id = r.destino_id WHERE d.articulo_id IS NOT NULL";
  const vecinos = grupos(`${citas} UNION SELECT b, a FROM (${citas})`);
  const fts = db.prepare("SELECT articulo_id FROM articulos_fts WHERE articulos_fts MATCH ? ORDER BY bm25(articulos_fts)");
  return { db, docs, normas, fts, espejos, vecinos };
}

// Artículos que la pregunta nombra por su número, antes o después de la norma: "artículo 37 de la
// Ley 820 de 2003", "la Ley 675, en su art. 37", "arts. 14 y 15 de la Ley 1581", "art. 64 del CST"
const CODIGOS = [
  [/constituci[oó]n/i, "cp-1991"], [/\bcst\b|c[oó]digo sustantivo/i, "cst"], [/c[oó]digo penal/i, "penal-269"], [/\bcpaca\b/i, "ley-1437-2011"],
  [/c[oó]digo de comercio|\bcco\b|\bc\. ?co\b/i, "cco"], [/estatuto tributario|\be\.?t\b/i, "et"], [/\bs\.?a\.?s\b/i, "ley-1258-2008"], [/c[oó]digo sanitario/i, "ley-9-1979"], [/c[oó]digo (?:nacional )?de (?:polic[ií]a|seguridad y convivencia)/i, "ley-1801-2016"],
  [/estatuto del consumidor/i, "ley-1480-2011"], [/ley de propiedad horizontal/i, "ley-675-2001"], [/circular[^.]{0,20}\b0*02\b|circular[^.]{0,30}\bsic\b/i, "sic-ce-002-2024"],
];
const NORMA = /\b(ley|decreto)(?:\s+ley)?\s+(?:\D{0,12})?(\d[\d.]*)(?:\s+de\s+(\d{4}))?/gi;
// Las normas que menciona un texto, con su posición
function normasEn(texto) {
  const l = [...texto.matchAll(NORMA)].map((m) => [m.index, new RegExp(`^${m[1].toLowerCase() === "ley" ? "ley" : "dec"}-${m[2].replace(/\D/g, "")}-${m[3] ?? "[0-9]{4}"}$`), m.index + m[0].length]);
  for (const [r, id] of CODIGOS) for (const m of texto.matchAll(new RegExp(r.source, "gi"))) l.push([m.index, new RegExp(`^${id}$`), m.index + m[0].length]);
  return l.sort((a, b) => a[0] - b[0]);
}
const NUM = "(?:\\d+(?:-\\d+|[A-Z])?|[IVX]+)(?:[oº°]\\.?)?";
const PARTES = new RegExp(`\\b(?:art(?:[ií]culos?|s?\\.)?|instrucci[oó]n(?:es)?)\\s*(${NUM}(?:\\s*(?:,|y|e|a|al)\\s*${NUM})*)(?![\\w])`, "gi");
export function nombrados(docs, pregunta) {
  const ids = new Set();
  for (const m of pregunta.matchAll(PARTES)) {
    const fin = m.index + m[0].length;
    // la norma más cercana: la primera que sigue («art. 64 del CST») o la última que precede («la Ley 675, art. 37»)
    const despues = normasEn(pregunta.slice(fin, fin + 60).split(/\bart(?:[ií]culos?|s?\.)\s*\d/i)[0])[0];
    const antes = normasEn(pregunta.slice(Math.max(0, m.index - 60), m.index)).at(-1);
    const conecta = despues && /^\s*(?:,\s*)?(?:de|del|de la|de el|\()?\s*$/i.test(pregunta.slice(fin, fin + despues[0]).replace(/\b(?:la|el|los|las)\b/gi, ""));
    const norma = conecta ? despues : antes ?? despues;
    if (!norma) continue;
    const numeros = new Set();
    const limpio = (x) => x.replace(/[oº°.]+$/i, "").toUpperCase();
    for (const tramo of m[1].split(/\s*(?:,|\by\b|\be\b)\s*/i)) {
      const r = tramo.match(/^(\d+)\S*\s+al?\s+(\d+)/i);
      if (r && Number(r[2]) - Number(r[1]) < 40) for (let n = Number(r[1]); n <= Number(r[2]); n++) numeros.add(String(n));
      else numeros.add(limpio(tramo));
    }
    for (const d of docs) {
      const [n, a] = d.id.split(":");
      if (numeros.has(a.toUpperCase()) && norma[1].test(n)) ids.add(d.id);
    }
  }
  return ids;
}

// Reformular y elegir en fila tardan el doble: se elige desde ya con la pregunta tal cual y, si al
// reformularla resulta tener un solo problema y ya se eligió algo, esa es la respuesta. Solo si tiene
// varios problemas, o si no salió nada, se repite con los problemas separados.
export async function responder(indice, pregunta, k, traducir, elegir) {
  const primera = buscar(indice, pregunta, k, undefined, [], elegir).catch(() => null);
  const forma = await traducir(pregunta);
  const vacio = (x) => Object.assign([], { avisos: [], soloAviso: false, ...x });
  if (forma === null) return { forma, r: vacio({ fallo: true }) };
  if (forma && !forma.aplica) return { forma, r: vacio() };
  const formas = forma?.formas ?? [];
  if (!forma || formas.length <= 1) {
    const r = await primera;
    if (r && ((r.elegido && (r.length || r.soloAviso)) || !forma)) return { forma, r };
  }
  return { forma, r: await buscar(indice, pregunta, k, undefined, formas, elegir) };
}

// Devuelve hasta k artículos, o [] si la pregunta no es del corpus o ninguno la resuelve.
// formas: los problemas jurídicos de la pregunta (reformular.js). elegir: quién escoge entre los
// candidatos (elegir.js); sin él, o si falla, vale el orden de la búsqueda.
export async function buscar(indice, pregunta, k = 5, umbral = UMBRAL, formas = [], elegir = null) {
  const vectores = await embeber([pregunta, ...formas], "query");
  const variantes = vectores.map((q) => {
    const punto = (v) => v.reduce((s, x, i) => s + x * q[i], 0);
    return new Map(indice.docs.map((d) => [d.id, { sentido: punto(d.vector), parecido: Math.max(0, ...d.preguntas.map(punto)) }]));
  });
  const similitud = (d) => Math.max(...variantes.map((v) => Math.max(v.get(d.id).sentido, v.get(d.id).parecido)));
  const mejor = Math.max(...variantes.flatMap((v) => [...v.values()].map((x) => x.parecido)));
  const pedidos = nombrados(indice.docs, [pregunta, ...formas].join(" \n "));
  if (mejor < umbral && !pedidos.size) return Object.assign([], { mejor, avisos: [], soloAviso: false });
  const consulta = consultaFts([pregunta, ...formas].join(" "));
  const palabras = consulta ? indice.fts.all(consulta).map((f) => f.articulo_id) : [];
  // Quien modificó un artículo repite lo que el artículo ya dice: solo sale si lo nombran
  const sinEspejos = (docs) => docs.filter((d) => pedidos.has(d.id) || !indice.espejos.get(d.id)?.some((x) => docs.some((o) => o.id === x)));
  const ordenar = (docs) => {
    const puestos = (clave) => variantes.map((v) => new Map([...docs].sort((a, b) => v.get(b.id)[clave] - v.get(a.id)[clave]).map((d, n) => [d.id, n + 1])));
    const [sentido, parecido] = [puestos("sentido"), puestos("parecido")];
    const ids = new Set(docs.map((d) => d.id));
    const porPalabras = new Map(palabras.filter((p) => ids.has(p)).map((p, n) => [p, n + 1]));
    const puntos = (d) => Math.max(...variantes.map((_, i) => 1 / (60 + sentido[i].get(d.id)) + 1 / (60 + parecido[i].get(d.id)))) + PESO_PALABRAS / (60 + (porPalabras.get(d.id) ?? Infinity));
    return docs.map((d) => [puntos(d) + pedidos.has(d.id), d]).sort((a, b) => b[0] - a[0]).map(([, d]) => d);
  };
  const dar = (d, relevancia) => ({ articulo: d, similitud: Number(similitud(d).toFixed(3)), relevancia });
  const enVenta = sinEspejos(indice.docs.filter((d) => !d.aviso));
  const sinVigencia = indice.docs.filter((d) => d.aviso);
  // lo que no rige no compite con lo que se vende: va aparte, como aviso
  const vendibles = ordenar(enVenta);
  const mejorVenta = Math.max(0, ...vendibles.map(similitud));

  const eleccion = elegir ? await elegir(pregunta, formas, candidatos()) : undefined;
  // el LLM está configurado y no respondió: mejor no responder que cobrar cualquier cosa
  if (eleccion === null) return Object.assign([], { mejor, avisos: [], soloAviso: false, fallo: true });
  if (eleccion) {
    const { directos, complementarios } = eleccion;
    const avisos = [...sinVigencia.filter((d) => pedidos.has(d.id)), ...eleccion.sinVigencia.filter((d) => !pedidos.has(d.id))];
    // Solo el aviso si nombran la norma caída, o si nada vigente resuelve lo preguntado
    const nombroVigente = enVenta.some((d) => pedidos.has(d.id));
    const soloAviso = avisos.length > 0 && (!directos.length || (!nombroVigente && avisos.some((d) => pedidos.has(d.id))));
    const lista = directos.length ? [...directos.map((d) => dar(d, "directa")), ...complementarios.map((d) => dar(d, "complementaria"))].slice(0, k) : [];
    return Object.assign(soloAviso && !lista.length ? vendibles.slice(0, 3).map((d) => dar(d)) : lista, { mejor, avisos: avisos.map((d) => dar(d)), soloAviso, elegido: true });
  }

  const todos = ordenar(sinEspejos(indice.docs));
  const avisos = todos.filter((d, n) => d.aviso && (pedidos.has(d.id) || (n < 5 && similitud(d) >= mejorVenta - 0.005)));
  // Solo el aviso, sin responder, si lo caído es claramente lo preguntado y nada lo reemplazó.
  // En la duda se responde: es peor callar una norma vigente que repetir un aviso.
  const soloAviso = avisos.some((d) => pedidos.has(d.id) || (similitud(d) - mejorVenta >= MARGEN_AVISO && !d.vigencia.some((v) => v.reemplazo)));
  return Object.assign(vendibles.slice(0, k).map((d) => dar(d)), { mejor, avisos: avisos.map((d) => dar(d)), soloAviso });

  // Lo que leerá el LLM: lo más parecido en conjunto, lo mejor de cada problema, lo mejor por palabras,
  // lo que citan los primeros, sus artículos contiguos y lo que ya no rige pero se parece
  function candidatos() {
    const nota = (v, d) => v.get(d.id).sentido + 2 * v.get(d.id).parecido;
    const top = (docs, f, n) => [...docs].sort((a, b) => f(b) - f(a)).slice(0, n);
    const conjunto = (d) => variantes.reduce((s, v) => s + nota(v, d), 0);
    const elegidos = new Set([...enVenta.filter((d) => pedidos.has(d.id)), ...top(enVenta, conjunto, 16)]);
    for (const v of variantes) for (const d of top(enVenta, (x) => nota(v, x), 6)) elegidos.add(d);
    const porId = new Map(enVenta.map((d) => [d.id, d]));
    for (const id of palabras.filter((p) => porId.has(p)).slice(0, 3)) elegidos.add(porId.get(id));
    // si lo citado es un artículo modificatorio, vale el que ya trae su texto
    const vigente = (id) => (porId.has(id) ? [id] : (indice.espejos.get(id) ?? []));
    const enlazados = new Set([...top(enVenta, conjunto, 4), ...[...elegidos].filter((d) => pedidos.has(d.id))].flatMap((d) => [...(indice.vecinos.get(d.id) ?? [])].flatMap(vigente)));
    for (const d of top([...enlazados].map((id) => porId.get(id)).filter((d) => d && !elegidos.has(d)), conjunto, 5)) elegidos.add(d);
    // una institución suele repartirse en artículos seguidos
    for (const d of top(enVenta, conjunto, 4)) {
      const i = enVenta.indexOf(d);
      for (const v of [enVenta[i - 1], enVenta[i + 1]]) if (v && v.id.split(":")[0] === d.id.split(":")[0]) elegidos.add(v);
    }
    const caidos = [...new Set([...sinVigencia.filter((d) => pedidos.has(d.id)), ...top(sinVigencia, similitud, 3).filter((d) => similitud(d) >= mejorVenta - 0.03)])];
    return [...[...elegidos].slice(0, 40 - caidos.length), ...caidos];
  }
}
