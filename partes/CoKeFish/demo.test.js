// El recorrido contra la API real con un facilitador simulado: no mueve USDC. Uso: npm test
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { abrirVentas } from "../../base.js";
import { RED } from "../../comun.js";
import { crearCliente } from "../../pago.js";
import { crearApp } from "../../server.js";
import { recorrido } from "./demo.js";

const PAGO_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PRECIO = 200000; // 0.02 USDC

async function conApi(valido, usar) {
  let cobrado = 0;
  let firmas = 0;
  const facilitador = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: RED, extra: { areFeesSponsored: true } }], extensions: [], signers: {} }),
    verify: async () => (valido ? { isValid: true, payer: PAGO_A } : { isValid: false, invalidReason: "insufficient_funds", payer: PAGO_A }),
    settle: async () => {
      cobrado += PRECIO;
      return { success: true, transaction: "hash-demo", network: RED, payer: PAGO_A };
    },
  };
  const ventas = abrirVentas(join(mkdtempSync(join(tmpdir(), "demo-")), "ventas.db"));
  const servidor = crearApp({ payTo: PAGO_A, facilitador, ventas, traducir: async () => undefined, escoger: async () => undefined }).listen(0);
  await new Promise((r) => servidor.once("listening", r));
  const firmar = async (r) => ({
    headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify({ x402Version: 2, resource: r.resource, accepted: r.accepts[0], payload: { transaction: `t${firmas++}` } })).toString("base64") },
    estado: async () => (cobrado ? { estado: "cobrado", hash: "hash-demo" } : { estado: "pendiente", segundos: 290 }),
  });
  // el mismo cliente x402 del demo, con un esquema que cuenta si se llegó a firmar
  const esquema = Object.assign(new ExactStellarScheme({ address: PAGO_A }), { createPaymentPayload: async () => (firmas++, { x402Version: 2, payload: {} }) });
  const firmarConTopeBajo = (r) => crearCliente(null, "$0.005", esquema).createPaymentPayload(r);
  try {
    await usar({ api: `http://localhost:${servidor.address().port}`, firmar, firmarConTopeBajo, gastado: async () => cobrado, firmas: () => firmas, pausa: 1, plazo: 50 });
  } finally {
    servidor.closeAllConnections();
    await new Promise((r) => servidor.close(r));
    ventas.cerrar();
  }
}
const pregunta = "¿Cuánto dura la garantía de un producto nuevo si no dicen nada?";

test("402, tope excedido, pago de 0.02, entrega, reenvío sin cobro y pregunta ajena sin cobro", () =>
  conApi(true, async (c) => {
    const p = await recorrido({ ...c, pregunta });
    assert.deepEqual(p.map((x) => x.respuesta), [402, "rechazado", 200, 200, 404]);
    assert.deepEqual(p.slice(1).map((x) => x.gastado), [0, PRECIO, 0, 0]);
    assert.match(p[1].detalle, /no se firmó nada/);
    assert.equal(p[2].hash, "hash-demo");
    assert.ok(p[2].verificado);
    assert.match(p[3].detalle, /la misma respuesta, sin-cobro/);
  }));

test("si no se puede firmar, el recorrido se detiene sin pagar", () =>
  conApi(true, async (c) => {
    const p = await recorrido({ ...c, pregunta, firmar: async () => { throw new Error("maxAmountPerPayment exceeded"); } });
    assert.deepEqual(p.map((x) => x.respuesta), [402, "rechazado", "rechazado"]);
    assert.equal(c.firmas(), 0);
    assert.equal(await c.gastado(), 0);
  }));

test("sin saldo el pago se rechaza con su motivo y el recorrido se detiene sin gastar", () =>
  conApi(false, async (c) => {
    const p = await recorrido({ ...c, pregunta });
    assert.deepEqual(p.map((x) => x.respuesta), [402, "rechazado", 402]);
    assert.equal(p[2].gastado, 0);
    assert.match(p[2].detalle, /insufficient_funds.*No hay cobro en la red/);
  }));
