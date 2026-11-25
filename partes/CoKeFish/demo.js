// Recorrido del Demo Day: muestra en vivo que la API cobra por x402, entrega lo pagado y no cobra
// de más. Lo gastado no lo dice la API: son las transferencias que la red reporta desde que empezó.
// Uso (con la API encendida): npm run demo -- "tu pregunta legal"      respaldo sin LLM: npm run demo -- --respaldo
import { fileURLToPath } from "node:url";
import { x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { API_URL, RED, UNIDADES, USDC, USDC_CONTRATO, enlaceTx, requerida } from "../../comun.js";
import { crearCliente, datosPago, decodificar, entregarPago, estadoPago, ledgerActual, motivo, transferencias, veredicto } from "../../pago.js";

const AJENA = "receta de lasaña con queso y salsa boloñesa";
const TOPE_BAJO = "$0.005";

// firmar(requisitos) → { headers, estado } · firmarConTopeBajo(requisitos) → debe fallar
// gastado() → USDC transferido en la red desde que empezó el recorrido, en unidades
export async function recorrido({ api, pregunta, firmar, firmarConTopeBajo, gastado, decir = () => {}, pausa = 1500, plazo = 120_000 }) {
  const pedir = (q, headers) => fetch(`${api}/asesoria?q=${encodeURIComponent(q)}`, { headers, signal: AbortSignal.timeout(60_000) });
  const pasos = [];
  let inicio = Date.now();
  let acumulado = 0;
  const anotar = async (paso, { mueve = true } = {}) => {
    if (mueve) {
      const total = await gastado().catch(() => null);
      if (total !== null) [paso.gastado, acumulado] = [total - acumulado, total];
    }
    paso.segundos = Math.round((Date.now() - inicio) / 100) / 10;
    pasos.push(paso);
    decir(paso);
    inicio = Date.now();
    return paso;
  };
  const pagar = (q, f) => entregarPago({ pedir: () => pedir(q, f.headers), estado: f.estado, pausa, plazo, avisar: (m) => decir({ aviso: m }) });
  const error = async (e) => `${e.res ? (motivo(e.res) ?? (await e.res.json().catch(() => ({}))).error ?? "") : e.falla} ${veredicto(e)}`.trim();

  // 1. Sin pago
  const sinPago = await pedir(pregunta);
  const requisitos = decodificar(sinPago.headers.get("payment-required"));
  const opcion = requisitos?.accepts[0];
  await anotar({ paso: "Pedir sin pagar", respuesta: sinPago.status, detalle: opcion && `pide ${opcion.amount / UNIDADES} USDC en ${opcion.network}, para ${opcion.payTo}` }, { mueve: false });
  if (sinPago.status !== 402) return pasos;

  // 2. Un agente con tope más bajo que el precio no firma
  try {
    await firmarConTopeBajo(requisitos);
    await anotar({ paso: "Tope excedido", respuesta: "¡firmó!", detalle: "el tope no funcionó" });
  } catch (e) {
    await anotar({ paso: "Tope excedido", respuesta: "rechazado", detalle: /maxAmountPerPayment/.test(e.message) ? `cuesta más que ${TOPE_BAJO}: no se firmó nada` : e.message });
  }

  // 3. Pagar, recibir y comprobar el pago en la red
  let firma;
  try {
    firma = await firmar(requisitos);
  } catch (e) {
    await anotar({ paso: "Firmar el pago", respuesta: "rechazado", detalle: e.message });
    return pasos;
  }
  const pagada = await pagar(pregunta, firma);
  if (!pagada.res?.ok) {
    await anotar({ paso: "Pagar y pedir", respuesta: pagada.res?.status ?? "sin respuesta", detalle: await error(pagada) });
    return pasos;
  }
  const cuerpo = await pagada.res.json();
  await anotar({
    paso: "Pagar y pedir",
    respuesta: pagada.res.status,
    verificado: pagada.red.estado === "cobrado",
    hash: pagada.red.hash ?? decodificar(pagada.res.headers.get("payment-response"))?.transaction,
    detalle: cuerpo.citas.map((c) => c.cita).join(" · "),
  });

  // 4. El mismo pago otra vez: la misma respuesta, sin cobro
  const repetida = await pedir(pregunta, firma.headers).catch((e) => e);
  const igual = repetida.ok && JSON.stringify(await repetida.json()) === JSON.stringify(cuerpo);
  await anotar({ paso: "Reenviar el mismo pago", respuesta: repetida.status ?? repetida.message, detalle: igual ? `la misma respuesta, ${repetida.headers.get("x-reintento")}` : "la respuesta no es la misma" });

  // 5. Una pregunta que no es de derecho: no se cobra aunque el pago iba firmado
  const otra = await firmar(decodificar((await pedir(AJENA)).headers.get("payment-required")));
  const ajena = await pagar(AJENA, otra);
  await anotar({ paso: "Preguntar algo que no es derecho", respuesta: ajena.res?.status ?? "sin respuesta", detalle: ajena.res ? (await ajena.res.json()).error : await error(ajena) });
  return pasos;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const respaldo = args.includes("--respaldo");
  const pregunta = args.filter((a) => !a.startsWith("--")).join(" ").trim() || "compré por internet y me arrepentí, ¿lo puedo devolver?";
  const url = new URL(API_URL);
  if (respaldo) url.port = Number(url.port) + 1; // npm run api -- --sin-llm
  const signer = createEd25519Signer(requerida("AGENTE_SECRET"), RED);
  const cliente = crearCliente(signer, process.env.TOPE || "$0.02");
  const tacano = crearCliente(signer, TOPE_BAJO);
  const http = new x402HTTPClient(cliente);
  const desde = (await ledgerActual()) + 1;
  let cobrador;
  console.log(`❓ ${pregunta}\n   paga ${signer.address}\n   USDC ${USDC.issuer}, contrato ${USDC_CONTRATO}\n`);
  try {
    const pasos = await recorrido({
      api: url.origin,
      pregunta,
      firmar: async (r) => {
        const pago = await cliente.createPaymentPayload(r);
        const datos = datosPago(pago);
        return { headers: http.encodePaymentSignatureHeader(pago), estado: () => estadoPago(datos) };
      },
      firmarConTopeBajo: (r) => ((cobrador = r.accepts[0].payTo), tacano.createPaymentPayload(r)),
      gastado: async () => {
        // la red aún puede no haber cerrado ese ledger: entonces no hay nada gastado
        if ((await ledgerActual()) < desde) return 0;
        const { lista } = await transferencias({ de: signer.address, a: cobrador, desde });
        return Number(lista.reduce((s, t) => s + t.monto, 0n));
      },
      decir: (p) =>
        console.log(
          p.aviso
            ? `  … ${p.aviso}`
            : `▶ ${p.paso}: ${p.respuesta}${p.gastado === undefined ? "" : ` · gastado en la red ${p.gastado / UNIDADES} USDC`} · ${p.segundos} s\n  ${p.detalle ?? ""}` +
                (p.hash ? `\n  ${p.verificado ? "✅ verificado en la red (USDC, cuentas, monto y nonce)" : "⚠ no pude verificarlo en la red"}\n  ${enlaceTx(p.hash)}` : "") +
                "\n",
        ),
    });
    console.log(`Total: ${pasos.reduce((s, p) => s + p.segundos, 0).toFixed(1)} s · ${pasos.reduce((s, p) => s + (p.gastado ?? 0), 0) / UNIDADES} USDC`);
  } catch (e) {
    console.log(`❌ ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}. ¿Está encendida la API en ${url.origin}? (npm run api)`);
    process.exitCode = 1;
  }
}
