# Parte de CoKeFish: recorrido del Demo Day

Muestra en vivo que Iuris402 cobra por x402 y no cobra de más: pide sin pagar (402), paga 0.02 USDC y recibe
(200), reenvía el mismo pago (no cobra otra vez) y pregunta algo que no es derecho (404, no cobra).

## Cómo correr mi parte

```bash
npm run api                                   # terminal 1
node partes/CoKeFish/demo.js "quiero abrir una tienda, ¿tengo que registrarla en cámara de comercio y qué pasa si no?"   # terminal 2
TOPE='$0.005' node partes/CoKeFish/demo.js    # cuesta más que el tope: no firma nada
npm test                                      # incluye partes/CoKeFish/demo.test.js
```

## Hash de prueba

- `fd6cace64c8174be4470fea540f635d493464310563e4440a73f2def4958fc67`
- Verlo: https://stellar.expert/explorer/testnet/tx/fd6cace64c8174be4470fea540f635d493464310563e4440a73f2def4958fc67
