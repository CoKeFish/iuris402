// Pruebas del cobro con un facilitador simulado que cuenta las liquidaciones: no mueven USDC.
// Uso: npm test
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { abrirLeyes, abrirVentas } from "./base.js";
import { cargarIndice, nombrados } from "./buscador.js";
import { RED, USDC_CONTRATO } from "./comun.js";
import { crearApp } from "./server.js";

const PAGO_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PREGUNTA = "¿Cuánto dura la garantía de un producto nuevo si no dicen nada?";
let liquidados = 0;
let valido = true;
let traductor = null; // LLM simulado
const facilitador = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: RED, extra: { areFeesSponsored: true } }],
    extensions: [],
    signers: {},
  }),
  verify: async () => (valido ? { isValid: true, payer: PAGO_A } : { isValid: false, invalidReason: "insufficient_funds", payer: PAGO_A }),
  settle: async () => ({ success: true, transaction: `hash-${++liquidados}`, network: RED, payer: PAGO_A }),
};

const archivo = join(mkdtempSync(join(tmpdir(), "leyes-")), "ventas.db");
let servidor, base, ventas;
async function encender() {
  ventas = abrirVentas(archivo);
  servidor = crearApp({ payTo: PAGO_A, facilitador, ventas, traducir: async (q) => traductor?.(q) ?? null }).listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://localhost:${servidor.address().port}`;
}
async function apagar() {
  servidor.closeAllConnections();
  await new Promise((r) => servidor.close(r));
  ventas.cerrar();
}
before(encender);
after(apagar);

const pedir = (ruta, q, firma) =>
  fetch(`${base}${ruta}?q=${encodeURIComponent(q)}`, { headers: firma ? { "PAYMENT-SIGNATURE": firma } : {} });
async function firmar(ruta, q, marca) {
  const r = await pedir(ruta, q);
  const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64"));
  const pago = { x402Version: 2, resource: req.resource, accepted: req.accepts[0], payload: { transaction: marca } };
  return Buffer.from(JSON.stringify(pago)).toString("base64");
}

test("el catálogo es gratis y dice el precio", async () => {
  const r = await fetch(base);
  assert.equal(r.status, 200);
  assert.ok((await r.json()).rutas["GET /asesoria?q="].precio);
});

test("sin pago responde 402 con USDC por contrato, monto y destinatario", async () => {
  const r = await pedir("/buscar", PREGUNTA);
  assert.equal(r.status, 402);
  const [a] = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64")).accepts;
  assert.deepEqual([a.asset, a.amount, a.payTo, a.network], [USDC_CONTRATO, "100000", PAGO_A, RED]);
});

test("una pregunta inválida responde 400, sin pedir pago", async () => {
  assert.equal((await pedir("/asesoria", "hola")).status, 400);
});

test("con pago entrega citas con texto, argumentos y fuente, y nunca el resumen", async () => {
  const antes = liquidados;
  const r = await pedir("/asesoria", PREGUNTA, await firmar("/asesoria", PREGUNTA, "a"));
  const cuerpo = await r.json();
  assert.equal(r.status, 200);
  assert.equal(liquidados, antes + 1);
  assert.ok(cuerpo.citas.every((c) => c.texto && c.fuente.url && c.fuente.sha256.length === 64 && !("resumen" in c)));
  assert.ok(cuerpo.argumentos.length);
});

test("reenviar el mismo pago devuelve lo mismo sin cobrar otra vez", async () => {
  const firma = await firmar("/buscar", PREGUNTA, "b");
  const antes = liquidados;
  const [uno, dos] = [await pedir("/buscar", PREGUNTA, firma), await pedir("/buscar", PREGUNTA, firma)];
  assert.equal(liquidados, antes + 1);
  assert.equal(await uno.text(), await dos.text());
  assert.equal(uno.headers.get("payment-response"), dos.headers.get("payment-response"));
});

test("el reintento sigue sin cobrar después de reiniciar la API", async () => {
  const firma = await firmar("/buscar", PREGUNTA, "g");
  const uno = await (await pedir("/buscar", PREGUNTA, firma)).text();
  const antes = liquidados;
  await apagar();
  await encender();
  const dos = await pedir("/buscar", PREGUNTA, firma);
  assert.equal(dos.headers.get("x-reintento"), "sin-cobro");
  assert.equal(await dos.text(), uno);
  assert.equal(liquidados, antes);
});

test("a las 24 horas se borran pregunta y respuesta, y queda el recibo", async () => {
  ventas.db.exec("UPDATE pagos SET creado = creado - 90000000");
  await pedir("/buscar", PREGUNTA, await firmar("/buscar", PREGUNTA, "h"));
  const viejos = ventas.db.prepare("SELECT * FROM pagos WHERE creado < ?").all(Date.now() - 86400000);
  assert.ok(viejos.length && viejos.every((p) => p.pregunta === null && p.respuesta === null && p.transaccion && p.recibo));
});

test("el mismo pago no sirve para leer otra pregunta gratis", async () => {
  const firma = await firmar("/buscar", PREGUNTA, "c");
  await pedir("/buscar", PREGUNTA, firma);
  const otra = await pedir("/buscar", "¿Puedo pedir que borren mis datos personales?", firma);
  assert.notEqual(otra.headers.get("x-reintento"), "sin-cobro");
});

test("sin resultados relevantes responde 404 y no cobra", async () => {
  const q = "receta de lasaña con queso y salsa boloñesa";
  const antes = liquidados;
  const r = await pedir("/buscar", q, await firmar("/buscar", q, "d"));
  assert.equal(r.status, 404);
  assert.equal(liquidados, antes);
});

test("un pago rechazado por el facilitador no entrega nada", async () => {
  valido = false;
  const r = await pedir("/buscar", PREGUNTA, await firmar("/buscar", PREGUNTA, "e"));
  valido = true;
  assert.equal(r.status, 402);
  assert.ok(!(await r.text()).includes("garantía legal"));
});

test("el retracto se entrega con la condición de la Corte y su sentencia", async () => {
  const q = "compré algo a distancia y me arrepentí, ¿en cuánto me devuelven la plata?";
  const r = await pedir("/asesoria", q, await firmar("/asesoria", q, "f"));
  const c = (await r.json()).citas.find((x) => x.cita.endsWith("1480 de 2011, art. 47"));
  const v = c.vigencia.find((x) => x.estado === "exequibilidad condicionada");
  assert.equal(v.decidido_por, "Sentencia C-192 de 2026");
  assert.match(v.condicion, /todas las modalidades/);
  assert.equal(v.fuente.sha256.length, 64);
});

test("cada referencia se puede consultar gratis, y el destino dice quién lo cita", async () => {
  const r = await (await fetch(`${base}/articulo?id=ley-1480-2011:56`)).json();
  const a18 = r.referencias.find((x) => x.id === "ley-1480-2011:18");
  assert.equal(a18.tipo, "cita");
  const d = await (await fetch(base + a18.consultar)).json();
  assert.ok(d.texto && d.fuente.sha256 && d.citado_por.some((x) => x.id === "ley-1480-2011:56"));
  const ext = r.referencias.concat(...["cst:57", "ley-1266-2008:6"].map(() => [])).find((x) => x.id?.startsWith("ext:"));
  if (ext) assert.ok((await (await fetch(base + ext.consultar)).json()).texto);
  assert.equal((await fetch(`${base}/articulo?id=no-existe:1`)).status, 404);
});

test("toda referencia tiene destino: propio, texto oficial con SHA-256 o el motivo por el que no se puede abrir", () => {
  const db = abrirLeyes();
  const malas = db.prepare(`SELECT d.ref_url FROM referencias r LEFT JOIN destinos d ON d.id = r.destino_id
    WHERE d.id IS NULL OR (d.tipo IN ('artículo', 'documento') AND (d.url IS NULL OR d.sha256 IS NULL)) OR (d.tipo = 'no consultable' AND d.motivo IS NULL)`).all();
  assert.deepEqual(malas, []);
  db.close();
});

test("un artículo nombrado por su número sale primero", () => {
  const { docs } = cargarIndice();
  const de = (q) => [...nombrados(docs, q)];
  assert.deepEqual(de("¿qué dice el artículo 20 de la Ley 820 de 2003?"), ["ley-820-2003:20"]);
  assert.deepEqual(de("según el art. 64 del CST"), ["cst:64"]);
  assert.deepEqual(de("artículo 86 de la Constitución Política"), ["cp-1991:86"]);
  assert.deepEqual(de("artículo 52 del Decreto 2591"), ["dec-2591-1991:52"]);
  assert.deepEqual(de("la Ley 820 y 20 días"), []);
});

test("si preguntan por algo que ya no rige, avisa con su sentencia y no cobra", async () => {
  const q = "¿La tutela sirve contra sentencias judiciales?";
  const antes = liquidados;
  traductor = () => ({ aplica: true, otroPais: null, formas: ["¿Procede la acción de tutela contra providencias judiciales?"] });
  const r = await pedir("/asesoria", q, await firmar("/asesoria", q, "i"));
  traductor = null;
  assert.equal(r.status, 410);
  const a = (await r.json()).avisos.find((x) => x.id === "dec-2591-1991:40");
  assert.equal(a.vigencia[0].decidido_por, "Sentencia C-543 de 1992");
  assert.match(a.vigencia[0].nota, /excepcional/);
  assert.equal(liquidados, antes);
});

test("otro país o un tema que no es derecho: 404 y no cobra", async () => {
  const q = "¿cuántos días de despido me tocan según el Estatuto de los Trabajadores?";
  const antes = liquidados;
  traductor = () => ({ aplica: false, otroPais: "España", formas: [] });
  const r = await pedir("/buscar", q, await firmar("/buscar", q, "j"));
  traductor = null;
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /España/);
  assert.equal(liquidados, antes);
});

test("la reformulación del LLM se usa para buscar y se muestra", async () => {
  const q = "el jefe me echo sin plata ni aviso";
  traductor = () => ({ aplica: true, formas: ["indemnización por terminación unilateral del contrato de trabajo sin justa causa"] });
  const r = await pedir("/buscar", q, await firmar("/buscar", q, "k"));
  traductor = null;
  const c = await r.json();
  assert.ok(c.citas.some((x) => x.cita.endsWith("art. 64")));
  assert.equal(c.entendido_como.length, 1);
});

test("los cambios de texto traen quién los hizo y por qué", async () => {
  const a = await (await fetch(`${base}/articulo?id=cst:161`)).json();
  assert.ok(a.cambios.some((c) => c.por === "Ley 2466 de 2025, art. 11" && /Reforma Laboral/.test(c.razon)));
});

test("la base no vende lo derogado ni lo que está en duda, y no admite vigencias huérfanas", () => {
  const db = abrirLeyes();
  const uno = (sql) => Object.values(db.prepare(sql).get())[0];
  assert.equal(uno("SELECT count(*) FROM articulos WHERE en_venta AND (derogado OR id = 'ley-820-2003:37')"), 0);
  assert.equal(uno("SELECT count(*) FROM articulos_fts f JOIN articulos a ON a.id = f.articulo_id WHERE NOT a.en_venta AND NOT a.aviso"), 0);
  assert.equal(uno("SELECT count(*) FROM articulos a LEFT JOIN vectores v ON v.articulo_id = a.id AND v.n = 0 WHERE a.en_venta AND v.vector IS NULL"), 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
