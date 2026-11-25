// Pruebas del cobro con un facilitador simulado que cuenta las liquidaciones: no mueven USDC.
// Uso: npm test
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { abrirLeyes, abrirVentas } from "./base.js";
import { cargarIndice, nombrados } from "./buscador.js";
import { PRECIO_ASESORIA, RED, USDC_CONTRATO } from "./comun.js";
import { interpretarEleccion } from "./elegir.js";
import { conRelevo } from "./llm.js";
import { interpretar } from "./reformular.js";
import { crearApp } from "./server.js";

const PAGO_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PREGUNTA = "¿Cuánto dura la garantía de un producto nuevo si no dicen nada?";
let liquidados = 0;
let valido = true;
let traductor = null; // LLM simulado que reformula
let selector = null; // LLM simulado que elige
let enRed = { estado: "pendiente" }; // lo que la red simulada dice de un pago
let liquidar = null; // respuesta de una liquidación que falla
const usados = new Set(); // en Stellar una firma liquidada no sirve otra vez
const marca = (pago) => pago.payload?.transaction;
const facilitador = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: RED, extra: { areFeesSponsored: true } }],
    extensions: [],
    signers: {},
  }),
  verify: async (pago) => {
    if (!valido) return { isValid: false, invalidReason: "insufficient_funds", payer: PAGO_A };
    if (usados.has(marca(pago))) return { isValid: false, invalidReason: "invalid_exact_stellar_payload_simulation_failed", payer: PAGO_A };
    return { isValid: true, payer: PAGO_A };
  },
  settle: async (pago) => {
    if (liquidar) return liquidar();
    usados.add(marca(pago));
    return { success: true, transaction: `hash-${++liquidados}`, network: RED, payer: PAGO_A };
  },
};

const archivo = join(mkdtempSync(join(tmpdir(), "leyes-")), "ventas.db");
let servidor, base, ventas;
async function encender() {
  ventas = abrirVentas(archivo);
  servidor = crearApp({ payTo: PAGO_A, facilitador, ventas, traducir: async (q) => traductor?.(q), escoger: async (...a) => selector?.(...a), rastrear: async () => enRed }).listen(0);
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
  assert.equal(otra.status, 402);
  assert.ok(!(await otra.text()).includes("datos personales"));
});

test("dos envíos simultáneos del mismo pago: un solo cobro y la misma respuesta", async () => {
  const firma = await firmar("/buscar", PREGUNTA, "simultaneo");
  const antes = liquidados;
  const [uno, dos] = await Promise.all([pedir("/buscar", PREGUNTA, firma), pedir("/buscar", PREGUNTA, firma)]);
  assert.deepEqual([uno.status, dos.status], [200, 200]);
  assert.equal(await uno.text(), await dos.text());
  assert.equal(liquidados, antes + 1);
});

test("una firma enviada a la vez con dos preguntas paga una sola, aunque se reenvíen", async () => {
  const otra = "¿Puedo pedir que borren mis datos personales?";
  const firma = await firmar("/buscar", PREGUNTA, "dos-preguntas");
  // otra escritura del mismo pago: cambia el encabezado, no la firma
  const copia = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(firma, "base64")), null, 1)).toString("base64");
  const antes = liquidados;
  const real = facilitador.verify;
  facilitador.verify = async () => ({ isValid: true, payer: PAGO_A }); // el nonce aún no se ha gastado
  liquidar = async () =>
    liquidados > antes
      ? { success: false, transaction: "", network: RED, payer: PAGO_A, errorReason: "nonce" }
      : { success: true, transaction: `hash-${++liquidados}`, network: RED, payer: PAGO_A };
  const r = await Promise.all([pedir("/buscar", PREGUNTA, firma), pedir("/buscar", otra, copia)]);
  enRed = { estado: "cobrado", hash: `hash-${liquidados}` };
  const reenvios = [await pedir("/buscar", PREGUNTA, firma), await pedir("/buscar", otra, copia)];
  [liquidar, enRed, facilitador.verify] = [null, { estado: "pendiente" }, real];
  assert.equal(r.filter((x) => x.status === 200).length, 1);
  assert.deepEqual(reenvios.map((x) => x.status).sort(), [200, 409]);
  assert.equal(liquidados, antes + 1);
});

test("si la API se cae mientras liquida, la respuesta ya quedó guardada y se entrega si se cobró", async () => {
  const firma = await firmar("/buscar", PREGUNTA, "apagon");
  let cortar;
  const llego = new Promise((r) => {
    liquidar = () => (r(), new Promise((ok) => (cortar = ok)));
  });
  const perdida = pedir("/buscar", PREGUNTA, firma).catch(() => null);
  await llego;
  await apagar();
  await encender();
  liquidar = null;
  enRed = { estado: "cobrado", hash: "hash-apagon" };
  const antes = liquidados;
  const r = await pedir("/buscar", PREGUNTA, firma);
  enRed = { estado: "pendiente" };
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-reintento"), "sin-cobro");
  assert.equal(liquidados, antes);
  assert.ok((await r.json()).citas.length);
  cortar({ success: false, transaction: "", network: RED, errorReason: "apagón" });
  await perdida;
});

test("un pago ilegible, por menos monto o para otra cuenta no llega a liquidarse ni entrega nada", async () => {
  const antes = liquidados;
  const pago = JSON.parse(Buffer.from(await firmar("/buscar", PREGUNTA, "alterado"), "base64"));
  const con = (cambio) => Buffer.from(JSON.stringify({ ...pago, accepted: { ...pago.accepted, ...cambio } })).toString("base64");
  for (const f of ["no-es-un-pago", con({ amount: "1" }), con({ payTo: "GDT5GFJYQW6LTJ7QGZIBURBV3DRLL37DOMT7TRLOSGO7KHFKD424DAU2" }), con({ network: "stellar:pubnet" })]) {
    const r = await pedir("/buscar", PREGUNTA, f);
    assert.equal(r.status, 402);
    assert.ok(!(await r.text()).includes("garantía legal"));
  }
  assert.equal(liquidados, antes);
});

test("liquidación en duda: no entrega hasta que la red confirma, y entonces no cobra otra vez", async () => {
  const firma = await firmar("/buscar", PREGUNTA, "duda");
  const antes = liquidados;
  liquidar = async () => ({ success: false, transaction: "hash-duda", network: RED, payer: PAGO_A, errorReason: "settle_exact_stellar_transaction_failed" });
  const uno = await pedir("/buscar", PREGUNTA, firma);
  assert.equal(uno.status, 402);
  assert.ok(!(await uno.text()).includes("garantía legal"));
  const dos = await pedir("/buscar", PREGUNTA, firma);
  assert.equal(dos.status, 503);
  assert.equal((await dos.json()).transaccion, "hash-duda");
  await apagar(); // y aunque la API se reinicie
  await encender();
  enRed = { estado: "cobrado", hash: "hash-duda" };
  liquidar = null;
  const tres = await pedir("/buscar", PREGUNTA, firma);
  enRed = { estado: "pendiente" };
  assert.equal(tres.status, 200);
  assert.equal(JSON.parse(Buffer.from(tres.headers.get("payment-response"), "base64")).transaction, "hash-duda");
  assert.ok((await tres.json()).citas.length);
  assert.equal((await pedir("/buscar", PREGUNTA, firma)).headers.get("x-reintento"), "sin-cobro");
  assert.equal(liquidados, antes);
});

test("el facilitador se cae al liquidar: si el pago quedó en la red se entrega, y si venció se vuelve a pedir", async () => {
  const antes = liquidados;
  const [a, b] = [await firmar("/buscar", PREGUNTA, "caida-a"), await firmar("/buscar", PREGUNTA, "caida-b")];
  liquidar = async () => { throw new Error("facilitador caído"); };
  for (const f of [a, b]) assert.ok((await pedir("/buscar", PREGUNTA, f)).status >= 400);
  enRed = { estado: "cobrado", hash: "hash-caida" };
  assert.equal((await pedir("/buscar", PREGUNTA, a)).status, 200);
  enRed = { estado: "vencido" };
  usados.add("caida-b");
  const r = await pedir("/buscar", PREGUNTA, b);
  [liquidar, enRed] = [null, { estado: "pendiente" }];
  assert.equal(r.status, 402);
  assert.ok(r.headers.get("payment-required"));
  assert.equal(liquidados, antes);
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
  assert.deepEqual(de("la Ley 820 de 2003, en su artículo 20"), ["ley-820-2003:20"]);
  assert.deepEqual(de("los artículos 8 y 47 del Estatuto del Consumidor"), ["ley-1480-2011:8", "ley-1480-2011:47"].filter((x) => docs.some((d) => d.id === x)));
  assert.deepEqual(de("el art. 52 del Decreto 2591 y el artículo 20 de la Ley 820"), ["dec-2591-1991:52", "ley-820-2003:20"]);
  assert.deepEqual(de("Según la Ley 820 de 2003 en su art. 20 y el Decreto 2591 de 1991 art. 52"), ["ley-820-2003:20", "dec-2591-1991:52"]);
  assert.deepEqual(de("artículos 18 a 20 de la Ley 820 de 2003").at(-1), "ley-820-2003:20");
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

test("lo que elige el LLM es lo que se entrega, y si nada resuelve no se cobra", async () => {
  const q = "¿En cuánto me devuelven la plata si me arrepiento de una compra por internet?";
  const antes = liquidados;
  selector = (_, __, c) => ({ directos: c.filter((d) => d.id === "ley-1480-2011:47"), complementarios: c.filter((d) => d.id === "ley-1480-2011:56").slice(0, 1), sinVigencia: [] });
  const c = await (await pedir("/asesoria", q, await firmar("/asesoria", q, "l"))).json();
  assert.deepEqual([c.citas[0].cita, c.citas[0].relevancia], ["Ley 1480 de 2011, art. 47", "directa"]);
  assert.equal(liquidados, antes + 1);
  selector = () => ({ directos: [], complementarios: [], sinVigencia: [] });
  const r = await pedir("/asesoria", `${q} `, await firmar("/asesoria", `${q} `, "m"));
  selector = null;
  assert.equal(r.status, 404);
  assert.equal(liquidados, antes + 1);
});

test("la elección del LLM solo acepta códigos de la lista y no vende lo que no rige", () => {
  const l = [{ id: "a", aviso: false }, { id: "b", aviso: true }];
  const ids = (e) => [e.directos, e.complementarios, e.sinVigencia].map((x) => x.map((d) => d.id).join());
  assert.deepEqual(ids(interpretarEleccion({ directos: ["K1", "K2", "K9"], complementarios: ["K1"] }, l)), ["a", "", "b"]);
  assert.equal(interpretarEleccion({ directos: ["20", "K7"] }, l), null);
  assert.equal(interpretarEleccion(null, l), null);
});

test("si el LLM configurado falla no se responde ni se cobra, y HEAD tampoco cobra", async () => {
  const q = "¿Cuánto dura la garantía de un producto nuevo usado?";
  const antes = liquidados;
  selector = () => null;
  assert.equal((await pedir("/asesoria", q, await firmar("/asesoria", q, "n"))).status, 503);
  selector = null;
  traductor = () => null;
  assert.equal((await pedir("/buscar", q, await firmar("/buscar", q, "o"))).status, 503);
  traductor = null;
  const h = await fetch(`${base}/buscar?q=${encodeURIComponent(q)}`, { method: "HEAD", headers: { "PAYMENT-SIGNATURE": await firmar("/buscar", q, "p") } });
  assert.equal(h.status, 405);
  assert.equal(liquidados, antes);
});

test("si el LLM se queda pegado o falla, el relevo responde y el que sobra se corta", async () => {
  const pegado = (senal) => new Promise((ok) => senal.addEventListener("abort", () => ok(null)));
  let n = 0;
  assert.equal(await conRelevo((s) => (n++ ? Promise.resolve("b") : pegado(s)), 5), "b");
  n = 0;
  assert.equal(await conRelevo(async () => (n++ ? "b" : null), 1000), "b");
  assert.equal(await conRelevo(async () => null, 5), null);
});

test("el precio y la ruta de cada venta quedan registrados", async () => {
  const q = "¿Cuánto dura la garantía legal de un producto?";
  await pedir("/asesoria", q, await firmar("/asesoria", q, "r"));
  const v = ventas.db.prepare("SELECT ruta, precio FROM pagos ORDER BY creado DESC LIMIT 1").get();
  assert.deepEqual([v.ruta, v.precio], ["/asesoria", PRECIO_ASESORIA]);
});

test("la reformulación no toma «ninguno» por un país, ni deja números inventados", () => {
  const j = (pais, forma = "¿Procede la reclamación del consumidor?") => interpretar({ pais_nombrado: pais, tiene_que_ver_con_derechos_deberes_tramites_o_conflictos: true, formas: [forma] }, "quiero reclamar");
  for (const p of ["ninguna", "no aplica", "null", "Colombia", null]) assert.equal(j(p).aplica, true, String(p));
  assert.equal(j("España").aplica, false);
  assert.doesNotMatch(j(null, "¿En qué casos el artículo 2 de la Ley 80 de 1993 permite contratar?").formas[0], /80|artículo 2/);
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
