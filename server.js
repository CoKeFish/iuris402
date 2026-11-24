// API legal que cobra con x402. El comprador es un agente: paga por consulta en USDC y
// recibe artículos con cita y argumento; su LLM redacta con eso, la API no inventa leyes.
import express from "express";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { abrirVentas } from "./base.js";
import { reformular } from "./reformular.js";
import { buscar, cargarIndice, consultar, embeber, textosCitados } from "./buscador.js";
import { API_URL, FACILITATOR_URL, PRECIO_ASESORIA, PRECIO_BUSCAR, RED, requerida } from "./comun.js";

const AVISO =
  "La información suministrada es de carácter general, no constituye concepto jurídico ni sustituye la asesoría de un profesional del derecho. La vigencia debe constatarse en la fuente oficial.";
const RUTAS = ["/buscar", "/asesoria"];

export function crearApp({ payTo, facilitador, ventas = abrirVentas(), traducir = reformular }) {
  const indice = cargarIndice();
  const { normas } = indice;
  const app = express();
  app.disable("x-powered-by");

  // Gratis: qué se vende, a cuánto y con qué cobertura. El agente decide antes de pagar.
  app.get("/", (_, res) =>
    res.json({
      servicio: "leyes-402: base normativa colombiana para agentes",
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
    const q = req.query.q;
    if (typeof q !== "string" || q.trim().length < 8 || q.length > 500) {
      return res.status(400).json({ error: "Parámetro q requerido: consulta de 8 a 500 caracteres. No se generó cobro." });
    }
    next();
  });

  // Reintento sin doble cobro: si la respuesta se perdió, el mismo pago firmado para la misma URL
  // recupera lo ya pagado (24 horas, y aunque la API se reinicie). Un pago nuevo siempre se cobra.
  app.use(RUTAS, (req, res, next) => {
    const firma = req.get("payment-signature") ?? req.get("x-payment");
    if (!firma) return next();
    const clave = createHash("sha256").update(`${req.method} ${req.originalUrl}\n${firma}`).digest("hex");
    const previa = ventas.buscar(clave);
    if (previa) {
      return res.set("PAYMENT-RESPONSE", previa.recibo).set("X-Reintento", "sin-cobro").type("json").send(Buffer.from(previa.respuesta));
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
            ruta: req.baseUrl + req.path.replace(/\/$/, ""),
            transaccion: transaction,
            pagador: payer,
            precio: req.baseUrl === "/asesoria" ? PRECIO_ASESORIA : PRECIO_BUSCAR,
            recibo: String(recibo),
            pregunta: req.query.q,
            respuesta: Buffer.from(cuerpo),
          });
        } catch (e) {
          console.error("No se guardó la venta:", e.message);
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

  const cita = ({ articulo: a, similitud }, n) => ({
    ref: `[${n + 1}]`,
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
    const forma = await traducir(q);
    if (forma && !forma.aplica) {
      res.status(404).json({ error: forma.otroPais ? `La consulta versa sobre el ordenamiento de ${forma.otroPais}; la base comprende únicamente el colombiano. No se generó cobro.` : "La consulta no versa sobre una materia jurídica. No se generó cobro." });
      return [];
    }
    const r = await buscar(indice, q, k, undefined, forma?.formas);
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
    const r = await resultados(req, res, 6);
    if (!r.length) return;
    res.json({
      pregunta: req.query.q,
      entendido_como: r.entendido,
      citas: r.map(cita),
      no_rigen: r.avisos.map(aviso),
      citadas: textosCitados(indice.db, r.map((x) => x.articulo)),
      argumentos: r.flatMap(({ articulo: a }, n) => (a.argumento ? [{ ref: `[${n + 1}]`, argumento: a.argumento }] : [])),
      instrucciones:
        "Elabore un concepto jurídico en lenguaje formal y técnico, con fundamento EXCLUSIVO en las disposiciones suministradas. Toda afirmación jurídica debe llevar su referencia [n]. " +
        "Los argumentos son tesis orientadoras; en caso de discrepancia prevalece el texto literal de la disposición. " +
        "Descarte las citas impertinentes e indique los aspectos sin sustento normativo. " +
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
  await embeber(["calentar el modelo"], "query"); // la primera consulta no espera la carga
  const puerto = Number(process.env.PORT || new URL(API_URL).port || 4021);
  crearApp({ payTo, facilitador: new HTTPFacilitatorClient({ url: FACILITATOR_URL }) }).listen(puerto, () =>
    console.log(`leyes-402 en http://localhost:${puerto} (${PRECIO_BUSCAR} /buscar, ${PRECIO_ASESORIA} /asesoria → ${payTo})`),
  );
}
