// Configuración compartida. Todo corre en la testnet de Stellar.
import dotenv from "dotenv";
import { Asset, Horizon, Networks } from "@stellar/stellar-sdk";
import { fileURLToPath } from "node:url";

export const RUTA_ENV = fileURLToPath(new URL("./.env", import.meta.url));
dotenv.config({ path: RUTA_ENV, quiet: true });

export const RED = "stellar:testnet";
export const PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";
export const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

// USDC de prueba: emisor G… (trustline) y su contrato C… (lo que mueve x402)
export const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
export const USDC_CONTRATO = USDC.contractId(PASSPHRASE);
export const UNIDADES = 1e7; // USDC en Stellar usa 7 decimales

export const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://www.x402.org/facilitator";
export const API_URL = process.env.API_URL || "http://localhost:4021";
export const PRECIO_BUSCAR = process.env.PRECIO_BUSCAR || "$0.01";
export const PRECIO_ASESORIA = process.env.PRECIO_ASESORIA || "$0.02";

export function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor || valor.endsWith("...")) {
    console.error(`Falta ${nombre} en .env (mira .env.example)`);
    process.exit(1);
  }
  return valor;
}

export const enlaceTx = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

export async function saldoUSDC(publica) {
  const cuenta = await horizon.loadAccount(publica);
  const linea = cuenta.balances.find((b) => b.asset_code === USDC.code && b.asset_issuer === USDC.issuer);
  return Math.round(Number(linea?.balance ?? 0) * UNIDADES);
}
