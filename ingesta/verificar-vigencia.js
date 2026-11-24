// Comprueba datos/vigencia y le anota el SHA-256 de cada archivo crudo:
//   1. Cada cita (decisión, condición, razón) está literal en el fallo o la ley que la sustenta.
//   2. Cada texto tachado que se explica existe en el artículo.
//   3. No quedan huecos: todo lo tachado, inexequible, condicionado o derogado tiene explicación.
// Sale con error si algo falla. Uso: npm run verificar-vigencia
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodificar } from "./html.js";
import { CURADO, DECISIONES, idsDe as ids, leerVigencia } from "./comun-ingesta.js";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const base = leerVigencia();
const palabras = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
const errores = [];

const crudos = {};
for (const [id, f] of Object.entries(base.fuentes)) {
  // fallos viejos sin texto en línea: se admiten, pero nunca como confirmados
  if (!f.archivo) {
    crudos[id] = "";
    continue;
  }
  if (!existsSync(raiz + f.archivo)) {
    errores.push(`${id}: falta ${f.archivo}`);
    continue;
  }
  const bytes = readFileSync(raiz + f.archivo);
  f.sha256 = createHash("sha256").update(bytes).digest("hex");
  // UTF-8 si de verdad lo es; si no, el windows-1252 de las páginas viejas
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    html = new TextDecoder("windows-1252").decode(bytes);
  }
  html = html.replace(/<(script|style)[\s\S]*?<\/>/gi, " ");
  crudos[id] = ` ${palabras(decodificar(html))} `;
}

const articulos = new Map();
for (const f of readdirSync(CURADO)) {
  for (const a of JSON.parse(readFileSync(CURADO + f, "utf8")).articulos) articulos.set(a.id, a);
}
const explicados = new Map();
for (const v of base.afectaciones) {
  const crudo = crudos[v.por];
  if (crudo === undefined) errores.push(`${v.articulo}: fuente desconocida ${v.por}`);
  if (crudo === "" && (v.confirmado || v.decision)) errores.push(`${v.articulo}: ${v.por} no es consultable, no puede llevar cita ni estar confirmada`);
  if (crudo && !v.decision) errores.push(`${v.articulo}: falta la decisión literal`);
  for (const campo of ["decision", "condicion", "razon"]) {
    if (v[campo] && crudo && !crudo.includes(` ${palabras(v[campo])} `)) errores.push(`${v.articulo} (${v.por}): «${campo}» no está literal en la fuente`);
  }
  for (const id of ids(v.articulo)) {
    const a = articulos.get(id);
    if (!a) {
      errores.push(`no existe ${id}`);
      continue;
    }
    explicados.set(id, [...(explicados.get(id) ?? []), v]);
    const texto = palabras([a.titulo, ...a.seccion, a.texto].join(" "));
    for (const t of v.tachado ?? []) if (!texto.includes(palabras(t))) errores.push(`${id}: no encuentro el tachado «${t}»`);
  }
}

for (const [id, a] of articulos) {
  const suyas = explicados.get(id) ?? [];
  const conoce = suyas.flatMap((v) => (v.tachado ?? []).map(palabras));
  for (const [, t] of [a.titulo, ...a.seccion, a.texto].join(" ").matchAll(/~~([\s\S]*?)~~/g)) {
    if (!conoce.includes(palabras(t))) errores.push(`hueco: ${id} tiene tachado «${t}» sin explicar`);
  }
  for (const n of a.notas) {
    const pide = /inexequible/i.test(n) ? "inexequible" : /condicionalmente/i.test(n) ? "exequibilidad condicionada" : /por el t[ée]rmino/i.test(n) ? "exequibilidad diferida" : /derogad/i.test(n) ? "derogado" : null;
    // un plazo vencido puede haber pasado a inexequible; una derogación, a sustitución
    const sirve = { "exequibilidad diferida": ["inexequible"], derogado: ["subrogado", "vigente", "modificado"] }[pide] ?? [];
    if (pide && !suyas.some((v) => v.estado === pide || sirve.includes(v.estado))) errores.push(`hueco: ${id}, nota «${n}» sin explicar`);
    if (/subrayado CONDICIONALMENTE/i.test(n) && !suyas.some((v) => v.estado === "exequibilidad condicionada" || v.estado === "modificado")) errores.push(`hueco: ${id}, condición sin explicar`);
  }
}

if (errores.length) {
  for (const e of errores) console.log(`✗ ${e}`);
  process.exitCode = 1;
} else {
  writeFileSync(DECISIONES, "{\n" + Object.entries(base.fuentes).map(([k, f]) => ` ${JSON.stringify(k)}: ${JSON.stringify(f)}`).join(",\n") + "\n}\n");
}
const sinConfirmar = base.afectaciones.filter((v) => !v.confirmado);
console.log(`${base.afectaciones.length} afectaciones, ${Object.keys(base.fuentes).length} fuentes, ${errores.length} errores`);
for (const v of sinConfirmar) console.log(`por confirmar: ${v.articulo} (${v.alcance}): ${v.nota}`);
