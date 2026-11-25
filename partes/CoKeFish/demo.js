// Recorrido del Demo Day: muestra en vivo que la API cobra por x402, entrega lo pagado y no cobra
// de más. Cada paso dice qué pidió, qué respondió la API y si se movió dinero.
// Uso (con la API encendida): node --env-file=.env partes/CoKeFish/demo.js "tu pregunta legal"
import { fileURLToPath } from "node:url";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { API_URL, RED, RPC_URL, UNIDADES, enlaceTx, requerida, saldoUSDC } from "../../comun.js";

const AJENA = "receta de lasaña con queso y salsa boloñesa";
const decodificar = (h) => (h ? JSON.parse(Buffer.from(h, "base64")) : null);

// firmar(requisitos) → encabezados con el pago · saldo() → USDC de quien paga, en unidades
export async function recorrido({ api, pregunta, firmar, saldo, decir = () => {} }) {
  const pedir = (q, headers) => fetch(`${api}/asesoria?q=${encodeURIComponent(q)}`, { headers });
  const pasos = [];
  const anotar = (paso) => {
    pasos.push(paso);
    decir(paso);
    return paso;
  };

  const sinPago = await pedir(pregunta);
  const requisitos = decodificar(sinPago.headers.get("payment-required"));
  anotar({ paso: "Pedir sin pagar", respuesta: sinPago.status, detalle: requisitos && `pide ${requisitos.accepts[0].amount / UNIDADES} USDC en ${requisitos.accepts[0].network}` });
  if (sinPago.status !== 402) return pasos;

  const antes = await saldo();
  let firmado;
  try {
    firmado = await firmar(requisitos);
  } catch (e) {
    anotar({ paso: "Firmar el pago", respuesta: "rechazado", gastado: 0, detalle: /maxAmountPerPayment/.test(e.message) ? "cuesta más que el tope: no se firmó nada" : e.message });
    return pasos;
  }
  const pagada = await pedir(pregunta, firmado);
  const cuerpo = await pagada.json();
  const recibo = decodificar(pagada.headers.get("payment-response"));
  const gastado = antes - (await saldo());
  anotar({ paso: "Pagar y pedir", respuesta: pagada.status, hash: recibo?.transaction ?? null, gastado, detalle: cuerpo.citas ? cuerpo.citas.map((c) => c.cita).join(" · ") : cuerpo.error });
  if (pagada.status !== 200) return pasos;

  const despues = await saldo();
  const repetida = await pedir(pregunta, firmado);
  anotar({ paso: "Reenviar el mismo pago", respuesta: repetida.status, gastado: despues - (await saldo()), detalle: repetida.headers.get("x-reintento") ?? "se cobró otra vez" });

  const reqAjena = decodificar((await pedir(AJENA)).headers.get("payment-required"));
  const ajena = await pedir(AJENA, await firmar(reqAjena));
  anotar({ paso: "Preguntar algo que no es derecho", respuesta: ajena.status, gastado: despues - (await saldo()), detalle: (await ajena.json()).error });
  return pasos;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pregunta = process.argv.slice(2).join(" ").trim() || "compré por internet y me arrepentí, ¿lo puedo devolver?";
  const signer = createEd25519Signer(requerida("AGENTE_SECRET"), RED);
  const client = x402Client.fromConfig({
    schemes: [{ network: "stellar:*", client: new ExactStellarScheme(signer, { url: RPC_URL }) }],
    spendControls: { maxAmountPerPayment: process.env.TOPE || "$0.02" },
  });
  const http = new x402HTTPClient(client);
  console.log(`❓ ${pregunta}\n`);
  await recorrido({
    api: API_URL,
    pregunta,
    firmar: async (r) => http.encodePaymentSignatureHeader(await client.createPaymentPayload(r)),
    saldo: () => saldoUSDC(signer.address),
    decir: (p) =>
      console.log(`▶ ${p.paso}: ${p.respuesta}${p.gastado === undefined ? "" : ` · gastado ${p.gastado / UNIDADES} USDC`}\n  ${p.detalle ?? ""}${p.hash ? `\n  ${enlaceTx(p.hash)}` : ""}\n`),
  });
}
