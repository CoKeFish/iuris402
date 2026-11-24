// Paso 4: quién cambió cada artículo, con qué texto y para qué → datos/cambios.json
// Lee las notas de la fuente ("Inciso modificado por el artículo 3 de la Ley 2439 de 2024") y las
// une con el texto de la norma que hizo el cambio y con el objeto que esa norma declara
// ("Por medio de la cual…"), que es la razón que da la propia ley. Todo literal.
// También anota el objeto de las leyes que derogan (datos/vigencia/decisiones.json).
// Uso: npm run cambios   (después de npm run citar)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CITADOS, CRUDO, CURADO, DECISIONES } from "./comun-ingesta.js";
import { decodificar } from "./html.js";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const leer = (r) => JSON.parse(readFileSync(r, "utf8"));
const citados = leer(CITADOS);
const porCita = new Map(Object.values(citados).map((d) => [d.cita.toLowerCase(), d]));
const propias = new Map();
const articulos = new Map();
for (const f of readdirSync(CURADO)) {
  const n = leer(CURADO + f);
  propias.set(n.fuente.archivos[0].url.split("/").pop().replace(/(_pr\d+)?\.html.*$/, ""), n);
  for (const a of n.articulos) articulos.set(a.id, a);
}

function textoDe(archivo) {
  const bytes = readFileSync(archivo);
  const utf8 = /charset=["']?utf-8/i.test(bytes.subarray(0, 3000).toString("latin1"));
  return decodificar(new TextDecoder(utf8 ? "utf-8" : "windows-1252").decode(bytes).replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")).replace(/[⟦⟧]/g, "");
}
// El objeto que declara la norma en su encabezado
const OBJETO = /(?:^|\n)\s*[“"']?((?:Por|POR)\s+(?:(?:medio|MEDIO)\s+(?:de\s+la|del|DE\s+LA|DEL)\s+(?:cual|CUAL)|(?:la|el|LA|EL)\s+(?:cual|CUAL)|(?:las|los)\s+cuales)[^\n]{15,600})/;
const objetos = new Map();
function objetoDe(doc) {
  if (objetos.has(doc)) return objetos.get(doc);
  let r = null;
  const propia = propias.get(doc);
  const m = propia?.preambulo.match(OBJETO);
  if (m) r = { texto: m[1].trim(), url: propia.fuente.archivos[0].url };
  else {
    for (const c of [`citados/${doc}.html`, `citados/fp_${doc}.html`, `citados/alt_${doc}.html`, `vigencia/${doc}.html`]) {
      if (!existsSync(CRUDO + c)) continue;
      const x = textoDe(CRUDO + c).slice(0, 12_000).match(OBJETO);
      if (x) {
        r = { texto: x[1].replace(/\s+/g, " ").trim(), archivo: `datos/crudo/${c}` };
        break;
      }
    }
  }
  objetos.set(doc, r);
  return r;
}

const CAMBIO = /^(.*?)\b(modificad|adicionad|subrogad|sustituid|corregid|renumerad|suprimid|interpretad)[oa]s?\b.*?\bpor\s+(?:el\s+|los\s+)?(.*)$/i;
const NORMA = /(?:art[íi]culos?\s+(\d+[A-Z]?)\s*[oº°]?\.?\s+(?:del?|de\s+la)\s+)?(?:la\s+)?(Ley|Decreto|Acto\s+Legislativo)(?:[\s-]+Ley)?\s+(?:No\.?\s*|n[úu]mero\s+)?(\d+)\s+de\s+(\d{4})/i;
const VERBO = { modificad: "modificado", adicionad: "adicionado", subrogad: "subrogado", sustituid: "sustituido", corregid: "corregido", renumerad: "renumerado", suprimid: "suprimido", interpretad: "interpretado" };
const cambios = [];
const sinNorma = [];
for (const [id, a] of articulos) {
  for (const nota of a.notas) {
    const m = nota.match(CAMBIO);
    if (!m) continue;
    const n = m[3].match(NORMA);
    if (!n) {
      sinNorma.push(`${id}: ${nota.slice(0, 100)}`);
      continue;
    }
    const [, art, clase, num, anio] = n;
    const nombre = `${clase.replace(/\s+/g, " ")} ${Number(num)} de ${anio}`;
    const cita = art ? `${nombre}, art. ${art}` : nombre;
    const doc = `${clase.toLowerCase().replace(/\s+/g, "_")}_${clase.toLowerCase().startsWith("acto") ? num.padStart(2, "0") : num.padStart(4, "0")}_${anio}`;
    const d = porCita.get(cita.toLowerCase());
    const objeto = objetoDe(doc);
    const propio = d?.articulo ? articulos.get(d.articulo) : null;
    cambios.push({
      articulo: id,
      alcance: m[1].trim() || "Artículo",
      cambio: VERBO[m[2].toLowerCase()],
      por: cita,
      nota,
      destino: d ? Object.keys(citados).find((u) => citados[u] === d) : null,
      texto_del_cambio: propio?.texto ?? d?.texto ?? null,
      url: propio?.url ?? d?.url ?? null,
      razon: objeto?.texto ?? null,
    });
  }
}
writeFileSync(raiz + "datos/cambios.json", "[\n" + cambios.map((c) => " " + JSON.stringify(c)).join(",\n") + "\n]\n");

const dec = leer(DECISIONES);
for (const d of Object.values(dec)) {
  if (d.tipo === "sentencia" || !d.archivo) continue;
  const doc = d.archivo.split("/").pop().replace(/(_pr\d+)?\.(html?|txt)$/, "");
  const o = objetoDe(doc);
  if (o) d.objeto = o.texto;
}
writeFileSync(DECISIONES, "{\n" + Object.entries(dec).map(([k, f]) => ` ${JSON.stringify(k)}: ${JSON.stringify(f)}`).join(",\n") + "\n}\n");

console.log(`${cambios.length} cambios: con el texto de la norma que cambió ${cambios.filter((c) => c.texto_del_cambio).length}, con razón ${cambios.filter((c) => c.razon).length}`);
const leyes = Object.entries(dec).filter(([, d]) => d.tipo !== "sentencia");
console.log(`leyes que derogan o corrigen: ${leyes.length}, con objeto ${leyes.filter(([, d]) => d.objeto).length}; sin objeto: ${leyes.filter(([, d]) => !d.objeto).map(([k]) => k).join(" ")}`);
console.log("sin razón:", [...new Set(cambios.filter((c) => !c.razon).map((c) => c.por.replace(/, art.*/, "")))].join(" · "));
for (const s of sinNorma) console.log("nota sin norma clara:", s);
