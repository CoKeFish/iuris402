# Pitch (5 minutos)

Preparado antes de empezar: terminal 1 con `npm run api` encendida, terminal 2 con el comando del demo escrito sin dar Enter,
terminal 3 con `npm run api:respaldo` y Stellar Expert abierto en el navegador. Media hora antes, correr el demo una vez.

## 0:00 – 0:45 · El problema

> «A alguien le escriben un domingo para cobrarle una deuda y le pregunta a su asistente de IA si eso se puede. La IA responde segura, y a veces cita
> una ley que no existe o un artículo derogado. La ley es pública, pero está en páginas y PDF escaneados que un agente no lee
> bien. Y las bases jurídicas se venden por suscripción a personas: un agente no llena formularios ni firma contratos.»

## 0:45 – 1:15 · Para quién y por qué pagar por uso

> «Iuris402 es para quien construye agentes que tocan derechos de la gente. Leer la ley es gratis; se paga por encontrar cuál
> aplica, con su vigencia y su fuente oficial. Dos centavos por consulta, con x402 en Stellar. Si no hay respuesta, no cobra.»

## 1:15 – 2:45 · Demo en vivo

```
npm run demo -- "¿me pueden cobrar una deuda por WhatsApp un domingo?"
```

Tarda unos 30 segundos. Se lee cada paso a medida que sale:

| Sale en pantalla | Se dice |
|---|---|
| `Pedir sin pagar: 402` | «Sin pago no hay respuesta: dice cuánto, en qué red y a qué cuenta.» |
| `Tope excedido: rechazado` | «Un agente con tope de medio centavo ni siquiera firma.» |
| `Pagar y pedir: 200` (unos 15 s) | «Firma, paga 0.02 USDC y recibe la Ley 2300 de 2023, artículo 3, con su texto, su vigencia y su fuente: el domingo no. Un LLM entiende la pregunta y otro elige entre lo que encontró la búsqueda.» |
| `✅ verificado en la red` | «No le creemos a la API: buscamos en Stellar esa transferencia, por su nonce.» |
| `Reenviar el mismo pago: 200 · 0 USDC` | «Si se cae la conexión, la misma firma devuelve lo mismo, sin cobrar otra vez.» |
| `Preguntar algo que no es derecho: 404 · 0 USDC` | «Una receta de lasaña: 404, y la red confirma que no se cobró.» |

Si al minuto no ha pagado (el LLM no responde: 503 y no cobra), Ctrl+C y: `npm run demo:respaldo -- "¿me pueden cobrar una deuda por WhatsApp un domingo?"`
(sin LLM el artículo 3 puede salir de segundo: se dice «la Ley 2300» y no se menciona el LLM).

## 2:45 – 3:30 · La evidencia

Abrir en Stellar Expert el enlace que imprimió el demo: USDC de testnet, 0.02, de la cuenta del agente a la de la API. El facilitador paga la comisión.

## 3:30 – 4:15 · Qué pasa cuando algo falla

> «Probamos contra el facilitador real una firma alterada, una por menos monto, una para otra cuenta y una para otra red: ninguna pasó y
> en la red no se movió nada. Y si la red se demora y nadie sabe si se pagó, la API guarda la respuesta y la entrega cuando
> la red muestra el pago; el agente no firma dos veces.»

## 4:15 – 4:45 · Qué tan bien responde

> «Otro modelo escribió treinta preguntas que reservamos. En veintiséis salió de primero un artículo esencial y la respuesta traía
> todo lo necesario. De quince que no debíamos cobrar, cobramos una. Las preguntas y los resultados están en el repositorio.»

## 4:45 – 5:00 · Qué sigue

> «Más normas, jurisprudencia, y anunciarla para que los agentes la descubran solos. Eso es Iuris402.»
