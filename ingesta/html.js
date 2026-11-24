// Lectura del HTML de la Secretaría del Senado.
const ENTIDADES = {
  nbsp: " ", amp: "&", quot: '"', ordm: "º", ordf: "ª", deg: "°", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", iexcl: "¡",
  iquest: "¿", sect: "§", uuml: "ü", Uuml: "Ü", ntilde: "ñ", Ntilde: "Ñ", bull: "•",
  hellip: "…", frac12: "½", frac14: "¼", middot: "·", shy: "",
};
const ACENTOS = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };

// Quita lo que no es la norma: menús, botones, cajas editoriales y el pie de la página
export function limpiarHtml(bytes) {
  return new TextDecoder("windows-1252")
    .decode(bytes)
    .split("<!--Fin documento-->")[0]
    // algunas leyes traen pegada al final la sentencia que las revisó: no es la ley
    .split(/<a name="SENTENCIA|<p class="centrado">(?:<[^>]+>)*Corte Constitucional(?:<[^>]+>)*\s*<\/p>/i)[0]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a class="caja_vja[\s\S]*?<\/a>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, "")
    .replace(/<a href="[^"]*#top"[\s\S]*?<\/a>/gi, "")
    .replace(/<a\b[^>]*>\s*(?:Anterior|Siguiente)\s*<\/a>[\s|]*/gi, "")
    .replace(/<(s|strike)>([\s\S]*?)<\/(?:s|strike)>/gi, "~~$2~~")
    .replace(/<u>([\s\S]*?)<\/u>/gi, "_$1_")
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
