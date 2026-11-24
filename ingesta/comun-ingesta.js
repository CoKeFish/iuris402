// Rutas y catálogo de normas que comparten los pasos de la ingesta.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ruta = (r) => fileURLToPath(new URL(r, import.meta.url));
// Sin la base completa (no está en el repo) se trabaja con la muestra publicada
export const DATOS = ruta(existsSync(ruta("../datos/curado/")) ? "../datos/" : "../muestra/");
export const CRUDO = ruta("../datos/crudo/");
export const CURADO = `${DATOS}curado/`;
export const OCR = `${DATOS}ocr/`;
export const RESUMENES = `${DATOS}resumenes/`;
export const VIGENCIA = `${DATOS}vigencia/`;
export const CAMBIOS = `${DATOS}cambios.json`;
export const CITADOS = `${DATOS}citados.json`;
export const DECISIONES = `${VIGENCIA}decisiones.json`;
export const fuentes = JSON.parse(readFileSync(ruta("./fuentes.json"), "utf8"));

export const archivoCrudo = (norma, url) =>
  `${CRUDO}${norma.id}.${norma.urls.indexOf(url) + 1}.${norma.formato}`;

// Vigencias: datos/vigencia/decisiones.json (sentencias y leyes) y un archivo por norma
export function leerVigencia() {
  if (!existsSync(DECISIONES)) return { fuentes: {}, afectaciones: [] };
  const leer = (f) => JSON.parse(readFileSync(VIGENCIA + f, "utf8"));
  const archivos = readdirSync(VIGENCIA).filter((f) => f !== "decisiones.json");
  return { fuentes: leer("decisiones.json"), afectaciones: archivos.flatMap(leer) };
}
// "ley:59-67" es un rango de artículos
export const idsDe = (ref) => {
  const r = ref.match(/^(.*):(\d+)-(\d+)$/);
  return r ? Array.from({ length: r[3] - r[2] + 1 }, (_, i) => `${r[1]}:${Number(r[2]) + i}`) : [ref];
};
