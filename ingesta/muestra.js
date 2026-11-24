// Copia 10 artículos de datos/ a muestra/, lo único de la base que se publica: sirve para probar
// el proyecto recién clonado. Lo que citan y no está en la muestra queda solo con su enlace oficial.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CAMBIOS, CITADOS, CURADO, DATOS, fuentes, idsDe, leerVigencia, RESUMENES } from "./comun-ingesta.js";

const IDS = new Set([
  "cp-1991:86", "cst:64", "cst:161", "dec-2591-1991:40", "dec-2591-1991:52", "ley-820-2003:20",
  "ley-1480-2011:8", "ley-1480-2011:18", "ley-1480-2011:47", "ley-1480-2011:56",
]);
const MUESTRA = fileURLToPath(new URL("../muestra/", import.meta.url));
if (DATOS === MUESTRA) throw new Error("La muestra se saca de la base completa (datos/), que no está aquí.");
const leer = (r) => JSON.parse(readFileSync(r, "utf8"));
const guardar = (r, x) => writeFileSync(MUESTRA + r, `${JSON.stringify(x, null, 1)}\n`);
rmSync(MUESTRA, { recursive: true, force: true });
for (const d of ["curado", "resumenes", "vigencia"]) mkdirSync(MUESTRA + d, { recursive: true });

const citadas = new Set();
let n = 0;
for (const { id } of fuentes) {
  if (![...IDS].some((x) => x.startsWith(`${id}:`))) continue;
  const curado = leer(`${CURADO}${id}.json`);
  curado.articulos = curado.articulos.filter((a) => IDS.has(a.id));
  for (const a of curado.articulos) for (const r of a.referencias) citadas.add(r.url);
  n += curado.articulos.length;
  guardar(`curado/${id}.json`, curado);
  guardar(`resumenes/${id}.json`, Object.fromEntries(Object.entries(leer(`${RESUMENES}${id}.json`)).filter(([k]) => IDS.has(k))));
}
if (n !== IDS.size) throw new Error(`esperaba ${IDS.size} artículos y hay ${n}`);

const { fuentes: decisiones, afectaciones } = leerVigencia();
const suyas = afectaciones.filter((v) => idsDe(v.articulo).every((id) => IDS.has(id)));
guardar("vigencia/muestra.json", suyas);
guardar("vigencia/decisiones.json", Object.fromEntries(Object.entries(decisiones).filter(([k]) => suyas.some((v) => v.por === k))));
guardar("cambios.json", leer(CAMBIOS).filter((c) => IDS.has(c.articulo)));
const soloEnlace = (d, url) =>
  d.articulo
    ? { cita: d.cita, tipo: "no consultable", url, motivo: "Artículo de la base completa, no incluido en la muestra." }
    : { ...d, tipo: "documento", encabezado: undefined, titulo: undefined, texto: undefined, notas: undefined };
guardar("citados.json", Object.fromEntries(Object.entries(leer(CITADOS)).filter(([u]) => citadas.has(u)).map(([u, d]) => [u, d.tipo === "no consultable" || IDS.has(d.articulo) ? d : soloEnlace(d, u)])));
console.log(`muestra/: ${n} artículos, ${suyas.length} vigencias, ${citadas.size} destinos citados`);
