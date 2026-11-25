// Qué pasó con un pago firmado, según la red y no según la API. Lo usan el comprador y el vendedor.
// Cada firma de Stellar lleva un nonce de un solo uso y el ledger en que vence: si la transferencia
// con ese nonce está en la red, se cobró; si venció sin aparecer, ya no puede cobrarse.
import { Address, Transaction, nativeToScVal, rpc, scValToNative } from "@stellar/stellar-sdk";
import { x402Client } from "@x402/fetch";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { PASSPHRASE, RPC_URL, USDC_CONTRATO } from "./comun.js";

const servidorRpc = new rpc.Server(RPC_URL);
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
export const decodificar = (h) => (h ? JSON.parse(Buffer.from(h, "base64")) : null);
const plano = (x) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? String(v) : v));

// Cliente x402 que se niega a firmar por encima del tope
export const crearCliente = (signer, tope, esquema = new ExactStellarScheme(signer, { url: RPC_URL })) =>
  x402Client.fromConfig({ schemes: [{ network: "stellar:*", client: esquema }], spendControls: { maxAmountPerPayment: tope } });

// Lo que firmó el comprador: quién paga, a quién, cuánto, y su nonce
export function datosPago(pago) {
  const { auth } = new Transaction(pago.payload.transaction, PASSPHRASE).operations[0];
  const [a] = JSON.parse(plano(auth));
  const c = Object.values(a.credentials)[0];
  const f = a.root_invocation.function.contract_fn;
  const [de, para, monto] = f.args;
  return { nonce: c.nonce, vence: c.signature_expiration_ledger, contrato: f.contract_address, de: de.address, a: para.address, monto: BigInt(monto.i128) };
}

export const ledgerActual = async (servidor = servidorRpc) => (await servidor.getLatestLedger()).sequence;

// Transferencias de USDC entre dos cuentas desde un ledger, tal como las reporta la red
export async function transferencias({ de, a, desde, servidor = servidorRpc }) {
  const topics = [nativeToScVal("transfer", { type: "symbol" }), new Address(de).toScVal(), new Address(a).toScVal()].map((x) => x.toXdr("base64"));
  const { events, latestLedger } = await servidor.getEvents({
    startLedger: desde,
    filters: [{ type: "contract", contractIds: [USDC_CONTRATO], topics: [[...topics, "**"]] }],
    limit: 10_000,
  });
  const monto = (v) => BigInt(typeof v === "object" ? v.amount : v);
  return { lista: events.map((e) => ({ hash: e.txHash, ledger: e.ledger, monto: monto(scValToNative(e.value)) })), ledger: latestLedger };
}

// cobrado (con su hash), vencido (ya no puede cobrarse) o pendiente (todavía podría)
export async function estadoPago(d, servidor = servidorRpc) {
  if (d.contrato !== USDC_CONTRATO) throw new Error("el pago no es en USDC");
  const desde = Math.min(d.vence - 720, await ledgerActual(servidor));
  const { lista, ledger } = await transferencias({ ...d, desde, servidor });
  for (const t of lista.filter((x) => x.monto === d.monto).reverse()) {
    const tx = await servidor.getTransaction(t.hash);
    if (tx.status === "SUCCESS" && plano(tx.envelopeXdr).includes(`"nonce":"${d.nonce}"`)) return { estado: "cobrado", hash: t.hash, ledger: t.ledger };
  }
  return ledger > d.vence ? { estado: "vencido" } : { estado: "pendiente", segundos: (d.vence - ledger) * 5 };
}

const recibo = (res) => decodificar(res?.headers.get("payment-response"));
export const motivo = (res) => decodificar(res?.headers.get("payment-required"))?.error ?? recibo(res)?.errorReason ?? null;

// Envía el pago firmado y no concluye nada sin mirar la red. Nunca firma otra vez: si no hubo
// respuesta reenvía la misma firma, que no puede cobrarse dos veces.
// pedir() → respuesta · estado() → estadoPago de esa firma
export async function entregarPago({ pedir, estado, plazo = 120_000, pausa = 3000, reintentos = 2, avisar = () => {} }) {
  const mirar = () => estado().catch((e) => ({ estado: "pendiente", error: e.message }));
  const probar = async () => {
    try {
      return { res: await pedir() };
    } catch (e) {
      return { falla: e.message };
    }
  };
  let { res, falla } = await probar();
  for (let i = 1; i <= reintentos && (falla || res.status >= 500); i++) {
    avisar(`${falla ? `Sin respuesta (${falla})` : `Respondió ${res.status}`}: reenvío la misma firma (${i}/${reintentos})`);
    await esperar(pausa);
    ({ res, falla } = await probar());
  }
  let red = await mirar();
  // La API respondió que no (o 503, no disponible) y no envió nada a la red: basta confirmarlo un momento
  const enviado = recibo(res)?.transaction || res?.headers.get("x-transaccion");
  const rechazo = Boolean(res && !res.ok && !enviado && (res.status < 500 || res.status === 503));
  const fin = Date.now() + (rechazo ? pausa * 2 : res?.ok ? pausa * 5 : plazo);
  while (red.estado === "pendiente" && Date.now() < fin) {
    if (!rechazo && !res?.ok) avisar("No sé si el pago pasó: lo busco en la red…");
    await esperar(pausa);
    red = await mirar();
  }
  // Se cobró y no llegó la respuesta: la misma firma la recupera
  for (let i = 0; red.estado === "cobrado" && !res?.ok && i < 3; i++) {
    avisar(`El pago está en la red (${red.hash}): pido lo que ya pagué`);
    if (i) await esperar(pausa);
    ({ res, falla } = await probar());
  }
  return { res, falla, red, rechazo };
}

// Lo que se dice cuando no hubo entrega, sin afirmar más de lo que muestra la red
export function veredicto({ red, rechazo }) {
  if (red.estado === "cobrado") return `Se cobró (${red.hash}) y no llegó la respuesta: reclama con ese hash.`;
  if (red.estado === "vencido") return "No se cobró: la firma venció y no está en la red.";
  if (red.error) return `No pude consultar la red (${red.error}): no firmes otra vez sin revisar la wallet.`;
  return `${rechazo ? "No hay cobro en la red" : "EN DUDA: aún no hay cobro en la red, pero no firmes otra vez"}; la firma vence en ~${red.segundos} s.`;
}
