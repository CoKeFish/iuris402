// Paso 2: convierte cada archivo crudo en un JSON curado → datos/curado/<norma>.json
// El curado dice LO MISMO que la fuente, solo que ordenado por artículo y con su procedencia.
//   HTML: sale del propio archivo. Lo tachado en la fuente queda como ~~así~~, lo subrayado
//         como _así_ y las notas <entre ángulos> de la fuente como [Nota de la fuente: …].
//   PDF:  sale de la transcripción en datos/ocr (leída de la imagen de cada página).
// Lo único que no pasa es lo que no es la norma: menú, botones y las cajas de la casa editorial
// (jurisprudencia, concordancias). `npm run verificar-curado` comprueba que no se pierda texto.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { archivoCrudo, CURADO, fuentes, OCR } from "./comun-ingesta.js";
import { partirHtml, referenciasDe } from "./partir.js";

// En un PDF el encabezado y el cierre son partes como las demás
function seccionesDeOcr(norma) {
  const crudo = readFileSync(`${OCR}${norma.id}.txt`, "utf8").replace(/\r/g, "");
  const partes = crudo
    .split(/^=== /m)
    .slice(1)
    .map((b) => {
      const [cabeza, ...lineas] = b.split("\n");
      const [articulo, titulo, pagina] = cabeza.split("|").map((x) => x.trim());
      return {
        articulo,
        encabezado: "",
        titulo,
        seccion: [],
        texto: lineas.join("\n").trim(),
        notas: [],
        referencias: referenciasDe("", lineas.join("\n")),
        derogado: false,
        url: `${norma.urls[0]}#page=${pagina}`,
      };
    });
  return { preambulo: "", partes, cierre: "" };
}

// Enlaces de la fuente que contradicen su propio texto (leídos uno por uno). Se corrige el destino y
// se deja constancia de lo que decía la fuente; si la fuente cambia y ya no aplica, se avisa.
const correcciones = JSON.parse(readFileSync(new URL("./correcciones.json", import.meta.url), "utf8"));
function corregir(articulos) {
  for (const c of correcciones) {
    const a = articulos.find((x) => x.id === c.articulo);
    if (!a) continue;
    const r = a.referencias.find((x) => x.url === c.enlace_de_la_fuente);
    if (!r) {
      console.log(`⚠ corrección que ya no aplica: ${c.articulo}`);
      continue;
    }
    a.referencias = a.referencias.filter((x) => x === r || x.url !== c.correcto);
    Object.assign(r, { url: c.correcto, enlace_de_la_fuente: c.enlace_de_la_fuente, motivo_correccion: c.motivo });
  }
  return articulos;
}

mkdirSync(CURADO, { recursive: true });
for (const norma of fuentes) {
  const faltan = norma.urls.filter((u) => !existsSync(archivoCrudo(norma, u)));
  if (faltan.length) {
    console.log(`⚠ ${norma.id}: falta descargar ${faltan.length} archivo(s)`);
    continue;
  }
  const pdf = norma.formato === "pdf";
  if (pdf && !existsSync(`${OCR}${norma.id}.txt`)) {
    console.log(`⚠ ${norma.id}: PDF sin transcribir, no entra. Falta datos/ocr/${norma.id}.txt`);
    continue;
  }
  const { preambulo, partes, cierre } = pdf
    ? seccionesDeOcr(norma)
    : partirHtml(norma.urls.map((url) => ({ url, bytes: readFileSync(archivoCrudo(norma, url)) })), norma.hasta, norma.solo, norma.mas);
  const unicas = [...new Map(partes.map((p) => [p.articulo, p])).values()];
  if (unicas.length !== partes.length) throw new Error(`${norma.id}: hay artículos repetidos`);
  const curado = {
    id: norma.id,
    tipo: norma.tipo,
    nombre: norma.nombre,
    // de dónde viene cada archivo crudo y cómo comprobar que es el mismo
    fuente: {
      entidad: norma.entidad,
      metodo: pdf ? "transcripción de la imagen de cada página, hecha por Claude" : norma.imagenes ? "extracción del HTML; tablas y fórmulas en imagen, transcritas por Claude" : "extracción del HTML",
      archivos: norma.urls.map((url) => {
        const ruta = archivoCrudo(norma, url);
        return {
          url,
          archivo: `datos/crudo/${ruta.split(/[\\/]/).pop()}`,
          formato: norma.formato,
          sha256: createHash("sha256").update(readFileSync(ruta)).digest("hex"),
          descargado: statSync(ruta).mtime.toLocaleDateString("sv-SE"),
        };
      }),
    },
    preambulo,
    articulos: corregir(unicas.map((p) => ({ id: `${norma.id}:${p.articulo}`, ...p }))),
    cierre,
  };
  writeFileSync(`${CURADO}${norma.id}.json`, JSON.stringify(curado, null, 1) + "\n");
  console.log(`${norma.id}: ${unicas.length} partes`);
}
