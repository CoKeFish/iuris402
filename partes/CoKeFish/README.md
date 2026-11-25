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

Respaldo si el LLM no responde: `npm run api:respaldo` (puerto 4022) y `npm run demo:respaldo`.

## Hashes de prueba

Las salidas completas, con tiempos, están en [ENSAYOS.md](ENSAYOS.md).

- [`946bb2e621d8f44058138f9623c620b833fe31d92d0931096faaf5724dc7a3d7`](https://stellar.expert/explorer/testnet/tx/946bb2e621d8f44058138f9623c620b833fe31d92d0931096faaf5724dc7a3d7)
- [`3817cb2e8fbac85fdaad1682ddf2c85cb6755c1aea7d81eb57c4c1885afc94b3`](https://stellar.expert/explorer/testnet/tx/3817cb2e8fbac85fdaad1682ddf2c85cb6755c1aea7d81eb57c4c1885afc94b3)
- [`87ccb89c36cc8f191581f0506b92e225a4206244e4fec5388e48b2ef2804f614`](https://stellar.expert/explorer/testnet/tx/87ccb89c36cc8f191581f0506b92e225a4206244e4fec5388e48b2ef2804f614)
- [`aa328fa43a76c624a5db890d1148f51a724a29fd991e849092629602eed6d369`](https://stellar.expert/explorer/testnet/tx/aa328fa43a76c624a5db890d1148f51a724a29fd991e849092629602eed6d369)
- [`81bf08e3f8f450916ee5d65cc488af6825aeba971539b5ccc303499001679519`](https://stellar.expert/explorer/testnet/tx/81bf08e3f8f450916ee5d65cc488af6825aeba971539b5ccc303499001679519)
- [`ac2d9d2f86eb2d408e09025d4ab714536dcdfef3f6c1ac9b88715b3d19965f69`](https://stellar.expert/explorer/testnet/tx/ac2d9d2f86eb2d408e09025d4ab714536dcdfef3f6c1ac9b88715b3d19965f69)
- [`cb5726fa74f614ae85cf6ba4a5e24d8961d929e59f25983c7d21ceef54a151e6`](https://stellar.expert/explorer/testnet/tx/cb5726fa74f614ae85cf6ba4a5e24d8961d929e59f25983c7d21ceef54a151e6)
- [`4cc7b0233f46f73fe3b1314ba83444538bb133f032838354e78f27006cc81eda`](https://stellar.expert/explorer/testnet/tx/4cc7b0233f46f73fe3b1314ba83444538bb133f032838354e78f27006cc81eda)
