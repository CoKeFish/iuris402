// Lectura del HTML de la Secretaría del Senado.
import { existsSync, readFileSync } from "node:fs";

const ENTIDADES = {
  nbsp: " ", amp: "&", quot: '"', ordm: "º", ordf: "ª", deg: "°", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", iexcl: "¡",
  iquest: "¿", sect: "§", uuml: "ü", Uuml: "Ü", ntilde: "ñ", Ntilde: "Ñ", bull: "•",
  hellip: "…", frac12: "½", frac14: "¼", middot: "·", shy: "",
};
const ACENTOS = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };

// Las tablas de la ley quedan por filas ("Numeral 1 | Multa general tipo 2"); las demás son cajas y
// menús de la casa editorial, que no son la norma
function tabla(h) {
  const filas = [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((f) => [...f[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1].replace(/<[^>]+>/g, " ").replace(/&lt;((?:(?!&[lg]t;)[\s\S]){3,}?)&gt;/g, "⦅$1⦆").replace(/&gt;/g, "&#62;").replace(/&lt;/g, "&#60;").replace(/⦅/g, "&lt;").replace(/⦆/g, "&gt;").replace(/\s+/g, " ").trim()).filter(Boolean));
  const deLey = filas.length > 1 && !/^<table[^>]*class="?caja/i.test(h) && h.length < 30_000;
  return deLey ? filas.filter((f) => f.length).map((f) => `<p>${f.join(" | ")}</p>`).join("") : "";
}

// La Secretaría del Senado publica en windows-1252. El gestor de Función Pública, en UTF-8, con el ancla
// después de la palabra "ARTÍCULO" y notas propias en negrilla («Ver…»), que no son la norma.
function leerPagina(bytes) {
  const h = new TextDecoder("windows-1252").decode(bytes);
  if (!h.includes("Gestor Normativo")) return h;
  return new TextDecoder("utf-8")
    .decode(bytes)
    .replace(/<strong>\s*(?:Ver|NOTA)\b[\s\S]*?<\/strong>/gi, "")
    .replace(/ART(?:Í|&Iacute;)CULO(?:\s|&nbsp;)*<a[^>]*\bname="(\d+)"[^>]*><\/a>(?:\s|&nbsp;)*(\d+)\s*(?:º|°|&ordm;|&deg;|o)?\s*\.?-?/gi, '<a name="$1">ARTÍCULO $2. </a>')
    // algunos artículos no traen ancla, solo el encabezado en negrilla
    .replace(/<strong>\s*ART(?:Í|&Iacute;)CULO(?:\s|&nbsp;)+(\d+)\s*(?:º|°|&ordm;|&deg;|o)?\s*\.?-?/gi, '<strong><a name="$1">ARTÍCULO $1. </a>')
    // sus anotaciones («Reglamentado por…», «Adicionado por…») van como notas
    .replace(/\(?<a[^>]*href="norma\.php[^"]*"[^>]*>\s*((?:Reglamentad|Adicionad|Modificad|Derogad)[oa][^<]*|Ver [^<]*)<\/a>\)?/gi, "&lt;$1&gt;")
    .replace(/Adicionado por el art\.\s*<a[^>]*href="norma\.php[^"]*"[^>]*>(\d+)<\/a>,\s*(Ley \d+ de \d{4})/gi, "&lt;Adicionado por el art. $1, $2&gt;")
    .replace(/<em>\s*\((Adicion[^<]*)\)(?:\s|&nbsp;)*<\/em>/gi, "&lt;$1&gt;")
    // anclas de numerales (99.2) y de notas, que no separan artículos
    .replace(/<a[^>]*\bname="(?!\d+">ART)[^"]*"[^>]*><\/a>/gi, "");
}

// Tablas y fórmulas que la fuente publica como imagen: se transcriben leyendo la imagen (datos/ocr/imagenes.json)
const IMAGENES = new URL("../datos/ocr/imagenes.json", import.meta.url);
const transcritas = existsSync(IMAGENES) ? JSON.parse(readFileSync(IMAGENES, "utf8")) : {};
const conImagenes = (h) =>
  h.replace(/<p class="centrado">\s*(<img[^>]*\/graficas\/[^>]*>)\s*<\/p>/gi, "<p>$1</p>").replace(/<img[^>]*\bsrc="[^"]*\/graficas\/([^"]+)"[^>]*>/gi, (m, f) => {
    const l = transcritas[f];
    return !l ? m : l.length > 1 ? l.map((x) => `</p><p>${x.replace(/>/g, "&#62;").replace(/</g, "&#60;")}`).join("") : l[0];
  });

// Quita lo que no es la norma: menús, botones, cajas editoriales y el pie de la página
export function limpiarHtml(bytes) {
  return conImagenes(leerPagina(bytes))
    .split("<!--Fin documento-->")[0]
    // algunas leyes traen pegada al final la sentencia que las revisó: no es la ley
    .split(/<a name="SENTENCIA|<p class="centrado">(?:<[^>]+>)*Corte Constitucional(?:<[^>]+>)*\s*<\/p>/i)[0]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a class="caja_vja[\s\S]*?<\/a>/gi, "")
    .replace(/<(s|strike)>([\s\S]*?)<\/(?:s|strike)>/gi, "~~$2~~")
    .replace(/<u>([\s\S]*?)<\/u>/gi, "_$1_")
    .replace(/<table[\s\S]*?<\/table>/gi, tabla)
    .replace(/<a\b[^>]*>\s*(?:Anterior|Siguiente)\s*<\/a>[\s|]*/gi, "")
    // subtítulos en negrilla sin centrar: encabezan lo que sigue, no cierran el artículo anterior
    .replace(/<p><span class="b_aj">([^<]{4,90}\.)<\/span>\s*<\/p>(?=\s*(?:<a href="[^"]*#top"|<p><span class="b_aj">\s*<a))/gi, '<p class="centrado">$1</p>')
    // conceptos de entidades que la casa editorial agrega al pie
    .replace(/<p>\s*Concepto SUPER[A-Z]+[^<]*Ficha:[^<]*<\/p>/g, "")
    .replace(/<a href="[^"]*#top"[\s\S]*?<\/a>/gi, "")
    // títulos, capítulos y firmas van centrados
    .replace(/<p class="centrado">/gi, "⟪centrado⟫<p>");
}

// HTML → texto. Las notas de la fuente vienen como &lt;…&gt; y se marcan ⟦…⟧
export const decodificar = (h) =>
  h
    .replace(/&lt;/g, "⟦")
    .replace(/&gt;/g, "⟧")
    .replace(/\r?\n/g, " ")
    .replace(/<\/p>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&([aeiouAEIOU])acute;/g, (_, v) => ACENTOS[v])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(\w+);/g, (m, e) => ENTIDADES[e] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n\s*/g, "\n")
    .trim();
