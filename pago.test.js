// El comprador: qué concluye según la red. No mueve USDC. Uso: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { RED, USDC_CONTRATO } from "./comun.js";
import { crearCliente, entregarPago, motivo, veredicto } from "./pago.js";

const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64");
const respuesta = (status, headers = {}) => new Response("{}", { status, headers });
const enDuda = () => respuesta(402, { "payment-response": b64({ success: false, transaction: "h", errorReason: "settle_exact_stellar_transaction_failed" }) });
const rapido = { pausa: 1, plazo: 40 };
// cada llamada devuelve el siguiente de la lista; el último se repite
const guion = (...xs) => {
  const f = async () => {
    f.veces++;
    const x = xs.length > 1 ? xs.shift() : xs[0];
    if (x instanceof Error) throw x;
    return typeof x === "function" ? x() : x;
  };
  f.veces = 0;
  return f;
};

test("tope real de x402: por encima no se llama al firmante, por debajo sí", async () => {
  let firmas = 0;
  const esquema = Object.assign(new ExactStellarScheme({ address: "G" }), { createPaymentPayload: async () => (firmas++, { x402Version: 2, payload: { transaction: "t" } }) });
  const requisitos = { x402Version: 2, resource: { url: "http://x" }, accepts: [{ scheme: "exact", network: RED, amount: "200000", asset: USDC_CONTRATO, payTo: "G", maxTimeoutSeconds: 300, extra: {} }] };
  await assert.rejects(crearCliente(null, "$0.005", esquema).createPaymentPayload(requisitos), /maxAmountPerPayment/);
  assert.equal(firmas, 0);
  await crearCliente(null, "$0.02", esquema).createPaymentPayload(requisitos);
  assert.equal(firmas, 1);
});

test("liquidación en duda que luego se confirma: recupera lo pagado con la misma firma", async () => {
  const pedir = guion(enDuda, () => respuesta(200));
  const e = await entregarPago({ ...rapido, pedir, estado: guion({ estado: "pendiente", segundos: 60 }, { estado: "cobrado", hash: "h" }) });
  assert.equal(e.res.status, 200);
  assert.equal(e.red.hash, "h");
  assert.equal(pedir.veces, 2);
});

test("liquidación en duda que no se confirma: no se cae, no afirma que no se cobró y pide no firmar otra vez", async () => {
  const e = await entregarPago({ ...rapido, pedir: guion(enDuda), estado: guion({ estado: "pendiente", segundos: 200 }) });
  assert.equal(e.res.status, 402);
  assert.equal(motivo(e.res), "settle_exact_stellar_transaction_failed");
  assert.match(veredicto(e), /EN DUDA.*no firmes otra vez/);
});

test("la firma venció sin aparecer en la red: ahí sí se sabe que no se cobró", async () => {
  const e = await entregarPago({ ...rapido, pedir: guion(enDuda), estado: guion({ estado: "vencido" }) });
  assert.match(veredicto(e), /No se cobró: la firma venció/);
});

test("sin respuesta: reenvía la misma firma y, si se cobró, lo dice con el hash", async () => {
  const pedir = guion(new Error("timeout"));
  const e = await entregarPago({ ...rapido, pedir, estado: guion({ estado: "cobrado", hash: "h9" }) });
  assert.ok(pedir.veces >= 3);
  assert.match(veredicto(e), /Se cobró \(h9\)/);
});

test("si la red tampoco responde no concluye nada", async () => {
  const e = await entregarPago({ ...rapido, pedir: guion(new Error("timeout")), estado: guion(new Error("RPC caída")) });
  assert.match(veredicto(e), /No pude consultar la red \(RPC caída\).*no firmes otra vez/);
});

test("rechazo antes de liquidar: responde rápido, con el motivo, y la red confirma que no hay cobro", async () => {
  const rechazo = () => respuesta(402, { "payment-required": b64({ error: "insufficient_funds", accepts: [] }) });
  const pedir = guion(rechazo);
  const e = await entregarPago({ ...rapido, pedir, estado: guion({ estado: "pendiente", segundos: 290 }) });
  assert.equal(pedir.veces, 1);
  assert.equal(motivo(e.res), "insufficient_funds");
  assert.match(veredicto(e), /No hay cobro en la red/);
});

test("un 503 se reintenta con la misma firma", async () => {
  const pedir = guion(() => respuesta(503), () => respuesta(200));
  const e = await entregarPago({ ...rapido, pedir, estado: guion({ estado: "cobrado", hash: "h" }) });
  assert.equal(e.res.status, 200);
  assert.equal(pedir.veces, 2);
});
