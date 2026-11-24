// Paso 4: arma datos/leyes.db desde los JSON (curado, resúmenes y vigencia) y calcula el
// embedding del RESUMEN de cada artículo (no del texto legal: el resumen usa las palabras de
// quien pregunta). Los JSON son la fuente de verdad; la base siempre se puede rehacer.
// Lo derogado, lo que está en duda de estarlo (excluir) y lo que no tiene resumen queda en la
// base pero no se vende.
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ESQUEMA_LEYES, LEYES_DB } from "../base.js";
import { embeber, MODELO, raices } from "../buscador.js";
import { CAMBIOS, CITADOS, CURADO, fuentes, idsDe as ids, leerVigencia, RESUMENES } from "./comun-ingesta.js";

const leer = (r) => JSON.parse(readFileSync(r, "utf8"));
const json = (x) => JSON.stringify(x ?? []);
const base = leerVigencia();
const excluidos = new Set(base.afectaciones.filter((v) => v.excluir).flatMap((v) => ids(v.articulo)));

// Se arma aparte y se cambia al final: si algo falla, la base anterior sigue intacta
const temporal = `${LEYES_DB}.nueva`;
rmSync(temporal, { force: true });
const db = new DatabaseSync(temporal); // con llaves foráneas activas
db.exec(ESQUEMA_LEYES);
const insertar = (tabla, fila) => {
  const c = Object.keys(fila);
  return db.prepare(`INSERT INTO ${tabla} (${c.join(", ")}) VALUES (${c.map(() => "?").join(", ")})`).run(...Object.values(fila)).lastInsertRowid;
};

db.exec("BEGIN");
const paraEmbeber = [];
const referencias = [];
let totalVenta = 0;
for (const norma of fuentes) {
  if (!existsSync(`${CURADO}${norma.id}.json`)) {
    console.log(`⚠ ${norma.id}: falta el JSON curado`);
    continue;
  }
  const curado = leer(`${CURADO}${norma.id}.json`);
  const resumenes = existsSync(`${RESUMENES}${norma.id}.json`) ? leer(`${RESUMENES}${norma.id}.json`) : {};
  insertar("normas", {
    id: norma.id, tipo: norma.tipo, nombre: norma.nombre, corto: norma.corto, anio: norma.anio,
    entidad: curado.fuente.entidad, metodo: curado.fuente.metodo, preambulo: curado.preambulo, cierre: curado.cierre,
  });
  const archivos = new Map(
    curado.fuente.archivos.map((f) => [
      f.url,
      insertar("archivos_crudos", { norma_id: norma.id, url: f.url, archivo: f.archivo, formato: f.formato, sha256: f.sha256, descargado: f.descargado }),
    ]),
  );
  let enVenta = 0;
  curado.articulos.forEach((a, orden) => {
    const r = resumenes[a.id];
    const vende = !a.derogado && !excluidos.has(a.id) && Boolean(r?.resumen);
    const avisa = !vende && Boolean(r?.resumen);
    const cita = norma.formato === "html" ? `${norma.corto}, art. ${a.articulo}` : `${norma.corto}, ${a.titulo}`;
    insertar("articulos", {
      id: a.id, norma_id: norma.id, archivo_id: archivos.get(a.url.split("#")[0]), orden, articulo: a.articulo,
      encabezado: a.encabezado, titulo: a.titulo, seccion_json: json(a.seccion), texto: a.texto, notas_json: json(a.notas),
      url: a.url, cita, argumento: r?.argumento ?? "", derogado: Number(a.derogado), en_venta: Number(vende), aviso: Number(avisa),
    });
    for (const x of a.referencias) referencias.push([a.id, x]);
    if (r?.resumen) insertar("resumenes", { articulo_id: a.id, resumen: r.resumen, temas_json: json(r.temas), preguntas_json: json(r.preguntas) });
    if (!vende && !avisa) return;
    if (vende) {
      enVenta++;
      totalVenta++;
    }
    // lo tachado no debe atraer búsquedas
    insertar("articulos_fts", { articulo_id: a.id, raices: raices([cita, a.titulo, a.texto].join(" ").replace(/~~[\s\S]*?~~/g, " ")).join(" ") });
    // lo que no rige se busca por su nombre y por de qué trataba: su resumen dice solo "derogado"
    paraEmbeber.push([a.id, 0, "passage", `${norma.corto}. ${a.titulo}. ${a.derogado ? a.encabezado : r.resumen} ${(r.preguntas ?? []).join(" ")}`]);
    if (avisa) paraEmbeber.push([a.id, 99, "query", `¿Qué dispone el artículo ${a.articulo} de ${norma.corto}${a.titulo ? ` en materia de ${a.titulo.toLowerCase()}` : ""}?`]);
    (r.preguntas ?? []).forEach((p, n) => paraEmbeber.push([a.id, n + 1, "query", p]));
  });
  console.log(`${norma.id}: ${enVenta} de ${curado.articulos.length} en venta`);
}

const destinos = new Map();
for (const [ref, d] of Object.entries(leer(CITADOS))) {
  destinos.set(ref, insertar("destinos", {
    ref_url: ref, cita: d.cita, tipo: d.tipo, articulo_id: d.articulo ?? null, norma_id: d.norma ?? null, url: d.url ?? null, documento: d.documento ?? null,
    entidad: d.entidad ?? (d.url?.includes("corteconstitucional") ? "Corte Constitucional" : d.url ? "Secretaría del Senado" : null),
    encabezado: d.encabezado ?? null, titulo: d.titulo ?? null, texto: d.texto ?? null, archivo: d.archivo ?? null, sha256: d.sha256 ?? null, motivo: d.motivo ?? null,
  }));
}
for (const [id, x] of referencias) {
  if (!destinos.has(x.url)) throw new Error(`${id} cita ${x.url} y no está en citados.json: corre npm run citar`);
  insertar("referencias", { articulo_id: id, destino_id: destinos.get(x.url), tipo: x.tipo, contexto: x.contexto, correccion: x.motivo_correccion ?? null });
}

for (const [id, f] of Object.entries(base.fuentes)) {
  insertar("decisiones", { id, tipo: f.tipo, nombre: f.nombre, entidad: f.entidad, fecha: f.fecha, ponente: f.ponente ?? null, objeto: f.objeto ?? null, url: f.url ?? null, archivo: f.archivo ?? null, sha256: f.sha256 ?? null });
}
for (const v of base.afectaciones) {
  const id = insertar("vigencias", {
    decision_id: v.por, alcance: v.alcance, estado: v.estado, forma: v.forma ?? null, reemplazo: Number(Boolean(v.reemplazo)), decision: v.decision ?? null, condicion: v.condicion ?? null, razon: v.razon ?? null,
    nota: v.nota ?? null, efecto_desde: v.efecto_desde ?? null, tachado_json: v.tachado ? json(v.tachado) : null, confirmado: Number(v.confirmado),
  });
  for (const a of ids(v.articulo)) insertar("vigencia_articulos", { vigencia_id: id, articulo_id: a });
}

for (const c of leer(CAMBIOS)) {
  insertar("cambios", { articulo_id: c.articulo, alcance: c.alcance, cambio: c.cambio, por: c.por, nota: c.nota, texto_del_cambio: c.texto_del_cambio, url: c.url, razon: c.razon });
}

for (const tipo of ["passage", "query"]) {
  const deTipo = paraEmbeber.filter((x) => x[2] === tipo);
  for (let i = 0; i < deTipo.length; i += 32) {
    const lote = deTipo.slice(i, i + 32);
    const vectores = await embeber(lote.map((x) => x[3]), tipo);
    lote.forEach(([id, n], j) => insertar("vectores", { articulo_id: id, n, modelo: MODELO, vector: new Uint8Array(vectores[j].buffer, vectores[j].byteOffset, vectores[j].byteLength) }));
  }
}
db.exec("COMMIT");
const roto = db.prepare("PRAGMA foreign_key_check").all();
if (roto.length) throw new Error(`llaves foráneas rotas: ${JSON.stringify(roto)}`);
db.close();
try {
  renameSync(temporal, LEYES_DB);
} catch (e) {
  throw new Error(`No pude reemplazar leyes.db (¿está encendida la API?): ${e.message}`);
}
console.log(`leyes.db: ${totalVenta} artículos en venta, ${paraEmbeber.filter((x) => x[1] === 0).length - totalVenta} solo para avisar, ${base.afectaciones.length} vigencias, ${referencias.length} referencias`);
