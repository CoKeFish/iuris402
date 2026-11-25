// API legal que cobra con x402. El comprador es un agente: paga por consulta en USDC y
// recibe artículos con cita y argumento; su LLM redacta con eso, la API no inventa leyes.
import express from "express";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { abrirVentas } from "./base.js";
import { elegir } from "./elegir.js";
import { reformular } from "./reformular.js";
import { cargarIndice, consultar, embeber, responder, textosCitados } from "./buscador.js";
import { datosPago, decodificar, estadoPago } from "./pago.js";
import { API_URL, FACILITATOR_URL, PRECIO_ASESORIA, PRECIO_BUSCAR, RED, requerida } from "./comun.js";

const AVISO =
  "La información suministrada es de carácter general, no constituye concepto jurídico ni sustituye la asesoría de un profesional del derecho. La vigencia debe constatarse en la fuente oficial.";
const RUTAS = ["/buscar", "/asesoria"];

export function crearApp({ payTo, facilitador, ventas = abrirVentas(), traducir = reformular, escoger = elegir, rastrear = (pago) => estadoPago(datosPago(pago)) }) {
  const indice = cargarIndice();
  const { normas } = indice;
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag"); // un 304 llegaría vacío y x402 lo cobraría
  app.use((_, res, next) => (res.set("Cache-Control", "no-store"), next()));

  // Gratis: qué se vende, a cuánto y con qué cobertura. El agente decide antes de pagar.
  app.get("/", (_, res) =>
    res.json({
      servicio: "Iuris402: base normativa colombiana para agentes",
      red: RED,
      cobra: payTo,
      rutas: {
        "GET /buscar?q=": { precio: PRECIO_BUSCAR, entrega: "disposiciones aplicables con cita, texto literal, vigencia y fuente oficial" },
        "GET /articulo?id=": { precio: "gratis", entrega: "una disposición por su identificador, con fuente, vigencia, remisiones y normas que la citan" },
        "GET /asesoria?q=": { precio: PRECIO_ASESORIA, entrega: "disposiciones, tesis jurídicas sustentables e instrucciones para la elaboración de un concepto" },
      },
      politica: "La ausencia de disposiciones aplicables (404) y la consulta de normas sin vigencia (410) no generan cobro. El reenvío del mismo pago firmado restituye la respuesta sin nueva liquidación.",
      normas,
      aviso: AVISO,
    }),
  );

  // Gratis: toda referencia debe poder consultarse, también por una persona que quiera verificar.
  app.get("/articulo", (req, res) => {
    const { id } = req.query;
    if (typeof id !== "string" || id.length > 60) return res.status(400).json({ error: "Parámetro id requerido (p. ej., ley-820-2003:20)." });
    const a = consultar(indice.db, id);
    if (!a) return res.status(404).json({ error: "La disposición no se encuentra en la base." });
    res.json({ ...a, aviso: AVISO });
  });

  // La pregunta se valida ANTES del cobro: una petición mal hecha nunca se paga.
  app.use(RUTAS, (req, res, next) => {
    // HEAD pagaría por una respuesta sin cuerpo; "/buscar/" no es la ruta que se cobra
    if (req.method !== "GET") return res.status(405).set("Allow", "GET").json({ error: "Método no permitido. No se generó cobro." });
    const q = req.query.q;
    if (typeof q !== "string" || q.trim().length < 8 || q.length > 500) {
      return res.status(400).json({ error: "Parámetro q requerido: consulta de 8 a 500 caracteres. No se generó cobro." });
    }
    next();
  });

  // Reintento sin doble cobro: si la respuesta se perdió, el mismo pago firmado para la misma URL
  // recupera lo ya pagado (24 horas, y aunque la API se reinicie). Un pago nuevo siempre se cobra.
  const enCurso = new Map(); // dos envíos simultáneos del mismo pago: el segundo espera al primero
  app.use(RUTAS, async (req, res, next) => {
    const firma = req.get("payment-signature") ?? req.get("x-payment");
    if (!firma) return next();
    const clave = createHash("sha256").update(`${req.method} ${req.originalUrl}\n${firma}`).digest("hex");
    const ruta = req.baseUrl; // al terminar la respuesta Express ya la restauró
    const precio = ruta === "/asesoria" ? PRECIO_ASESORIA : PRECIO_BUSCAR;
    while (enCurso.has(clave)) await enCurso.get(clave);
    enCurso.set(clave, new Promise((r) => res.once("close", r)).then(() => enCurso.delete(clave)));
    const repetir = (v) => res.set("PAYMENT-RESPONSE", v.recibo).set("X-Reintento", "sin-cobro").type("json").send(Buffer.from(v.respuesta));
    const previa = ventas.buscar(clave);
    if (previa) return repetir(previa);

    // La liquidación quedó en duda (el facilitador o la red no contestaron): manda lo que diga la red
    const duda = ventas.pendiente(clave);
    if (duda) {
      const red = await Promise.resolve()
        .then(() => rastrear(decodificar(firma)))
        .catch((e) => (console.error("No se pudo consultar el pago:", e.message), { estado: "pendiente" }));
      if (red.estado === "cobrado") {
        const recibo = Buffer.from(JSON.stringify({ success: true, transaction: red.hash, network: RED })).toString("base64");
        ventas.guardar({ clave, ruta, transaccion: red.hash, precio, recibo, pregunta: duda.pregunta, respuesta: duda.respuesta });
        ventas.quitarPendiente(clave);
        return repetir({ recibo, respuesta: duda.respuesta });
      }
      if (red.estado === "vencido") ventas.quitarPendiente(clave);
      else if (duda.transaccion) {
        return res.status(503).set("Retry-After", "5").json({
          error: "El pago fue enviado y la red aún no lo confirma. Puede reenviarse la misma firma: no se cobrará dos veces.",
          transaccion: duda.transaccion,
        });
      }
    }
    const end = res.end.bind(res);
    res.end = (cuerpo, ...resto) => {
      const recibo = res.getHeader("PAYMENT-RESPONSE");
      if (res.statusCode === 200 && recibo && cuerpo) {
        // Ya se cobró: si no se puede guardar, la respuesta se entrega igual
        try {
          const { transaction, payer } = JSON.parse(Buffer.from(String(recibo), "base64"));
          ventas.guardar({
            clave,
            ruta,
            transaccion: transaction,
            pagador: payer,
            precio,
            recibo: String(recibo),
            pregunta: req.query.q,
            respuesta: Buffer.from(cuerpo),
          });
        } catch (e) {
          console.error("No se guardó la venta:", e.message);
        }
      } else if (res.locals.entrega && res.statusCode !== 200) {
        // La respuesta estaba lista y la liquidación falló o quedó en duda: se guarda por si se cobró
        try {
          ventas.anotarPendiente({ clave, transaccion: decodificar(recibo && String(recibo))?.transaction, pregunta: req.query.q, respuesta: res.locals.entrega });
        } catch (e) {
          console.error("No se guardó la entrega en duda:", e.message);
        }
      }
      return end(cuerpo, ...resto);
    };
    next();
  });

  // x402: sin pago, 402 con las instrucciones. El facilitador verifica y liquida.
  const cobro = (price, description) => ({
    accepts: { scheme: "exact", price, network: RED, payTo },
    description,
    mimeType: "application/json",
  });
  app.use(
    paymentMiddlewareFromConfig(
      {
        "GET /buscar": cobro(PRECIO_BUSCAR, "Artículos de leyes colombianas relevantes para una pregunta, con cita y texto literal"),
        "GET /asesoria": cobro(PRECIO_ASESORIA, "Citas, argumentos e instrucciones para que un LLM asesore sobre leyes colombianas"),
      },
      facilitador,
      [{ network: RED, server: new ExactStellarScheme() }],
    ),
  );

  app.use(RUTAS, (_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (cuerpo) => {
      if (res.statusCode === 200) res.locals.entrega = Buffer.from(JSON.stringify(cuerpo));
      return json(cuerpo);
    };
    next();
  });

  const cita = ({ articulo: a, similitud, relevancia }, n) => ({
    ref: `[${n + 1}]`,
    relevancia,
    cita: a.cita,
    titulo: a.titulo,
    seccion: a.seccion,
    texto: a.texto,
    notas: a.notas,
    vigencia: a.vigencia,
    cambios: a.cambios,
    referencias: a.referencias,
    fuente: a.fuente,
    similitud,
  });
  const aviso = ({ articulo: a }) => ({
    id: a.id,
    cita: a.cita,
    titulo: a.titulo,
    vigencia: a.vigencia,
    notas: a.notas,
    consultar: `/articulo?id=${a.id}`,
    fuente: a.fuente,
  });
  const resultados = async (req, res, k) => {
    const q = req.query.q.trim();
    const { forma, r } = await responder(indice, q, k, traducir, escoger);
    // si el comprador ya se fue, no se cobra lo que no va a recibir
    if (req.destroyed && !req.complete || res.destroyed) {
      res.status(499).end();
      return [];
    }
    if (r.fallo) {
      res.status(503).set("Retry-After", "10").json({ error: "El servicio de selección no está disponible. No se generó cobro; puede reintentarse." });
      return [];
    }
    if (forma && !forma.aplica) {
      res.status(404).json({ error: forma.otroPais ? `La consulta versa sobre el ordenamiento de ${forma.otroPais}; la base comprende únicamente el colombiano. No se generó cobro.` : "La consulta no versa sobre una materia jurídica. No se generó cobro." });
      return [];
    }
    r.entendido = forma?.formas ?? [];
    // Preguntan justo por algo que ya no rige o está en duda: se avisa y no se cobra (x402 no liquida un 4xx)
    if (r.soloAviso) {
      res.status(410).json({
        error: "La disposición consultada carece de vigencia o esta se encuentra en discusión. No se generó cobro.",
        avisos: r.avisos.map(aviso),
        relacionadas: r.map(({ articulo: a }) => ({ id: a.id, cita: a.cita, titulo: a.titulo, consultar: `/articulo?id=${a.id}` })),
      });
      return [];
    }
    // Con 4xx, x402 no liquida: sin resultados no hay cobro.
    if (!r.length) res.status(404).json({ error: "No se hallaron disposiciones aplicables en la base. No se generó cobro.", normas: normas.map((n) => n.nombre) });
    return r;
  };

  app.get("/buscar", async (req, res) => {
    const r = await resultados(req, res, 5);
    if (r.length) res.json({ pregunta: req.query.q, entendido_como: r.entendido, citas: r.map(cita), no_rigen: r.avisos.map(aviso), aviso: AVISO });
  });

  app.get("/asesoria", async (req, res) => {
    const r = await resultados(req, res, 10);
    if (!r.length) return;
    res.json({
      pregunta: req.query.q,
      entendido_como: r.entendido,
      citas: r.map(cita),
      no_rigen: r.avisos.map(aviso),
      citadas: textosCitados(indice.db, r),
      argumentos: r.flatMap(({ articulo: a }, n) => (a.argumento ? [{ ref: `[${n + 1}]`, argumento: a.argumento }] : [])),
      instrucciones:
        "Elabore un concepto jurídico en lenguaje formal y técnico, con fundamento EXCLUSIVO en las disposiciones suministradas. Toda afirmación jurídica debe llevar su referencia [n]. " +
        "Los argumentos son tesis orientadoras; en caso de discrepancia prevalece el texto literal de la disposición. " +
        "«relevancia» distingue la disposición que resuelve la consulta (directa) de la que sirve para aplicarla (complementaria). Descarte las citas impertinentes e indique los aspectos sin sustento normativo. " +
        "Vigencia: la «exequibilidad condicionada» obliga a aplicar la disposición únicamente conforme al condicionamiento, que debe citarse. " +
        "Lo «inexequible», «derogado», «subrogado» o de «vigencia temporal agotada» no constituye fundamento; señale el régimen vigente si la nota lo indica. " +
        "«Modificado» conserva vigencia con la variación indicada. «Vigente» resuelve una duda previa. «Yerro corregido» solo enmienda la numeración. " +
        "Si «confirmado» es false, advierta que la vigencia se encuentra en discusión y absténgase de conclusiones categóricas. " +
        "El texto ~~tachado~~ no integra la disposición, salvo yerro corregido. «cambios» identifica la norma modificatoria y su objeto. «no_rigen» relaciona disposiciones sin vigencia, que deben advertirse si son pertinentes. " +
        "«citadas» [R n] son disposiciones objeto de remisión; si su vigencia no ha sido verificada, adviértalo, al igual que las remisiones no consultables. " +
        "Cite la fuente oficial con su enlace. " +
        "Estructura: problema jurídico, tesis, fundamento normativo, argumentos a favor y en contra, conclusiones y actuaciones procedentes, advertencia.",
      aviso: AVISO,
    });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Error interno. No se generó cobro." });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const payTo = requerida("COBRADOR_PUBLIC");
  // Respaldo del demo: sin los LLM y en el puerto siguiente
  const sinLlm = process.argv.includes("--sin-llm");
  if (sinLlm) for (const v of ["REFORMULAR_CMD", "ELEGIR_CMD"]) delete process.env[v];
  await embeber(["calentar el modelo"], "query"); // la primera consulta no espera la carga
  const puerto = Number(process.env.PORT || new URL(API_URL).port || 4021) + (sinLlm ? 1 : 0);
  crearApp({ payTo, facilitador: new HTTPFacilitatorClient({ url: FACILITATOR_URL }) }).listen(puerto, () =>
    console.log(`Iuris402 en http://localhost:${puerto} (${PRECIO_BUSCAR} /buscar, ${PRECIO_ASESORIA} /asesoria → ${payTo})`),
  );
}
