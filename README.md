# Iuris402

Base legal colombiana para agentes de IA, que se paga por consulta con **x402** en USDC sobre
Stellar **testnet**. Un agente pregunta en lenguaje común, paga centavos y recibe los artículos
aplicables (texto, cita y enlace oficial) con argumentos, listos para que su LLM redacte una
asesoría que cita la ley en vez de inventarla.

Proyecto del bootcamp Código x402 (BAF México · Stellar Ambassadors). Track: **API de pago (x402)**. Todo corre en
testnet: dinero de prueba.

## Para quién y por qué se paga por consulta

**Para quien construye agentes** que tocan derechos de la gente: atención al cliente, cobranza, arriendos, recursos humanos,
cumplimiento. Por ejemplo, un agente de cobranza debe saber si puede escribirle a alguien un domingo. Si se lo pregunta a un LLM,
puede citar una ley que no existe o un artículo derogado.

- **Leer la ley es gratis** (`/articulo`): es pública y toda cita debe poder verificarse.
- **Se paga por encontrar cuál aplica:** de la pregunta de la calle a los artículos que la resuelven, con su vigencia, lo que
  citan y los argumentos. Ese trabajo se hace en cada consulta, con dos LLM.
- **Por uso y no por suscripción:** un agente necesita esto de vez en cuando, no llena formularios ni firma contratos. Con x402
  ve el precio (0.02 USDC), lo compara con su tope, paga y recibe en la misma petición. Si no hay respuesta, no paga.

## Cómo funciona

```
archivo crudo (HTML / PDF) → JSON curado, igual a la fuente → resumen con IA → embedding → leyes.db
                                                                                        │
agente ── pregunta + pago x402 ──► API ── búsqueda híbrida ──► citas + argumentos ──► LLM asesor
```

La base completa (`datos/`) **no está en este repositorio**: con ella trabaja la API que se paga. Aquí está el código con que
se construye, se verifica y se cobra, y una **muestra de 10 artículos** (`muestra/`) para probarlo.

1. **Crudo** (`datos/crudo/`): el HTML o PDF tal como lo publica la entidad; se baja con `npm run descargar`.
2. **Curado** (`datos/curado/`): **dice lo mismo que la fuente**, ordenado por artículo, con sección y
   procedencia (entidad, URL, archivo, SHA-256 y fecha). Lo tachado queda `~~así~~`, lo subrayado
   `_así_` y las notas de vigencia en su sitio. Un PDF escaneado se transcribe leyendo la imagen de
   cada página (`datos/ocr/`), con sus erratas.
3. **Referencias** (`datos/citados.json`): cuando una ley remite a otra se guarda a dónde. Si el artículo
   es nuestro, se enlaza; si no, se baja el texto oficial (Senado, Función Pública o Corte) con URL y
   SHA-256. Lo que no se puede abrir queda anotado con el motivo.
4. **Vigencia** (`datos/vigencia/`): por qué algo está tachado, inexequible, condicionado o derogado:
   providencia o ley, fecha, condición y razón **citadas literalmente** del fallo, con enlace y SHA-256.
   Lo que no se pudo confirmar lo dice (`confirmado: false`).
5. **Cambios y razones** (`datos/cambios.json`): quién modificó o adicionó cada artículo, con qué texto y
   con qué objeto declarado ("Por medio de la cual…"), literal.
6. **Resumen** (`datos/resumenes/`): escrito por IA (Claude) en lenguaje formal y vocabulario jurídico, junto
   con las consultas que el artículo responde. **Solo sirve para calcular el embedding**: la API no lo
   lee ni lo entrega.
7. **Base de datos** (`base.js`, SQLite de Node): `datos/leyes.db` se genera desde los JSON, que son la
   fuente de verdad. `datos/ventas.db` guarda los pagos y va aparte porque no se puede regenerar.
8. **Búsqueda** (`reformular.js`, `buscador.js`, `elegir.js`): un LLM pasa la pregunta a lenguaje jurídico, la
   separa en sus problemas y dice si es de otro país o no es derecho (`REFORMULAR_CMD`). Embeddings
   locales (multilingual-e5-small, sin API key) y palabras clave (BM25) **encuentran** unos 25 candidatos,
   incluidos los que se citan entre sí y los contiguos. Otro LLM lee su texto y **elige** los que resuelven la
   consulta (`ELEGIR_CMD`); si ninguno, no se cobra. Los dos son intercambiables y opcionales, pero sin ellos
   se responde bastante peor.
9. **Cobro** (`server.js`): x402, esquema `exact`, USDC por su contrato en `stellar:testnet`.
10. **Agente** (`agente.js`): wallet propia, tope de gasto, comprueba su pago en la RPC de
   Stellar y pasa el encargo a un LLM.
11. **Pago en duda** (`pago.js`): cada firma lleva un nonce de un solo uso y un vencimiento. Comprador y vendedor buscan esa
   transferencia en la red: si está, se cobró; si venció sin aparecer, no puede cobrarse; si no, está en duda y nadie firma otra vez.

## Qué se vende

| Ruta | Precio | Entrega |
|---|---|---|
| `GET /` | gratis | catálogo, precios y cobertura |
| `GET /articulo?id=` | gratis | un artículo con su fuente, su vigencia, a qué remite y quién lo cita |
| `GET /buscar?q=` | 0.01 USDC | hasta 5 artículos con cita, texto, notas de vigencia y fuente |
| `GET /asesoria?q=` | 0.02 USDC | hasta 10 artículos (directos y complementarios), el texto de las normas externas que citan, argumentos e instrucciones para el LLM |

- Una pregunta mal hecha responde 400 **antes** de pedir pago.
- Sin normas relevantes, sobre otro país o sobre algo que no es derecho: 404 y **no cobra**.
- Si preguntan justo por algo que ya no rige: 410 con el aviso y su razón, y **no cobra**.
- Si el LLM que elige falla: 503 y **no cobra**. HEAD: 405.
- Reenviar el mismo pago firmado devuelve la misma respuesta **sin cobrar otra vez** (24 horas,
  aunque la API se reinicie). Después se borran la pregunta y la respuesta, y queda el recibo.
- Si el facilitador o la red no confirman a tiempo, la respuesta queda guardada: se entrega con la misma firma
  cuando la red muestra el pago, sin cobrar otra vez.

| Si pasa esto | Qué ocurre | Dónde se prueba |
|---|---|---|
| Saldo insuficiente | el agente no firma; si llega firmado, 402 y no se entrega | `demo.test.js`, `server.test.js`, [ensayo](partes/CoKeFish/ENSAYOS.md) |
| Pago repetido (también simultáneo) | la misma respuesta, un solo cobro | `server.test.js`, ensayo |
| Tope excedido | no se firma nada | `pago.test.js` con el tope real de x402, ensayo |
| Pago inválido (ilegible, firma alterada, menos monto, otra cuenta, otra red) | 402, sin entrega ni cobro | `server.test.js`, `npm run pagos-malos` |
| No se sabe si se cobró | se busca el nonce en la red; no se firma otra vez | `pago.test.js`, `server.test.js` |

## Uso

Node 22.15 o más nuevo. Los mismos comandos sirven en bash y PowerShell.

```bash
npm install
npm run cuentas           # crea .env y las dos cuentas de testnet, con XLM de Friendbot y trustline de USDC
```

Pide USDC de prueba para la cuenta del AGENTE en <https://faucet.circle.com> (Stellar Testnet). Luego:

```bash
npm run indexar           # crea la base con la muestra (la primera vez baja el modelo, ~135 MB)
npm test                  # opcional; necesita la base creada
npm run api               # terminal 1
npm run demo              # terminal 2: el recorrido completo, con el pago comprobado en la red
npm run agente -- "compré por internet y me arrepentí, ¿lo puedo devolver?"
```

La muestra trae 10 artículos: esa pregunta sale con ella; las demás del pitch necesitan la base completa. Sin los LLM funciona, con peor
puntería; para encenderlos, quita el `#` de `REFORMULAR_CMD`, `ELEGIR_CMD` y `MAX_THINKING_TOKENS` en `.env`. Para que otro LLM redacte la
asesoría define `ASESOR_CMD` (lee el encargo por stdin), por ejemplo `ASESOR_CMD='claude -p'`. El tope del agente es `TOPE` en `.env`.

Agregar leyes: añade la norma a `ingesta/fuentes.json`, luego `npm run descargar`,
`npm run curar`, `npm run verificar-curado`, `npm run citar`, `npm run cambios`, escribe sus resúmenes en `datos/resumenes/` y `npm run indexar`.

## Pruebas

`npm test` pasa con la muestra. Las demás necesitan la base completa.

- `npm test`: 40 pruebas del cobro, el comprador y la base con un facilitador simulado (402 correcto, sin doble cobro aunque la API
  se reinicie o lleguen dos envíos a la vez, pago en duda, sin cobro si no hay resultados, referencias consultables).
- `npm run verificar-curado`: compara el curado con el crudo, párrafo por párrafo (palabras en orden,
  sin puntuación). Lo que no está se lista: sentencias que agrega la casa editorial, títulos fuera del
  rango tomado y dos artículos del proyecto de la Ley 1712 que nunca fueron ley. La transcripción del
  PDF se compara con la capa de texto del propio PDF; las diferencias se revisan contra la imagen.
- `npm run verificar-vigencia`: 309 afectaciones con 171 fuentes (las dudosas van marcadas). Falla si una cita no está literal en su
  fuente o si queda algo tachado, inexequible, condicionado o derogado sin explicar.
- `npm run citar`: 982 referencias; de las que no se pueden consultar se dice por qué.
- `npm run evaluar`: 56 preguntas coloquiales nuestras, ya reformuladas (`ingesta/preguntas-formales.json`).
- `npm run resumen`: **prueba limpia**, 30 preguntas que escribió otro modelo (Gemini 4 Neon) leyendo la base y que se reservaron sin
  usar ([preguntas y resultados](evaluacion/reservadas.json)). Primero sale un artículo esencial en **26** y uno esencial o aceptable en 30;
  26 respuestas traen todos los esenciales, y 78 % de lo entregado sirve. De 15 preguntas que no debían cobrarse, se cobró 1.
- [Ensayos del demo](partes/CoKeFish/ENSAYOS.md): pagar, recibir y comprobar en la red toma de 12 a 19 s con los dos LLM.

## Hashes de prueba (testnet)

Pagos de 0.02 USDC del agente a la API por `/asesoria`, comprobados por RPC en el mismo recorrido:

- [`d250ca94274588f3c8b01af0ded070661668e0d45d18a828708004658fd7ae2d`](https://stellar.expert/explorer/testnet/tx/d250ca94274588f3c8b01af0ded070661668e0d45d18a828708004658fd7ae2d)
- [`b0e7028f63faafdef76faa0f11bd80473a1fcc991e6cc96bbf847678b8c2fd49`](https://stellar.expert/explorer/testnet/tx/b0e7028f63faafdef76faa0f11bd80473a1fcc991e6cc96bbf847678b8c2fd49)
- [`a13b4a4e648b3d3124a1af0f762d811317edd531d7fcf38be953e74edcef5fcc`](https://stellar.expert/explorer/testnet/tx/a13b4a4e648b3d3124a1af0f762d811317edd531d7fcf38be953e74edcef5fcc)
- [`bc576389f528c53ac5dcf98f82552bf6bdafae3fd28a5089f9e7d72fe5081c5b`](https://stellar.expert/explorer/testnet/tx/bc576389f528c53ac5dcf98f82552bf6bdafae3fd28a5089f9e7d72fe5081c5b)
- [`498ad2af5314e1681917c0b667dd1ed2e14165c015327a63c8e68535a71bc8d8`](https://stellar.expert/explorer/testnet/tx/498ad2af5314e1681917c0b667dd1ed2e14165c015327a63c8e68535a71bc8d8)

Los demás, con hora y duración, en [ENSAYOS.md](partes/CoKeFish/ENSAYOS.md). Los primeros fueron
[`55c53632…`](https://stellar.expert/explorer/testnet/tx/55c53632c2434d1b218052432d01c5f1a7be665800d11e3c39adee2ba1a99d9b) y [`fd6cace6…`](https://stellar.expert/explorer/testnet/tx/fd6cace64c8174be4470fea540f635d493464310563e4440a73f2def4958fc67).

## Equipo y partes

- [CoKeFish](https://github.com/CoKeFish): [recorrido del demo, sus pruebas y ensayos](partes/CoKeFish/README.md) y el resto del proyecto (equipo de una persona)

## Cobertura y límites

1.209 artículos o instrucciones en venta (y 78 que ya no rigen, solo para avisarlo), de 36 normas o partes de normas:

- **Generales:** Constitución (1 a 95), CPACA (1 a 45), tutela (Decreto 2591 de 1991), leyes 527, 1712 y 2213.
- **Trabajo y seguridad social:** Código Sustantivo del Trabajo (1 a 237, 249 a 258 y 306 a 308), leyes 21 de 1982, 50 de
  1990, 100 de 1993, 1010 y 1562, y Decreto Ley 1295 de 1994 (artículos seleccionados).
- **Empresa y local:** Código de Comercio (1 a 47, 98 a 121 y 515 a 533), Ley 1258 de 2008 (SAS), leyes 9 de 1979, 388,
  1575 y 1801 (artículos seleccionados).
- **Impuestos:** Estatuto Tributario (renta, IVA, SIMPLE, RUT, factura y sanciones: 44 artículos), Decreto Ley 1333 de
  1986 y Ley 1819 de 2016 (industria y comercio).
- **Consumo, datos, vivienda y familia:** leyes 294, 675, 820, 1257, 1266, 1273, 1480, 1581, 1751, 2157, 2300, 2439,
  Código Penal (269A a 269J) y Circular 002 de 2024 de la SIC.

El objetivo es toda la legislación colombiana; faltan códigos, reglamentos, jurisprudencia y normas municipales.

- **Normas citadas de afuera:** se entrega su texto oficial, pero no hemos revisado su vigencia.
- **PDF:** un PDF sin transcribir en `datos/ocr/` no entra. La transcripción la hace un modelo: hay que
  revisarla contra la imagen.
- **Vigencia:** la de la fuente al descargarla (nov 2026). Lo que no pudimos confirmar va marcado
  `confirmado: false`, y si la duda es seria el artículo no se vende. Las erratas de la fuente se conservan.
- Los argumentos los escribió una IA sobre el texto del artículo; si difieren, manda el texto.
- Es información de apoyo, **no reemplaza a un abogado**.

Fuentes: [Secretaría del Senado](http://www.secretariasenado.gov.co/) y
[SIC](https://sedeelectronica.sic.gov.co/).
