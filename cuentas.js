// Deja listas las dos cuentas de testnet (la que cobra y la del agente): las crea y fondea con
// Friendbot si no están en .env, y les abre la trustline de USDC. Lo que ya existe no se repite.
// Uso: npm run cuentas
import { BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { FRIENDBOT_URL, PASSPHRASE, RUTA_ENV, UNIDADES, USDC, horizon, saldoUSDC } from "./comun.js";

const ejemplo = new URL("./.env.example", import.meta.url);
if (!existsSync(RUTA_ENV)) writeFileSync(RUTA_ENV, readFileSync(ejemplo));

// Cambia la línea si existe (p. ej. "AGENTE_SECRET=S..."), o la agrega
function guardar(nombre, valor) {
  const lineas = readFileSync(RUTA_ENV, "utf8").split(/\r?\n/);
  const i = lineas.findIndex((l) => l.startsWith(`${nombre}=`));
  if (i >= 0) lineas[i] = `${nombre}=${valor}`;
  else lineas.push(`${nombre}=${valor}`);
  writeFileSync(RUTA_ENV, lineas.join("\n"));
}

for (const rol of ["COBRADOR", "AGENTE"]) {
  const secreta = process.env[`${rol}_SECRET`];
  const existe = secreta && !secreta.endsWith("...");
  const par = existe ? Keypair.fromSecret(secreta) : Keypair.random();
  if (!existe) {
    const publica = process.env[`${rol}_PUBLIC`];
    if (publica && !publica.endsWith("...")) {
      console.log(`${rol}: usa la cuenta que ya está en .env (${publica}); su trustline debe estar abierta`);
      continue;
    }
    const r = await fetch(`${FRIENDBOT_URL}?addr=${par.publicKey()}`);
    if (!r.ok) throw new Error(`Friendbot falló para ${rol}: ${r.status}`);
    guardar(`${rol}_SECRET`, par.secret());
    guardar(`${rol}_PUBLIC`, par.publicKey());
  }
  const cuenta = await horizon.loadAccount(par.publicKey());
  if (!cuenta.balances.some((b) => b.asset_code === USDC.code && b.asset_issuer === USDC.issuer)) {
    const tx = new TransactionBuilder(cuenta, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(60)
      .build();
    tx.sign(par);
    await horizon.submitTransaction(tx);
  }
  console.log(`${rol}: ${par.publicKey()} · trustline lista · ${(await saldoUSDC(par.publicKey())) / UNIDADES} USDC`);
}
console.log("\nUSDC de prueba para el AGENTE: https://faucet.circle.com (red Stellar Testnet, pega la cuenta del AGENTE).");
