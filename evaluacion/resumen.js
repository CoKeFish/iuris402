// Calcula las cifras del README a partir de las preguntas reservadas y lo que se entregó.
// Uso: npm run resumen
import { readFileSync } from "node:fs";
const { con_respuesta: p, no_deben_cobrarse: f } = JSON.parse(readFileSync(new URL("./reservadas.json", import.meta.url)));
const todos = (x) => [...x.entregados, ...x.avisos];
const validos = (x) => [...x.esenciales, ...x.aceptables];
const n = (lista, cumple) => lista.filter(cumple).length;
const entregados = p.flatMap((x) => x.entregados.map((id) => validos(x).includes(id)));
console.log(`Primero un artículo esencial:        ${n(p, (x) => x.esenciales.includes(todos(x)[0]))}/${p.length}`);
console.log(`Primero uno esencial o aceptable:    ${n(p, (x) => validos(x).includes(todos(x)[0]))}/${p.length}`);
console.log(`Con todos los esenciales (completa): ${n(p, (x) => x.esenciales.every((id) => todos(x).includes(id)))}/${p.length}`);
console.log(`Entregados que sirven:               ${n(entregados, Boolean)}/${entregados.length} (${Math.round((100 * n(entregados, Boolean)) / entregados.length)} %)`);
console.log(`Cobradas sin deber cobrarse:         ${n(f, (x) => x.entregados.length)}/${f.length}`);
