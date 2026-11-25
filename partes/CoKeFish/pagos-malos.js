// Pagos que no deben servir, contra la API y el facilitador reales de testnet. Al final mira la red:
// no debe haber ninguna transferencia. Uso (con la API encendida): npm run pagos-malos
import { createEd25519Signer } from "@x402/stellar";
import { API_URL, RED, UNIDADES, requerida } from "../../comun.js";
import { crearCliente, decodificar, esperar, ledgerActual, motivo, transferencias } from "../../pago.js";

const url = `${API_URL}/buscar?q=${encodeURIComponent("¿Cuánto dura la garantía de un producto nuevo si no dicen nada?")}`;
const signer = createEd25519Signer(requerida("AGENTE_SECRET"), RED);
const cliente = crearCliente(signer, "$0.02");
const requisitos = decodificar((await fetch(url)).headers.get("payment-required"));
const [opcion] = requisitos.accepts;
const desde = (await ledgerActual()) + 1;

// firma otra cosa de la que dice el pago
const firmarOtra = async (cambio) => ({ ...(await cliente.createPaymentPayload({ ...requisitos, accepts: [{ ...opcion, ...cambio }] })), accepted: opcion });
const alterarFirma = async () => {
  const pago = await cliente.createPaymentPayload(requisitos);
  const xdr = Buffer.from(pago.payload.transaction, "base64");
  const i = xdr.lastIndexOf(Buffer.from("signature")) + 20; // dentro de los 64 bytes de la firma
  xdr[i] ^= 0xff;
  return { ...pago, payload: { transaction: xdr.toString("base64") } };
};
const casos = [
  ["Encabezado ilegible", async () => "no-es-un-pago"],
  ["Firma alterada", alterarFirma],
  ["Firma por menos monto", () => firmarOtra({ amount: "1" })],
  ["Firma para otra cuenta", () => firmarOtra({ payTo: signer.address })],
  ["Dice otra red", async () => ({ ...(await cliente.createPaymentPayload(requisitos)), accepted: { ...opcion, network: "stellar:pubnet" } })],
];
for (const [nombre, armar] of casos) {
  const pago = await armar();
  const firma = typeof pago === "string" ? pago : Buffer.from(JSON.stringify(pago)).toString("base64");
  const r = await fetch(url, { headers: { "PAYMENT-SIGNATURE": firma } });
  console.log(`${r.status === 200 ? "❌ ENTREGÓ" : "✅ rechazado"} · ${nombre}: ${r.status} ${motivo(r) ?? ""}`);
}
while ((await ledgerActual()) < desde + 1) await esperar(1000);
const { lista } = await transferencias({ de: signer.address, a: opcion.payTo, desde });
const otras = await transferencias({ de: signer.address, a: signer.address, desde });
console.log(`En la red desde que empezó: ${lista.length + otras.lista.length} transferencias · ${Number(lista.reduce((s, t) => s + t.monto, 0n)) / UNIDADES} USDC`);
