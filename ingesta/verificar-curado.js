// Comprueba que el JSON curado dice lo mismo que la fuente. Sale con error si algo difiere.
//   HTML: recorre el crudo por párrafos (curar.js lo hace por anclas) y compara las palabras en
//         orden, sin puntuación. Comparte con curar.js la limpieza del HTML (html.js).
//   PDF:  compara la transcripción con la capa de texto del propio PDF. Esa capa trae errores
//         de OCR, así que las diferencias se listan para mirarlas contra la imagen.
// Uso: npm run verificar-curado
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { archivoCrudo, CURADO, fuentes } from "./comun-ingesta.js";
import { decodificar, limpiarHtml } from "./html.js";

const palabras = (s) => s.match(/[\p{L}\p{N}]+/gu) ?? [];
const sinNota = (s) => s.replaceAll("[Nota de la fuente: ", "⟦");
const base = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
let mal = 0;

for (const norma of fuentes) {
  const curado = JSON.parse(readFileSync(`${CURADO}${norma.id}.json`, "utf8"));
  for (const a of curado.fuente.archivos) {
    const url = norma.urls.find((u) => u === a.url);
    const sha = createHash("sha256").update(readFileSync(archivoCrudo(norma, url))).digest("hex");
    if (sha !== a.sha256) { mal++; console.log(`✗ ${norma.id}: ${a.archivo} cambió desde que se curó`); }
  }

  // de un código grande solo se toman unos artículos: se compara cada uno con su bloque del crudo
  if (norma.solo) {
    const crudo = norma.urls.map((u) => palabras(decodificar(limpiarHtml(readFileSync(archivoCrudo(norma, u))))).join(" ")).join(" ");
    const bien = curado.articulos.filter((a) => crudo.includes(palabras(sinNota(`${a.encabezado} ${a.titulo} ${a.texto}`)).join(" ")));
    console.log(`${norma.id}: ${bien.length} de ${curado.articulos.length} párrafos idénticos`);
    for (const a of curado.articulos) if (!bien.includes(a)) console.log(`   distinto: ${a.id}`);
    continue;
  }
  if (norma.formato === "html") {
    // Párrafo por párrafo, sin usar las anclas: todo párrafo del cuerpo debe estar en el curado
    const textos = [
      curado.preambulo,
      ...curado.articulos.flatMap((a) => [`${a.encabezado} ${a.titulo} ${a.texto}`, ...a.seccion]),
      curado.cierre,
    ].map((t) => palabras(sinNota(t)).join(" "));
    const todo = ` ${textos.join(" | ")} `;
    let revisados = 0;
    const faltan = [];
    for (const url of norma.urls) {
      const h = limpiarHtml(readFileSync(archivoCrudo(norma, url)));
      // se compara desde el encabezado de la norma hasta su último artículo o sus firmas
      const inicio = Math.max(0, h.search(/⟪centrado⟫|<a\b[^>]*\bname="\d+[A-Z]?"/i) - 40);
      const fin = norma.hasta ? h.search(new RegExp(`<a\\b[^>]*\\bname="${norma.hasta + 1}"`, "i")) : h.search(/\*\s*\*\s*\*/);
      for (const p of h.slice(inicio, fin > 0 ? fin : undefined).split("<p").slice(1)) {
        const w = palabras(decodificar("<p" + p.split("⟪centrado⟫")[0]));
        if (w.length < 3) continue;
        revisados++;
        if (!todo.includes(` ${w.join(" ")} `)) faltan.push(w.slice(0, 14).join(" "));
      }
    }
    console.log(`${norma.id}: ${revisados - faltan.length} de ${revisados} párrafos idénticos`);
    for (const f of faltan) console.log(`   no está: ${f}…`);
  } else {
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(archivoCrudo(norma, norma.urls[0]))));
    const { text } = await extractText(pdf, { mergePages: true });
    const normal = (s) => palabras(base(s));
    const bolsa = (l) => l.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map());
    const mio = normal(curado.articulos.map((a) => a.texto).join(" ").replace(/\[\d+\]/g, " "));
    const suyo = bolsa(normal(text));
    const raras = [];
    for (const w of mio) {
      if (suyo.get(w) > 0) suyo.set(w, suyo.get(w) - 1);
      else raras.push(w);
    }
    const sobran = [...suyo].filter(([, n]) => n > 0).map(([w, n]) => (n > 1 ? `${w}×${n}` : w));
    console.log(`${norma.id}: ${mio.length - raras.length} de ${mio.length} palabras coinciden con la capa de texto del PDF`);
    console.log(`   solo en la transcripción: ${raras.join(" ")}`);
    console.log(`   solo en la capa del PDF:  ${sobran.join(" ")}`);
  }
}
process.exitCode = mal ? 1 : 0;
