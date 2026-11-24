// Paso 3: hace consultable cada referencia de una norma a otra → datos/citados.json
//   - Si apunta a un artículo que ya tenemos, se enlaza a él.
//   - Si apunta afuera, se baja el documento oficial (datos/crudo/citados), se comprueba que el
//     artículo exista allí y se guarda su texto tal cual, con URL y SHA-256.
//   - Si el Senado no tiene esa norma (leyes viejas, decretos), se busca en Función Pública.
//   - Si no se puede abrir, queda anotado con el motivo: no se inventa el destino.
// Uso: npm run citar            (no vuelve a bajar lo que ya está)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { CITADOS, CRUDO, CURADO, leerVigencia } from "./comun-ingesta.js";
import { decodificar } from "./html.js";
import { ANCLA, partirHtml } from "./partir.js";

const CARPETA = `${CRUDO}citados/`;
const SENADO = "http://www.secretariasenado.gov.co/senado/basedoc/";
mkdirSync(CARPETA, { recursive: true });
const documento = (url) => url.split("#")[0].split("/").pop();
const raizDoc = (doc) => doc.replace(/_pr\d+(?=\.html?$)/, "");

// Lo que ya tenemos: documento + número de artículo → id
const nuestros = new Map();
const docsPropios = new Map();
const referencias = [];
for (const f of readdirSync(CURADO)) {
  const norma = JSON.parse(readFileSync(CURADO + f, "utf8"));
  for (const a of norma.articulos) {
    if (norma.fuente.archivos[0].formato === "html") nuestros.set(`${raizDoc(documento(a.url))}#${a.articulo}`, a.id);
    for (const r of a.referencias) referencias.push({ origen: a.id, ...r });
  }
  for (const u of norma.fuente.archivos) docsPropios.set(raizDoc(documento(u.url)), norma.id);
}

// El Senado también aloja sentencias: se prefiere la relatoría de la Corte
function destinoOficial(url) {
  const m = documento(url).match(/^c-(\d+)_(\d{4})\.html$/i);
  return m ? `https://www.corteconstitucional.gov.co/relatoria/${m[2]}/C-${m[1].padStart(3, "0")}-${m[2].slice(2)}.htm` : url;
}

// Normas que el Senado no tiene y que Función Pública no encuentra por número
const ALTERNAS = { "decreto_2184_2012.html": { url: "https://normativa.colpensiones.gov.co/colpens/docs/decreto_2184_2012.htm", entidad: "Colpensiones (normograma)", nombre: "Decreto 2184 de 2012" },
  "decreto_1074_2015.html": { url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=76608", entidad: "Función Pública", nombre: "Decreto 1074 de 2015" } };
const bajados = new Map();
async function bajar(url, nombre = documento(url)) {
  const limpio = url.split("#")[0];
  if (bajados.has(limpio)) return bajados.get(limpio);
  const promesa = (async () => {
    const archivo = `${CARPETA}${nombre}`;
    if (!existsSync(archivo)) {
      let r;
      try {
        r = await fetch(limpio, { signal: AbortSignal.timeout(60_000) });
      } catch (e) {
        return { error: `no responde (${e.cause?.code ?? e.name})` };
      }
      if (!r.ok) return { error: `responde ${r.status}` };
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length < 3000) return { error: "página vacía" };
      writeFileSync(archivo, bytes);
      await new Promise((ok) => setTimeout(ok, 250)); // sin prisa con el servidor oficial
    }
    const bytes = readFileSync(archivo);
    return { bytes, url: limpio, archivo: `datos/crudo/citados/${nombre}`, sha256: createHash("sha256").update(bytes).digest("hex") };
  })();
  bajados.set(limpio, promesa);
  return promesa;
}
const tituloDe = (bytes) => {
  const t = new TextDecoder("windows-1252").decode(bytes.subarray(0, 200_000));
  return t.match(/<title>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g, " ").trim() ?? "";
};

// Respaldo: el gestor normativo de Función Pública. Solo si el título coincide exactamente.
const GESTOR = "https://www.funcionpublica.gov.co/";
const gestorIds = new Map();
async function enFuncionPublica(doc) {
  const m = doc.match(/^(ley|decreto)_(\d+)_(\d{4})\.html$/i);
  if (!m) return null;
  const nombre = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${Number(m[2])} de ${m[3]}`;
  if (!gestorIds.has(doc)) {
    gestorIds.set(doc, (async () => {
      const q = `${GESTOR}dafpIndexerBGN/norma/index?find=FindNext&query=&filtroTipoDocumento=&filtroNumero=${Number(m[2])}&filtroAnio=${m[3]}&filtroEntidad=&filtroTema=&filtroSubtema=`;
      const r = await fetch(q, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!r?.ok) return null;
      const hits = [...(await r.text()).matchAll(/norma\.php\?i=(\d+)"[^>]*>\s*([^<]+?)\s*</g)].filter((h) => h[2].replace(/\s+/g, " ").startsWith(nombre + " ") && /Nivel Nacional/.test(h[2]));
      return hits.length === 1 ? hits[0][1] : null;
    })());
  }
  const id = await gestorIds.get(doc);
  if (!id) return null;
  const d = await bajar(`${GESTOR}eva/gestornormativo/norma.php?i=${id}`, `fp_${doc}`);
  return d.error ? null : { ...d, nombre };
}
function articuloDeGestor(bytes, numero) {
  const t = decodificar(new TextDecoder("utf-8").decode(bytes).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<(?:div|tr|li|h\d)\b/gi, "<br><$&")).replace(/[⟦⟧]/g, "");
  // títulos en mayúscula; si el documento no los usa así, en minúscula
  const clase = /\nART[IÍ]CULO\s+\d/.test(t) ? "ART[IÍ]CULO" : "Art[íi]culo";
  const n = parseInt(numero);
  const inicios = [...t.matchAll(new RegExp("\\n" + clase + "\\s+" + numero + "(?![0-9A-Za-z]*[0-9])", "g"))].map((m) => m.index);
  if (inicios.length !== 1) return null; // si sale en dos sitios no se adivina cuál es
  // termina donde empieza el siguiente: así no se corta en los artículos que cita o transcribe
  const fin = t.slice(inicios[0] + 5).search(new RegExp("\\n" + clase + "\\s+" + (n + 1) + "(?![0-9])"));
  if (fin < 0) return null;
  const texto = t.slice(inicios[0], inicios[0] + 5 + fin).trim();
  return texto.length < 20_000 ? texto : null;
}

// "ley_0100_1993_pr001.html#36" → "Ley 100 de 1993, art. 36"
const CODIGOS = {
  constitucion_politica_1991: "Constitución Política", codigo_civil: "Código Civil", codigo_penal: "Código Penal", codigo_comercio: "Código de Comercio",
  codigo_procedimiento_civil: "Código de Procedimiento Civil", codigo_sustantivo_trabajo: "Código Sustantivo del Trabajo",
  codigo_procedimental_laboral: "Código Procesal del Trabajo", codigo_contencioso_administrativo: "Código Contencioso Administrativo", estatuto_tributario: "Estatuto Tributario",
};
function nombrar(url) {
  const [base, ancla] = url.split("#");
  const doc = raizDoc(documento(base)).replace(/\.html?$/, "");
  const art = ancla && ancla !== "0" ? ", art. " + ancla.replace(/o$/, "") : "";
  if (CODIGOS[doc]) return CODIGOS[doc] + art;
  let m = doc.match(/^c-(\d+)[-_](\d+)$/i);
  if (m) return "Sentencia C-" + Number(m[1]) + " de " + (m[2].length === 2 ? (Number(m[2]) > 90 ? "19" : "20") + m[2] : m[2]);
  m = doc.match(/^([a-z_]+?)_(\d+)_(\d{4})$/);
  if (!m) return doc.replaceAll("_", " ") + art;
  const clase = m[1].replaceAll("_", " ");
  return clase[0].toUpperCase() + clase.slice(1) + " " + Number(m[2]) + " de " + m[3] + art;
}

async function resolver(url) {
  let [base, ancla] = url.split("#");
  if (ancla === "0") ancla = undefined; // ancla al inicio del documento
  const doc = documento(base);
  const propio = ancla && nuestros.get(`${raizDoc(doc)}#${ancla.replace("-", "")}`);
  if (propio) return { tipo: "propio", articulo: propio };
  if (!ancla && docsPropios.has(raizDoc(doc))) return { tipo: "norma propia", norma: docsPropios.get(raizDoc(doc)) };
  const oficial = destinoOficial(url);
  const d = await bajar(oficial);
  const fp = d.error && oficial.startsWith(SENADO) ? await enFuncionPublica(raizDoc(doc)) : null;
  if (fp) {
    const texto = ancla && articuloDeGestor(fp.bytes, ancla.replace(/o$/, ""));
    const suyo = { url: fp.url, archivo: fp.archivo, sha256: fp.sha256, documento: fp.nombre, entidad: "Función Pública" };
    return texto ? { tipo: "artículo", ...suyo, encabezado: `Artículo ${ancla}`, titulo: "", texto, notas: [] } : { tipo: "documento", ...suyo };
  }
  const otra = d.error && ALTERNAS[raizDoc(doc)];
  if (otra) {
    const x = await bajar(otra.url, `alt_${raizDoc(doc)}`);
    const a = ancla && !x.error && partirHtml([{ url: otra.url, bytes: x.bytes }]).partes.find((y) => y.articulo === ancla);
    if (!x.error) {
      const suyo = { url: otra.url, archivo: x.archivo, sha256: x.sha256, documento: otra.nombre, entidad: otra.entidad };
      return a ? { tipo: "artículo", ...suyo, url: a.url, encabezado: a.encabezado, titulo: a.titulo, texto: a.texto, notas: a.notas } : { tipo: "documento", ...suyo };
    }
  }
  if (d.error) return { tipo: "no consultable", motivo: d.error, url: oficial };
  const comun = { url: oficial, archivo: d.archivo, sha256: d.sha256, documento: tituloDe(d.bytes) };
  if (!ancla || !ANCLA.test(ancla) || !oficial.startsWith(SENADO)) return { tipo: "documento", ...comun };
  // el artículo puede estar en otra página del mismo documento
  const paginas = [base];
  const texto = new TextDecoder("windows-1252").decode(d.bytes);
  if (!new RegExp(`name="${ancla}"`, "i").test(texto)) {
    const raiz = raizDoc(doc).replace(".html", "");
    const n = Math.max(0, ...[...texto.matchAll(new RegExp(`${raiz}_pr(\\d+)\\.html`, "g"))].map((m) => Number(m[1])));
    for (let i = 1; i <= Math.min(n, 30); i++) paginas.push(`${SENADO}${raiz}_pr${String(i).padStart(3, "0")}.html`);
  }
  for (const p of paginas) {
    const x = await bajar(p);
    if (x.error) continue;
    const a = partirHtml([{ url: p, bytes: x.bytes }]).partes.find((y) => y.articulo === ancla.replace("-", ""));
    if (a) return { tipo: "artículo", ...comun, url: a.url, archivo: x.archivo, sha256: x.sha256, encabezado: a.encabezado, titulo: a.titulo, texto: a.texto, notas: a.notas };
  }
  return { tipo: "documento", ...comun, motivo: `documento accesible; no se identificó el artículo ${ancla}` };
}

const urls = [...new Set(referencias.map((r) => r.url))].sort();
// La primera página de cada norma trae su objeto ("Por la cual…"): cambios.js la usa como razón
const portadas = [...urls, ...Object.values(leerVigencia().fuentes).map((f) => f.url ?? "")].filter((u) => u.startsWith(SENADO)).map((u) => SENADO + raizDoc(documento(u)));
const destinos = {};
let siguiente = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (siguiente < urls.length) {
      const u = urls[siguiente++];
      destinos[u] = { cita: nombrar(u), ...(await resolver(u)) };
    }
  }),
);
for (const u of new Set(portadas)) if (!docsPropios.has(documento(u))) await bajar(u);
writeFileSync(CITADOS, "{\n" + urls.map((u) => ` ${JSON.stringify(u)}: ${JSON.stringify(destinos[u])}`).join(",\n") + "\n}\n");
const cuenta = Object.groupBy(urls, (u) => destinos[u].tipo);
console.log(`${referencias.length} referencias a ${urls.length} destinos`);
for (const [t, l] of Object.entries(cuenta)) console.log(`  ${t}: ${l.length}`);
for (const u of urls) if (destinos[u].motivo) console.log(`  ⚠ ${u}: ${destinos[u].motivo}`);
