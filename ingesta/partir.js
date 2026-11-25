// Parte el HTML de una norma en artículos, con sus secciones, notas y referencias a otras normas.
import { decodificar, limpiarHtml } from "./html.js";

// "ARTÍCULO 8o.", "ARTICULO 97-A.", "ARTICULO <185-A>." y "ARTÍCULO. EPÍGRAFE. <167A>"
const ARTICULO = /^ART[IÍ]CULO\s*⟦?\s*(?:\d+\s*[oº°]?)?\s*-?\s*(?:[A-Z]|\d{1,2})?\s*⟧?\s*\.\s*/i;
export const ANCLA = /^\d+(?:-?[A-Z]|-\d{1,2})?$/; // "23 PROYECTO" es un artículo que nunca llegó a ser ley
const SECCION = /^(?:LIBRO|T[IÍ]TULO|CAP[IÍ]TULO|SECCI[OÓ]N|(?:PRIMERA|SEGUNDA|TERCERA)?\s*PARTE)\b/i;
const conNotas = (t) => t.replace(/⟦([^⟦⟧]*)⟧/g, (_, n) => `[Nota de la fuente: ${n.trim()}]`).replace(/⟦/g, "<").replace(/⟧/g, ">");
const ordenar = (t) => t.replace(/[ \t]{2,}/g, " ").replace(/^ +| +$/gm, "").replace(/\n{2,}/g, "\n").trim();
// Referencias a otras normas: los enlaces de la propia fuente, más las menciones escritas sin enlace.
//   tipo "vigencia": va dentro de una nota (quién modificó o derogó). tipo "cita": la ley remite a otra.
const SENADO = "http://www.secretariasenado.gov.co/senado/basedoc/";
const MENCION = /(?:art[íi]culo\s+(\d+[A-Z]?)[ºo°]?\s+del?\s+(?:la\s+)?)?\b(Ley|Decreto|Sentencia)\s+(?:Estatutaria\s+|Ley\s+)?(?:n[úu]mero\s+|No\.?\s*)?(C\s*[-–]\s*)?(\d{1,4})\s+del?\s+(\d{4})/gi;
export function referenciasDe(html, texto) {
  const salida = new Map();
  for (const m of html.matchAll(/<a\s[^>]*href="([^"#]+\.html?)(?:#([^"]*))?"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!/^[a-z0-9_-]+\.html?$/i.test(m[1])) continue;
    const antes = html.slice(0, m.index);
    const enNota = (antes.match(/&lt;/g) ?? []).length > (antes.match(/&gt;/g) ?? []).length;
    const ancla = ANCLA.test(m[2] ?? "") ? m[2] : null;
    const contexto = decodificar(antes.slice(-400).replace(/^[^<]*>/, "") + m[3] + html.slice(m.index + m[0].length, m.index + m[0].length + 200).replace(/<[^>]*$/, ""))
      .replace(/[⟦⟧]/g, " ").replace(/\s+/g, " ").trim();
    const enlace = decodificar(m[3]).trim();
    const p = contexto.lastIndexOf(enlace, 400);
    const url = SENADO + m[1].toLowerCase() + (ancla ? `#${ancla}` : "");
    const clave = `${url} ${enNota}`;
    if (!salida.has(clave)) salida.set(clave, { tipo: enNota ? "vigencia" : "cita", url, contexto: contexto.slice(Math.max(0, p - 90), p + enlace.length + 70).trim() });
  }
  for (const m of texto.matchAll(MENCION)) {
    const [, art, clase, c, num, anio] = m;
    const n = num.padStart(4, "0");
    const url = /sentencia/i.test(clase)
      ? c ? `https://www.corteconstitucional.gov.co/relatoria/${anio}/C-${num.padStart(3, "0")}-${anio.slice(2)}.htm` : null
      : `${SENADO}${clase.toLowerCase()}_${n}_${anio}.html${art ? `#${art}` : ""}`;
    if (!url || [...salida.values()].some((r) => r.url.replace(/_pr\d+/, "") === url || (!art && r.url.split("#")[0].replace(/_pr\d+/, "") === url))) continue;
    const abierta = texto.lastIndexOf("[Nota de la fuente", m.index);
    const enNota = abierta >= 0 && !texto.slice(abierta, m.index).includes("]");
    salida.set(url, { tipo: enNota ? "vigencia" : "cita", url, contexto: texto.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40).replace(/\s+/g, " ").trim(), sin_enlace: true });
  }
  return [...salida.values()];
}
const lineas = (h) => ordenar(conNotas(decodificar(h.replaceAll("⟪centrado⟫", "\n"))));

// paginas: [{ url, bytes }] de un mismo documento, en orden
// hasta: último artículo; solo: expresión con los artículos que se toman de un código grande
// mas: otros artículos que se toman después de «hasta»
export function partirHtml(paginas, hasta, solo, mas) {
  const partes = [];
  let preambulo = "";
  let cierre = "";
  let ultimoNumero = 0;
  let seccion = []; // títulos y capítulos vigentes para los artículos que siguen
  for (const { url, bytes } of paginas) {
    const h = limpiarHtml(bytes);
    // si la página no sigue a la anterior, sus títulos tampoco
    const numeros = [...h.matchAll(/<a\b[^>]*\bname="(\d+)/gi)].map((x) => Number(x[1]));
    if (numeros.length && Math.min(...numeros) > ultimoNumero + 2) seccion = [];
    ultimoNumero = Math.max(0, ...numeros.filter((x) => x < 5000));
    const anclas = [...h.matchAll(/<a\b[^>]*\bname="([^"]+)"[^>]*>/gi)];
    const primera = anclas.find((a) => ANCLA.test(a[1]));
    // encabezado, considerandos y fórmula de expedición, antes del artículo 1
    if (!partes.length && primera && !solo) preambulo = lineas(h.slice(Math.max(0, h.indexOf("⟪centrado⟫")), primera.index));
    anclas.forEach((m, i) => {
      const bloque = h.slice(m.index, anclas[i + 1]?.index ?? h.length);
      let [cuerpoHtml, ...centrados] = bloque.split("⟪centrado⟫");
      // una ley que adiciona otra transcribe títulos centrados con artículos debajo: son su texto
      if (ANCLA.test(m[1])) {
        const ultimo = centrados.findLastIndex((c) => decodificar(c.slice(c.search(/<\/p>/i) + 4)).replace(/⟦[^⟧]*⟧/g, "").trim());
        if (ultimo >= 0) {
          cuerpoHtml += centrados.slice(0, ultimo + 1).join("\n");
          centrados = centrados.slice(ultimo + 1);
        }
      }
      const esArticulo = ANCLA.test(m[1]);
      const numero = m[1].replace(/-(?=[A-Z])/, "") /* "185-A" es 185A; "555-2" se queda así */;
      const plano = decodificar(cuerpoHtml);
      const encabezado = plano.match(ARTICULO);
      if (!esArticulo || !encabezado) {
        // ancla de título o capítulo: su nombre viene en las líneas centradas
        const nombre = lineas(bloque).replace(/\n/g, " ");
        if (SECCION.test(nombre) || /^t\d/.test(m[1])) {
          const mayor = (s) => /^(LIBRO|T[IÍ]TULO|(?:PRIMERA|SEGUNDA|TERCERA)?\s*PARTE)/i.test(s);
          seccion = mayor(nombre) ? [...(/^T[IÍ]TULO/i.test(nombre) ? seccion.filter((s) => /PARTE|LIBRO/i.test(s.slice(0, 20))) : []), nombre] : [...seccion.filter(mayor), nombre];
        }
        return;
      }
      if (hasta && parseInt(numero) > hasta && !(mas && new RegExp(mas).test(numero))) return;
      if (solo && !new RegExp(solo).test(numero)) return;
      const titulo = decodificar(bloque.slice(0, bloque.search(/<\/a>/i)))
        .slice(encabezado[0].trimEnd().length)
        .replace(/^[.\s]+|[.\s]+$/g, "");
      let cuerpo = plano.slice(encabezado[0].length);
      if (titulo && cuerpo.startsWith(titulo)) cuerpo = cuerpo.slice(titulo.length).replace(/^[.\s]+/, "");
      // a veces sigue un listado de sentencias: es de la casa editorial, no de la norma
      cuerpo = cuerpo.split(/\nSentencias de (?:control|tutela)/i)[0];
      const notas = [...cuerpo.matchAll(/⟦([^⟦⟧]*)⟧/g)].map((n) => n[1].replace(/\s+/g, " ").trim());
      // lo centrado tras el último artículo son las firmas y la promulgación
      if (!hasta && !solo) cierre = lineas(centrados.join("\n").split(/\*\s*\*\s*\*/)[0]).split(/\nCorte Constitucional\n/)[0];
      const propio = ordenar(cuerpo.replace(/⟦[^⟦⟧]*⟧/g, ""));
      partes.push({
        articulo: numero,
        encabezado: encabezado[0].trim(),
        titulo: conNotas(titulo),
        seccion,
        texto: ordenar(conNotas(cuerpo)),
        notas,
        referencias: referenciasDe(cuerpoHtml.split(/Sentencias de (?:control|tutela)/i)[0], ordenar(conNotas(cuerpo))),
        // sin texto propio vigente: la norma lo derogó o la Corte lo sacó
        derogado: propio.length < 40 && /derogad|INEXEQUIBLE/i.test(notas.join(" ")),
        url: `${url}#${m[1]}`,
      });
      // un subtítulo centrado sin ancla también es sección de lo que sigue
      const subtitulo = lineas(centrados.join("\n")).replace(/\n/g, " ");
      if (subtitulo) seccion = [...seccion, subtitulo];
    });
  }
  // "<1>" remite a una nota al pie del documento: en las notas se pone lo que dice
  const pies = {};
  for (const { bytes } of paginas) {
    const t = new TextDecoder("windows-1252").decode(bytes);
    for (const m of t.matchAll(/name="np\d+">(\d+)\.<\/a>([\s\S]*?)(?=name="np\d+"|<!--Fin documento-->)/gi)) pies[m[1]] = decodificar(m[2].split(/<a href="[^"]*#top"/i)[0]).replace(/[⟦⟧]/g, "").replace(/\s+/g, " ").trim();
  }
  for (const p of partes) {
    const resueltas = p.notas.map((n) => (/^\d+$/.test(n) && pies[n] ? `${n}: ${pies[n].slice(0, 700)}` : n));
    p.notas = resueltas.filter((n, i) => !/^\d+: /.test(n) || resueltas.indexOf(n) === i); // el mismo pie, una vez
  }
  return { preambulo, partes, cierre };
}
