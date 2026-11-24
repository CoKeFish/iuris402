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
const PESO_PALABRAS = Number(process.env.PESO_PALABRAS || 0.05);

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

// El texto de las normas a las que remiten estos artículos ("cita", no las notas de vigencia)
export function textosCitados(db, articulos, maximo = 6) {
  const ya = new Set(articulos.map((a) => a.id));
  const salida = [];
  for (const a of articulos) {
    for (const r of a.referencias) {
      if (r.tipo !== "cita" || !r.id || ya.has(r.id) || salida.length >= maximo) continue;
      ya.add(r.id);
      const t = consultar(db, r.id);
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
  const fts = db.prepare("SELECT articulo_id FROM articulos_fts WHERE articulos_fts MATCH ? ORDER BY bm25(articulos_fts)");
  return { db, docs, normas, fts };
}

// Artículos que la pregunta nombra por su número: "artículo 37 de la Ley 820 de 2003", "art. 64 del CST"
const CODIGOS = [[/constituci[oó]n/i, "cp-1991"], [/\bcst\b|c[oó]digo sustantivo/i, "cst"], [/c[oó]digo penal/i, "penal-269"], [/\bcpaca\b/i, "ley-1437-2011"]];
export function nombrados(docs, pregunta) {
  const ids = new Set();
  for (const m of pregunta.matchAll(/\bart(?:[ií]culo|\.)?\s*(\d+(?:\s*-?[A-Z])?)\b(.{0,60})/gi)) {
    const ley = m[2].match(/\b(ley|decreto)\D{0,12}(\d[\d.]*)(?:\s+de\s+(\d{4}))?/i);
    const norma = ley
      ? (id) => new RegExp(`^${ley[1].toLowerCase() === "ley" ? "ley" : "dec"}-${ley[2].replace(/\D/g, "")}-${ley[3] ?? "[0-9]{4}"}$`).test(id)
      : (id) => CODIGOS.some(([r, c]) => c === id && r.test(m[2]));
    const numero = m[1].replace(/[\s-]/g, "").toUpperCase();
    for (const d of docs) {
      const [n, a] = d.id.split(":");
      if (a === numero && norma(n)) ids.add(d.id);
    }
  }
  return ids;
}

// Devuelve los k artículos más relevantes, o [] si la pregunta no es del corpus.
// formas: la misma pregunta en lenguaje jurídico (reformular.js). De cada artículo cuenta la mejor.
export async function buscar(indice, pregunta, k = 5, umbral = UMBRAL, formas = []) {
  const vectores = await embeber([pregunta, ...formas], "query");
  const variantes = vectores.map((q) => {
    const punto = (v) => v.reduce((s, x, i) => s + x * q[i], 0);
    return new Map(indice.docs.map((d) => [d.id, { sentido: punto(d.vector), parecido: Math.max(0, ...d.preguntas.map(punto)) }]));
  });
  const similitud = (d) => Math.max(...variantes.map((v) => Math.max(v.get(d.id).sentido, v.get(d.id).parecido)));
  const mejor = Math.max(...variantes.flatMap((v) => [...v.values()].map((x) => x.parecido)));
  const pedidos = nombrados(indice.docs, pregunta);
  if (mejor < umbral && !pedidos.size) return Object.assign([], { mejor, avisos: [], soloAviso: false });
  const consulta = consultaFts([pregunta, ...formas].join(" "));
  const palabras = consulta ? indice.fts.all(consulta).map((f) => f.articulo_id) : [];
  const ordenar = (docs) => {
    const puestos = (clave) => variantes.map((v) => new Map([...docs].sort((a, b) => v.get(b.id)[clave] - v.get(a.id)[clave]).map((d, n) => [d.id, n + 1])));
    const [sentido, parecido] = [puestos("sentido"), puestos("parecido")];
    const ids = new Set(docs.map((d) => d.id));
    const porPalabras = new Map(palabras.filter((p) => ids.has(p)).map((p, n) => [p, n + 1]));
    const puntos = (d) => Math.max(...variantes.map((_, i) => 1 / (60 + sentido[i].get(d.id)) + 1 / (60 + parecido[i].get(d.id)))) + PESO_PALABRAS / (60 + (porPalabras.get(d.id) ?? Infinity));
    return docs.map((d) => [puntos(d) + pedidos.has(d.id), d]).sort((a, b) => b[0] - a[0]).map(([, d]) => d);
  };
  const dar = (d) => ({ articulo: d, similitud: Number(similitud(d).toFixed(3)) });
  // lo que no rige no compite con lo que se vende: si sale arriba, va aparte como aviso
  const vendibles = ordenar(indice.docs.filter((d) => !d.aviso));
  const avisos = ordenar(indice.docs).slice(0, k).filter((d) => d.aviso);
  // Solo el aviso, sin responder, si lo caído es claramente lo preguntado y nada lo reemplazó.
  // En la duda se responde: es peor callar una norma vigente que repetir un aviso.
  const mejorVenta = Math.max(...vendibles.map(similitud));
  const soloAviso = avisos.some((d) => pedidos.has(d.id) || (similitud(d) - mejorVenta >= MARGEN_AVISO && !d.vigencia.some((v) => v.reemplazo)));
  return Object.assign(vendibles.slice(0, k).map(dar), { mejor, avisos: avisos.map(dar), soloAviso });
}
