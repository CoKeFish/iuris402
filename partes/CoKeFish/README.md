# Parte de CoKeFish: recorrido del Demo Day

Muestra en vivo que Iuris402 cobra por x402 y no cobra de más: pide sin pagar (402), un tope más bajo que el precio no
firma, paga 0.02 USDC y recibe (200), **comprueba el pago en la red**, reenvía el mismo pago (no cobra otra vez) y
pregunta algo que no es derecho (404, no cobra). Lo gastado no lo dice la API: lo dice la red.

## Cómo correr mi parte

Con las cuentas listas (ver «Uso» en el [README](../../README.md)); igual en bash y PowerShell:

```bash
npm run api                     # terminal 1
npm run demo                    # terminal 2: "compré por internet y me arrepentí, ¿lo puedo devolver?" (sale con la muestra)
npm run demo -- "¿me pueden cobrar una deuda por WhatsApp un domingo?"    # necesita la base completa
npm run pagos-malos             # ilegible, firma alterada, menos monto, otra cuenta, otra red: ninguno entrega ni cobra
npm test                        # incluye partes/CoKeFish/demo.test.js
```

Respaldo si el LLM no responde: `npm run api -- --sin-llm` (puerto 4022) y `npm run demo -- --respaldo`.

## Hashes de prueba

Las salidas completas, con tiempos, están en [ENSAYOS.md](ENSAYOS.md).

- [`d250ca94274588f3c8b01af0ded070661668e0d45d18a828708004658fd7ae2d`](https://stellar.expert/explorer/testnet/tx/d250ca94274588f3c8b01af0ded070661668e0d45d18a828708004658fd7ae2d)
- [`b0e7028f63faafdef76faa0f11bd80473a1fcc991e6cc96bbf847678b8c2fd49`](https://stellar.expert/explorer/testnet/tx/b0e7028f63faafdef76faa0f11bd80473a1fcc991e6cc96bbf847678b8c2fd49)
- [`a13b4a4e648b3d3124a1af0f762d811317edd531d7fcf38be953e74edcef5fcc`](https://stellar.expert/explorer/testnet/tx/a13b4a4e648b3d3124a1af0f762d811317edd531d7fcf38be953e74edcef5fcc)
- [`bc576389f528c53ac5dcf98f82552bf6bdafae3fd28a5089f9e7d72fe5081c5b`](https://stellar.expert/explorer/testnet/tx/bc576389f528c53ac5dcf98f82552bf6bdafae3fd28a5089f9e7d72fe5081c5b)
- [`498ad2af5314e1681917c0b667dd1ed2e14165c015327a63c8e68535a71bc8d8`](https://stellar.expert/explorer/testnet/tx/498ad2af5314e1681917c0b667dd1ed2e14165c015327a63c8e68535a71bc8d8)
