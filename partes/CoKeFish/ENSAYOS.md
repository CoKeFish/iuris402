# Ensayos del demo (24 de noviembre de 2026, hora de Bogotá)

En el PC del equipo, con la base completa, los dos LLM y el facilitador real de testnet. En todos: 402 sin pagar, tope
excedido rechazado sin firmar, pago verificado en la red, reenvío con la misma respuesta y sin cobro, y pregunta ajena sin cobro.

## Versión final: cinco corridas seguidas

| Hora | Pagar y pedir | Pregunta ajena | Total | Hash | Nota |
|---|---|---|---|---|---|
| 21:44:20 | 200 en 18.4 s | 404 | 28.4 s | [`d250ca94…`](https://stellar.expert/explorer/testnet/tx/d250ca94274588f3c8b01af0ded070661668e0d45d18a828708004658fd7ae2d) |  |
| 21:44:50 | 200 en 12.9 s | 404 | 23.0 s | [`b0e7028f…`](https://stellar.expert/explorer/testnet/tx/b0e7028f63faafdef76faa0f11bd80473a1fcc991e6cc96bbf847678b8c2fd49) |  |
| 21:45:14 | 200 en 18.3 s | 404 | 29.2 s | [`a13b4a4e…`](https://stellar.expert/explorer/testnet/tx/a13b4a4e648b3d3124a1af0f762d811317edd531d7fcf38be953e74edcef5fcc) |  |
| 21:45:45 | 200 en 12.5 s | 404 | 22.5 s | [`bc576389…`](https://stellar.expert/explorer/testnet/tx/bc576389f528c53ac5dcf98f82552bf6bdafae3fd28a5089f9e7d72fe5081c5b) |  |
| 21:46:09 | 200 en 12.9 s | 404 | 24.0 s | [`498ad2af…`](https://stellar.expert/explorer/testnet/tx/498ad2af5314e1681917c0b667dd1ed2e14165c015327a63c8e68535a71bc8d8) |  |

## Antes, sin `MAX_THINKING_TOKENS=0`: siete corridas seguidas

| Hora | Pagar y pedir | Pregunta ajena | Total | Hash | Nota |
|---|---|---|---|---|---|
| 21:39:41 | 200 en 17 s | 404 | 27.4 s | [`c0916a1b…`](https://stellar.expert/explorer/testnet/tx/c0916a1b40c89484a77d5f49c6a66fe4dc4814d87bbde8fc9a49f17ddf0c7ba4) |  |
| 21:40:10 | 200 en 17 s | 404 | 27.7 s | [`c0192f85…`](https://stellar.expert/explorer/testnet/tx/c0192f8558a9f69e04aee6d904a01f1eed2b6243fb7712ad0e480e87bc9d2f47) |  |
| 21:40:39 | 200 en 18.7 s | 404 | 27.4 s | [`1223da56…`](https://stellar.expert/explorer/testnet/tx/1223da5615a7ae0b9af42599bb31efe329501ff4285f70a7df058c24d54ca38e) |  |
| 21:41:08 | 200 en 15 s | 404 | 23.9 s | [`74207d40…`](https://stellar.expert/explorer/testnet/tx/74207d40123774119377bc80592e971a35744876ed9fdcfa147a012f4cee8caf) |  |
| 21:41:33 | 200 en 19.2 s | 404 | 30.5 s | [`7d885330…`](https://stellar.expert/explorer/testnet/tx/7d8853308d910ea3c0dbc2a8b3145551beedabc1331ae21dfba02d568840248f) |  |
| 21:42:05 | 200 en 21.6 s | 404 | 30.7 s | [`c6053d25…`](https://stellar.expert/explorer/testnet/tx/c6053d2563f3c225cb729c5e430d9f0d05cb341ff141843b912ccc7c1fe58f28) |  |
| 21:42:38 | 200 en 15.4 s | 404 | 24.8 s | [`c252b923…`](https://stellar.expert/explorer/testnet/tx/c252b9234368a8eb16a0a38cf7b27ac789dd5da8923e73f89a568b715d6b5460) |  |

## Antes de agregar el relevo del LLM

El LLM se quedó pegado en dos de las cinco (503, sin cobro). Por eso ahora, si tarda, se lanza otro y vale el primero que conteste.

| Hora | Pagar y pedir | Pregunta ajena | Total | Hash | Nota |
|---|---|---|---|---|---|
| 21:36:39 | 200 en 18.5 s | 404 | 22.7 s | [`88325ef5…`](https://stellar.expert/explorer/testnet/tx/88325ef519079697474f1523e5dffa179c305b398aa0c7bd77b570c94540106c) |  |
| 21:37:04 | 200 en 39.5 s | 404 | 43.5 s | [`02a1dfde…`](https://stellar.expert/explorer/testnet/tx/02a1dfdef93af25f63e00e05855f50e1349fe230a02e6b5b5c5ca07ada37100e) | un 503 reintentado con la misma firma |
| 21:37:49 | 200 en 14.2 s | 503 | 36.7 s | [`5b31d7cd…`](https://stellar.expert/explorer/testnet/tx/5b31d7cd4bd4f6508f573d319bc6b5a519bc64e82c6c84e159338dc966a56a00) |  |
| 21:38:27 | 200 en 10.7 s | 404 | 14.2 s | [`b21a58f2…`](https://stellar.expert/explorer/testnet/tx/b21a58f2bfebc76bd61f78c0c3d522205cf4f2cdb2eac50c30f1377a223158bf) |  |
| 21:38:43 | 200 en 15 s | 404 | 19.3 s | [`aed464b0…`](https://stellar.expert/explorer/testnet/tx/aed464b0a94cae94128406a6fed9b48389d1a230cf85cca1c54f0caafcebd413) |  |

## Pagos que no deben servir (`npm run pagos-malos`, facilitador real)

```
✅ rechazado · Encabezado ilegible: 402 Payment required
✅ rechazado · Firma alterada: 402 invalid_exact_stellar_payload_simulation_failed
✅ rechazado · Firma por menos monto: 402 invalid_exact_stellar_payload_wrong_amount
✅ rechazado · Firma para otra cuenta: 402 invalid_exact_stellar_payload_wrong_recipient
✅ rechazado · Dice otra red: 402 No matching payment requirements
En la red desde que empezó: 0 transferencias · 0 USDC
```

## Saldo insuficiente (API con precio de 100 USDC, agente con 19.68)

```
precio 100 USDC · saldo 19.68 · tope $200
⛔ Saldo insuficiente. No se firmó nada.
```

## Respaldo sin LLM (`npm run api -- --sin-llm` y `npm run demo -- --respaldo`)

```
❓ ¿me pueden cobrar una deuda por WhatsApp un domingo?
   paga GB2RPFNLNBABHBLSQ6U6YLDKPN6AKRBPI3SUYAT2DJVAZX47SBV3ZPRM
   USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, contrato CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

▶ Pedir sin pagar: 402 · 0 s
  pide 0.02 USDC en stellar:testnet, para GDT5GFJYQW6LTJ7QGZIBURBV3DRLL37DOMT7TRLOSGO7KHFKD424DAU2

▶ Tope excedido: rechazado · gastado en la red 0 USDC · 0.1 s
  cuesta más que $0.005: no se firmó nada

▶ Pagar y pedir: 200 · gastado en la red 0.02 USDC · 8.5 s
  Ley 2300 de 2023, art. 2 · Ley 2300 de 2023, art. 3 · Código Sustantivo del Trabajo, art. 185 · Ley 2300 de 2023, art. 8 · Ley 2300 de 2023, art. 5 · Código Sustantivo del Trabajo, art. 179 · Código Sustantivo del Trabajo, art. 173 · Ley 2300 de 2023, art. 4 · Ley 2300 de 2023, art. 6 · Código Sustantivo del Trabajo, art. 176
  ✅ verificado en la red (USDC, cuentas, monto y nonce)
  https://stellar.expert/explorer/testnet/tx/b55b22a3521a38f6eb61cb214c010e21ffe8aff25ea24e1dadf1adc566761042

▶ Reenviar el mismo pago: 200 · gastado en la red 0 USDC · 0.2 s
  la misma respuesta, sin-cobro

▶ Preguntar algo que no es derecho: 404 · gastado en la red 0 USDC · 6.8 s
  No se hallaron disposiciones aplicables en la base. No se generó cobro.

Total: 15.6 s · 0.02 USDC
```

## Salida completa de la versión final

### Corrida 1 · 2026-11-24 21:44:20 (Bogotá)

```
❓ ¿me pueden cobrar una deuda por WhatsApp un domingo?
   paga GB2RPFNLNBABHBLSQ6U6YLDKPN6AKRBPI3SUYAT2DJVAZX47SBV3ZPRM
   USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, contrato CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

▶ Pedir sin pagar: 402 · 0 s
  pide 0.02 USDC en stellar:testnet, para GDT5GFJYQW6LTJ7QGZIBURBV3DRLL37DOMT7TRLOSGO7KHFKD424DAU2

▶ Tope excedido: rechazado · gastado en la red 0 USDC · 0.1 s
  cuesta más que $0.005: no se firmó nada

▶ Pagar y pedir: 200 · gastado en la red 0.02 USDC · 18.4 s
  Ley 2300 de 2023, art. 3 · Ley 2300 de 2023, art. 2 · Ley 2300 de 2023, art. 1
  ✅ verificado en la red (USDC, cuentas, monto y nonce)
  https://stellar.expert/explorer/testnet/tx/d250ca94274588f3c8b01af0ded070661668e0d45d18a828708004658fd7ae2d

▶ Reenviar el mismo pago: 200 · gastado en la red 0 USDC · 0.3 s
  la misma respuesta, sin-cobro

▶ Preguntar algo que no es derecho: 404 · gastado en la red 0 USDC · 9.6 s
  La consulta no versa sobre una materia jurídica. No se generó cobro.

Total: 28.4 s · 0.02 USDC
```

### Corrida 2 · 2026-11-24 21:44:50 (Bogotá)

```
❓ compré por internet y me arrepentí, ¿lo puedo devolver?
   paga GB2RPFNLNBABHBLSQ6U6YLDKPN6AKRBPI3SUYAT2DJVAZX47SBV3ZPRM
   USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, contrato CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

▶ Pedir sin pagar: 402 · 0 s
  pide 0.02 USDC en stellar:testnet, para GDT5GFJYQW6LTJ7QGZIBURBV3DRLL37DOMT7TRLOSGO7KHFKD424DAU2

▶ Tope excedido: rechazado · gastado en la red 0 USDC · 0.1 s
  cuesta más que $0.005: no se firmó nada

▶ Pagar y pedir: 200 · gastado en la red 0.02 USDC · 12.9 s
  Ley 1480 de 2011, art. 47 · Ley 1480 de 2011, art. 46 · Ley 2439 de 2024, art. 5 · Ley 1480 de 2011, art. 50
  ✅ verificado en la red (USDC, cuentas, monto y nonce)
  https://stellar.expert/explorer/testnet/tx/b0e7028f63faafdef76faa0f11bd80473a1fcc991e6cc96bbf847678b8c2fd49

▶ Reenviar el mismo pago: 200 · gastado en la red 0 USDC · 0.3 s
  la misma respuesta, sin-cobro

▶ Preguntar algo que no es derecho: 404 · gastado en la red 0 USDC · 9.7 s
  La consulta no versa sobre una materia jurídica. No se generó cobro.

Total: 23.0 s · 0.02 USDC
```

### Corrida 3 · 2026-11-24 21:45:14 (Bogotá)

```
❓ quiero abrir una tienda, ¿tengo que registrarla en cámara de comercio y qué pasa si no?
   paga GB2RPFNLNBABHBLSQ6U6YLDKPN6AKRBPI3SUYAT2DJVAZX47SBV3ZPRM
   USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, contrato CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

▶ Pedir sin pagar: 402 · 0 s
  pide 0.02 USDC en stellar:testnet, para GDT5GFJYQW6LTJ7QGZIBURBV3DRLL37DOMT7TRLOSGO7KHFKD424DAU2

▶ Tope excedido: rechazado · gastado en la red 0 USDC · 0.1 s
  cuesta más que $0.005: no se firmó nada

▶ Pagar y pedir: 200 · gastado en la red 0.02 USDC · 18.3 s
  Código de Comercio, art. 28 · Código de Comercio, art. 19 · Código de Comercio, art. 31 · Código de Comercio, art. 37 · Código de Comercio, art. 13 · Código de Comercio, art. 29
  ✅ verificado en la red (USDC, cuentas, monto y nonce)
  https://stellar.expert/explorer/testnet/tx/a13b4a4e648b3d3124a1af0f762d811317edd531d7fcf38be953e74edcef5fcc

▶ Reenviar el mismo pago: 200 · gastado en la red 0 USDC · 0.3 s
  la misma respuesta, sin-cobro

▶ Preguntar algo que no es derecho: 404 · gastado en la red 0 USDC · 10.5 s
  La consulta no versa sobre una materia jurídica. No se generó cobro.

Total: 29.2 s · 0.02 USDC
```

### Corrida 4 · 2026-11-24 21:45:45 (Bogotá)

```
❓ me echaron sin justa causa, ¿qué indemnización me toca?
   paga GB2RPFNLNBABHBLSQ6U6YLDKPN6AKRBPI3SUYAT2DJVAZX47SBV3ZPRM
   USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, contrato CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

▶ Pedir sin pagar: 402 · 0 s
  pide 0.02 USDC en stellar:testnet, para GDT5GFJYQW6LTJ7QGZIBURBV3DRLL37DOMT7TRLOSGO7KHFKD424DAU2

▶ Tope excedido: rechazado · gastado en la red 0 USDC · 0.2 s
  cuesta más que $0.005: no se firmó nada

▶ Pagar y pedir: 200 · gastado en la red 0.02 USDC · 12.5 s
  Código Sustantivo del Trabajo, art. 64
  ✅ verificado en la red (USDC, cuentas, monto y nonce)
  https://stellar.expert/explorer/testnet/tx/bc576389f528c53ac5dcf98f82552bf6bdafae3fd28a5089f9e7d72fe5081c5b

▶ Reenviar el mismo pago: 200 · gastado en la red 0 USDC · 0.2 s
  la misma respuesta, sin-cobro

▶ Preguntar algo que no es derecho: 404 · gastado en la red 0 USDC · 9.6 s
  La consulta no versa sobre una materia jurídica. No se generó cobro.

Total: 22.5 s · 0.02 USDC
```

### Corrida 5 · 2026-11-24 21:46:09 (Bogotá)

```
❓ mi arrendador me quiere subir el arriendo más que la inflación, ¿puede?
   paga GB2RPFNLNBABHBLSQ6U6YLDKPN6AKRBPI3SUYAT2DJVAZX47SBV3ZPRM
   USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, contrato CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

▶ Pedir sin pagar: 402 · 0 s
  pide 0.02 USDC en stellar:testnet, para GDT5GFJYQW6LTJ7QGZIBURBV3DRLL37DOMT7TRLOSGO7KHFKD424DAU2

▶ Tope excedido: rechazado · gastado en la red 0 USDC · 0.2 s
  cuesta más que $0.005: no se firmó nada

▶ Pagar y pedir: 200 · gastado en la red 0.02 USDC · 12.9 s
  Ley 820 de 2003, art. 20 · Ley 820 de 2003, art. 18 · Ley 820 de 2003, art. 33
  ✅ verificado en la red (USDC, cuentas, monto y nonce)
  https://stellar.expert/explorer/testnet/tx/498ad2af5314e1681917c0b667dd1ed2e14165c015327a63c8e68535a71bc8d8

▶ Reenviar el mismo pago: 200 · gastado en la red 0 USDC · 0.3 s
  la misma respuesta, sin-cobro

▶ Preguntar algo que no es derecho: 404 · gastado en la red 0 USDC · 10.6 s
  La consulta no versa sobre una materia jurídica. No se generó cobro.

Total: 24.0 s · 0.02 USDC
```
