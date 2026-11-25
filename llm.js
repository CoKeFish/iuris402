// Un LLM intercambiable: recibe el encargo por stdin y responde por stdout. Devuelve el primer
// objeto JSON completo de la respuesta, o null si falla o tarda.
//   claude -p --model haiku --tools "" --strict-mcp-config
import { spawn, spawnSync } from "node:child_process";

// El primer objeto que abre y cierra bien y se puede leer, aunque haya texto alrededor
export function primerJson(s) {
  for (let i = s.indexOf("{"); i >= 0; i = s.indexOf("{", i + 1)) {
    let nivel = 0, cadena = false, escape = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') cadena = !cadena;
      else if (!cadena && c === "{") nivel++;
      else if (!cadena && c === "}" && --nivel === 0) {
        try {
          return JSON.parse(s.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

// En Windows la consola lanza otro proceso: hay que cerrar el árbol, o sigue gastando
function cerrar(p) {
  if (process.platform === "win32" && p.pid) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  else p.kill();
}

export function pedirJson(cmd, encargo, espera = 25_000, senal) {
  return new Promise((ok) => {
    const p = spawn(cmd, { shell: true, stdio: ["pipe", "pipe", "ignore"] });
    let salida = "";
    const reloj = setTimeout(() => {
      ok(null);
      cerrar(p);
    }, espera);
    senal?.addEventListener("abort", () => {
      clearTimeout(reloj);
      ok(null);
      cerrar(p);
    });
    p.stdout.setEncoding("utf8").on("data", (d) => (salida = (salida + d).slice(-20_000)));
    p.on("error", () => {
      clearTimeout(reloj);
      ok(null);
    });
    p.on("close", (c) => {
      clearTimeout(reloj);
      ok(c === 0 ? primerJson(salida) : null);
    });
    p.stdin.on("error", () => {});
    p.stdin.end(encargo);
  });
}

// Si el primero falla o tarda más de «relevo», se lanza otro en paralelo: vale la primera respuesta
// útil y el que sobra se cierra. pedir(senal) → respuesta, o null si no sirve.
export function conRelevo(pedir, relevo) {
  return new Promise((ok) => {
    const corta = new AbortController();
    let lanzados = 0, vivos = 0;
    const lanzar = () => {
      if (lanzados === 2) return;
      lanzados++;
      vivos++;
      pedir(corta.signal)
        .catch(() => null)
        .then((r) => {
          vivos--;
          if (corta.signal.aborted) return;
          if (r) {
            clearTimeout(reloj);
            corta.abort();
            ok(r);
          } else if (lanzados < 2) lanzar();
          else if (!vivos) ok(null);
        });
    };
    const reloj = setTimeout(lanzar, relevo);
    lanzar();
  });
}
