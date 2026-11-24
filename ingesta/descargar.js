// Paso 1: baja a datos/crudo (no se sube a git) las normas de fuentes.json y las sentencias y
// leyes que sustentan datos/vigencia.
// Uso: npm run descargar            (no vuelve a bajar lo que ya está)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { archivoCrudo, fuentes, leerVigencia } from "./comun-ingesta.js";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const pendientes = new Map();
for (const norma of fuentes) for (const url of norma.urls) pendientes.set(archivoCrudo(norma, url), url);
for (const f of Object.values(leerVigencia().fuentes)) if (f.archivo) pendientes.set(raiz + f.archivo, f.url.split("#")[0]);

let fallos = 0;
for (const [destino, url] of pendientes) {
  if (existsSync(destino)) continue;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!r.ok) throw new Error(`respondió ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    // Un servidor puede responder 200 con una página de error: el PDF debe ser PDF
    if (destino.endsWith(".pdf") && bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("no es un PDF");
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, bytes);
    console.log(`${destino.slice(raiz.length)}: ${(bytes.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    fallos++;
    console.log(`❌ ${url}: ${e.message} ${e.cause?.message ?? ""}`);
  }
}
process.exitCode = fallos ? 1 : 0;
