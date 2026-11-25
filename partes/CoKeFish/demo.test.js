// El recorrido contra la API real con un facilitador simulado: no mueve USDC. Uso: npm test
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { abrirVentas } from "../../base.js";
import { RED } from "../../comun.js";
import { crearApp } from "../../server.js";
import { recorrido } from "./demo.js";

const PAGO_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PRECIO = 200000; // 0.02 USDC

async function conApi(valido, usar) {
  let saldo = 1_000_000;
  const facilitador = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: RED, extra: { areFeesSponsored: true } }], extensions: [], signers: {} }),
    verify: async () => (valido ? { isValid: true, payer: PAGO_A } : { isValid: false, invalidReason: "insufficient_funds", payer: PAGO_A }),
    settle: async () => {
      saldo -= PRECIO;
      return { success: true, transaction: "hash-demo", network: RED, payer: PAGO_A };
    },
  };
  const ventas = abrirVentas(join(mkdtempSync(join(tmpdir(), "demo-")), "ventas.db"));
  const servidor = crearApp({ payTo: PAGO_A, facilitador, ventas, traducir: async () => undefined, escoger: async () => undefined }).listen(0);
  await new Promise((r) => servidor.once("listening", r));
  let n = 0;
  const firmar = async (r) => ({
    "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify({ x402Version: 2, resource: r.resource, accepted: r.accepts[0], payload: { transaction: `t${n++}` } })).toString("base64"),
  });
  try {
    await usar({ api: `http://localhost:${servidor.address().port}`, firmar, saldo: async () => saldo });
  } finally {
    servidor.closeAllConnections();
    await new Promise((r) => servidor.close(r));
    ventas.cerrar();
  }
}
const pregunta = "¿Cuánto dura la garantía de un producto nuevo si no dicen nada?";

test("402, pago de 0.02, entrega, reenvío sin cobro y pregunta ajena sin cobro", () =>
  conApi(true, async (c) => {
    const p = await recorrido({ ...c, pregunta });
    assert.deepEqual(p.map((x) => x.respuesta), [402, 200, 200, 404]);
    assert.deepEqual(p.slice(1).map((x) => x.gastado), [PRECIO, 0, 0]);
    assert.equal(p[1].hash, "hash-demo");
    assert.equal(p[2].detalle, "sin-cobro");
  }));

test("si cuesta más que el tope no se firma ni se gasta", () =>
  conApi(true, async (c) => {
    const p = await recorrido({ ...c, pregunta, firmar: async () => { throw new Error("maxAmountPerPayment exceeded"); } });
    assert.deepEqual(p.map((x) => x.respuesta), [402, "rechazado"]);
    assert.equal(await c.saldo(), 1_000_000);
  }));

test("sin saldo el pago se rechaza y el recorrido se detiene sin gastar", () =>
  conApi(false, async (c) => {
    const p = await recorrido({ ...c, pregunta });
    assert.deepEqual(p.map((x) => x.respuesta), [402, 402]);
    assert.equal(p[1].gastado, 0);
  }));
