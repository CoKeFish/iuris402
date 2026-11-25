// Mide la búsqueda: ¿el artículo correcto sale entre los 5 primeros? ¿se rechaza lo ajeno?
// Las preguntas están como las escribe la gente; la base, solo en lenguaje jurídico. Por eso se mide
// con sus formas reformuladas, guardadas en preguntas-formales.json para que el resultado se repita.
// Uso: npm run evaluar   (--crudo: sin reformular; --reformular: vuelve a pedirlas a REFORMULAR_CMD;
//      --elegir: con el LLM de ELEGIR_CMD que escoge entre los candidatos, unos 8 s por pregunta)
import { readFileSync, writeFileSync } from "node:fs";
import { buscar, cargarIndice, UMBRAL } from "../buscador.js";
import { elegir } from "../elegir.js";
import { reformular } from "../reformular.js";

// pregunta → artículos válidos (basta con que salga uno)
const CASOS = [
  ["compré unos zapatos por internet y me arrepentí, ¿los puedo devolver?", "ley-1480-2011:47"],
  ["el celular nuevo se dañó a los 8 meses y la tienda no responde", "ley-1480-2011:8 ley-1480-2011:7 ley-1480-2011:11"],
  ["pagué con tarjeta en una página que nunca entregó, quiero que me reversen la plata", "ley-1480-2011:51"],
  ["el anuncio decía una cosa y el producto es otra", "ley-1480-2011:30 ley-1480-2011:29 ley-1480-2011:23"],
  ["en la caja me cobraron más de lo que decía la etiqueta", "ley-1480-2011:26"],
  ["el contrato del gimnasio tiene una cláusula injusta", "ley-1480-2011:42 ley-1480-2011:43"],
  ["me llaman a cobrar un domingo por la noche", "ley-2300-2023:3"],
  ["el banco llamó a mi jefe y a mi mamá por mi deuda", "ley-2300-2023:4"],
  ["¿por qué canales me puede escribir una empresa de cobranza?", "ley-2300-2023:2"],
  ["ya pagué la deuda, ¿cuánto tiempo sigo en datacrédito?", "ley-1266-2008:13"],
  ["me reportaron en centrales de riesgo sin avisarme", "ley-1266-2008:12"],
  ["alguien sacó un crédito a mi nombre, me suplantaron", "ley-1266-2008:16"],
  ["quiero que una empresa borre mis datos personales", "ley-1581-2012:8 ley-1581-2012:15"],
  ["¿una app puede usar los datos de mi hijo de 10 años?", "ley-1581-2012:7"],
  ["¿necesitan mi permiso para guardar mi huella y datos de salud?", "ley-1581-2012:6 ley-1581-2012:5"],
  ["¿cuánto tiempo tienen para contestar un reclamo sobre mis datos?", "ley-1581-2012:15"],
  ["¿de cuánto es la multa por tratar mal datos personales?", "ley-1581-2012:23"],
  ["mi startup quiere enviar datos de usuarios a servidores en otro país", "ley-1581-2012:26"],
  ["¿qué debo evaluar antes de entrenar una IA con datos personales?", "sic-ce-002-2024:I sic-ce-002-2024:IV sic-ce-002-2024:responsabilidad"],
  ["¿cuánto me puede subir el arriendo cada año?", "ley-820-2003:20"],
  ["el dueño me pide depósito para arrendarme el apartamento", "ley-820-2003:16"],
  ["quiero irme del apartamento antes de que termine el contrato", "ley-820-2003:24"],
  ["¿vale un contrato firmado por correo electrónico?", "ley-527-1999:14 ley-527-1999:6 ley-527-1999:5 ley-527-1999:7 ley-527-1999:10"],
  ["¿una firma digital tiene la misma fuerza que una firma en papel?", "ley-527-1999:28 ley-527-1999:7"],
  ["¿sirven los chats como prueba ante un juez?", "ley-527-1999:10 ley-527-1999:11"],
  ["la EPS no me atiende y mi vida corre peligro, ¿qué puedo hacer ya?", "cp-1991:86 cp-1991:49 cp-1991:11 ley-1751-2015:14 ley-1751-2015:10 dec-2591-1991:7 dec-2591-1991:42"],
  ["mandé una petición a la alcaldía y no contestan", "cp-1991:23 ley-1437-2011:14 ley-1437-2011:31 ley-1437-2011:13"],
  ["me discriminan por mi religión", "cp-1991:13 cp-1991:19"],
  ["la policía quiere entrar a mi casa sin orden", "cp-1991:28 cp-1991:32"],
  ["¿puedo organizar una marcha pacífica?", "cp-1991:37"],
];
// Segundo grupo, con las leyes nuevas: se escribió antes de cambiar la búsqueda
const CASOS_2 = [
  ["me despidieron sin justa causa, ¿cuánto me deben pagar?", "cst:64"],
  ["¿cuántos días de vacaciones tengo por año?", "cst:186"],
  ["¿cómo me pagan las horas extra?", "cst:168"],
  ["¿cuánto dura la licencia de maternidad?", "cst:236"],
  ["trabajo sin contrato escrito, ¿tengo contrato?", "cst:37 cst:38 cst:23 cst:24"],
  ["¿cuánto puede durar el periodo de prueba?", "cst:78 cst:76 cst:77"],
  ["el jefe me descontó plata del sueldo sin permiso", "cst:149"],
  ["trabajé un domingo, ¿cuánto me pagan?", "cst:179 cst:180 cst:181"],
  ["mi jefe me grita y me humilla en el trabajo", "ley-1010-2006:7 ley-1010-2006:2 ley-1010-2006:9"],
  ["¿en cuántos días tiene que fallar el juez una tutela?", "dec-2591-1991:29 cp-1991:86"],
  ["gané la tutela y no la cumplen", "dec-2591-1991:52 dec-2591-1991:27"],
  ["perdí la tutela, ¿la puedo apelar?", "dec-2591-1991:31 dec-2591-1991:32"],
  ["¿necesito abogado para poner una tutela?", "dec-2591-1991:10 dec-2591-1991:14"],
  ["¿cuántos días tienen para responder un derecho de petición?", "ley-1437-2011:14"],
  ["en urgencias me pidieron autorización y no me atendieron", "ley-1751-2015:14"],
  ["en el conjunto me multaron por hacer ruido", "ley-675-2001:59 ley-675-2001:60 ley-675-2001:61 ley-675-2001:62"],
  ["debo varias cuotas de administración, ¿me cobran intereses?", "ley-675-2001:30 ley-675-2001:29 ley-675-2001:48"],
  ["¿quién nombra al administrador del edificio?", "ley-675-2001:50 ley-675-2001:38"],
  ["me mandaron un enlace falso del banco y puse mi clave", "penal-269:269G"],
  ["un hacker entró a mi correo", "penal-269:269A"],
  ["me vaciaron la cuenta por la app del banco", "penal-269:269I penal-269:269J"],
  ["quiero pedirle al gobierno copia de un contrato público", "ley-1712-2014:4 ley-1712-2014:24 ley-1712-2014:25 ley-1437-2011:13 cp-1991:74"],
  ["mi esposo me pega, ¿a dónde acudo?", "ley-294-1996:4 ley-294-1996:5 ley-294-1996:20"],
  ["mi ex se acerca aunque hay orden de alejamiento", "ley-294-1996:7 ley-294-1996:17"],
  ["¿la audiencia puede ser virtual?", "ley-2213-2022:7 ley-2213-2022:2"],
  ["¿me pueden notificar una demanda por correo electrónico?", "ley-2213-2022:8"],
];
const AJENAS = [
  "receta de lasaña con queso y salsa boloñesa",
  "quién ganó el mundial de fútbol de 1998",
  "cómo instalar python en windows",
  "mejor estrategia para ganar en ajedrez",
  "qué temperatura hace hoy en Cartagena",
  "cuál es la capital de Australia",
  "cuánto pesa un elefante africano",
  "recomiéndame una serie de ciencia ficción",
  "cómo se conjuga el verbo haber en francés",
  "qué planeta tiene más lunas",
  "ejercicios para fortalecer la espalda",
  "cómo cambiar la llanta de una bicicleta",
  "letra de una canción de vallenato",
  "cuál es la raíz cuadrada de 144",
  "qué vino combina con pescado",
];

const ARCHIVO = new URL("./preguntas-formales.json", import.meta.url);
const formales = JSON.parse(readFileSync(ARCHIVO, "utf8"));
const crudo = process.argv.includes("--crudo");
const escoger = process.argv.includes("--elegir") ? elegir : null;
if (process.argv.includes("--reformular")) {
  for (const q of [...CASOS, ...CASOS_2].map(([q]) => q).concat(AJENAS)) {
    const f = await reformular(q);
    if (!f) throw new Error(`sin reformular: ${q} (¿está REFORMULAR_CMD?)`);
    formales[q] = f;
  }
  writeFileSync(ARCHIVO, `${JSON.stringify(formales, null, 1)}
`);
}
const formasDe = (q) => {
  if (crudo) return { aplica: true, formas: [] };
  if (!formales[q]) throw new Error(`falta en preguntas-formales.json: ${q}`);
  return formales[q];
};

const indice = cargarIndice();
let minimo = 1;
async function medir(nombre, casos) {
  let a1 = 0, a5 = 0;
  for (const [q, validos] of casos) {
    const { aplica, formas } = formasDe(q);
    if (!aplica) console.log(`✗ rechazada por el reformulador: ${q}`);
    const r = await buscar(indice, q, 5, 0, formas, escoger);
    const ids = r.map((x) => x.articulo.id);
    const n = aplica ? ids.findIndex((id) => validos.split(" ").includes(id)) : -1;
    if (n === 0) a1++;
    if (n >= 0) a5++;
    else console.log(`✗ ${q}\n   esperaba ${validos} · salió ${ids.join(", ")}`);
    minimo = Math.min(minimo, r.mejor);
  }
  console.log(`${nombre}: primero correcto ${a1}/${casos.length} · entre los 5 primeros ${a5}/${casos.length}`);
}
await medir("Grupo 1", CASOS);
await medir("Grupo 2", CASOS_2);
const ajenas = [];
for (const q of AJENAS) ajenas.push([(await buscar(indice, q, 1, 0)).mejor, q]);
ajenas.sort((a, b) => b[0] - a[0]);
console.log(`Ajenas rechazadas: ${ajenas.filter(([m, q]) => m < UMBRAL || !formasDe(q).aplica).length}/${ajenas.length} · similitud mínima legal ${minimo.toFixed(3)}, máxima ajena ${ajenas[0][0].toFixed(3)} («${ajenas[0][1]}»), umbral ${UMBRAL}`);
