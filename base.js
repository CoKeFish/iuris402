// Las dos bases SQLite (vienen con Node, no hay nada que instalar):
//   datos/leyes.db   la ley. Se genera desde los JSON con `npm run indexar`; si se daña, se rehace.
//   datos/ventas.db  los pagos. NO se puede regenerar: por eso va aparte.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ruta = (r) => fileURLToPath(new URL(r, import.meta.url));
export const LEYES_DB = ruta("./datos/leyes.db");
export const VENTAS_DB = process.env.VENTAS_DB || ruta("./datos/ventas.db");

// Los campos en _json son listas guardadas como JSON
export const ESQUEMA_LEYES = `
CREATE TABLE normas (
  id TEXT PRIMARY KEY, tipo TEXT NOT NULL, nombre TEXT NOT NULL, corto TEXT NOT NULL, anio INTEGER,
  entidad TEXT NOT NULL, metodo TEXT NOT NULL, preambulo TEXT, cierre TEXT
);
CREATE TABLE archivos_crudos (
  id INTEGER PRIMARY KEY, norma_id TEXT NOT NULL REFERENCES normas(id),
  url TEXT NOT NULL UNIQUE, archivo TEXT NOT NULL, formato TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64), descargado TEXT NOT NULL
);
CREATE TABLE articulos (
  id TEXT PRIMARY KEY, norma_id TEXT NOT NULL REFERENCES normas(id),
  archivo_id INTEGER NOT NULL REFERENCES archivos_crudos(id), orden INTEGER NOT NULL,
  articulo TEXT NOT NULL, encabezado TEXT, titulo TEXT, seccion_json TEXT NOT NULL,
  texto TEXT NOT NULL, notas_json TEXT NOT NULL, url TEXT NOT NULL, cita TEXT NOT NULL,
  argumento TEXT NOT NULL DEFAULT '',
  derogado INTEGER NOT NULL CHECK (derogado IN (0, 1)),
  en_venta INTEGER NOT NULL CHECK (en_venta IN (0, 1)),
  -- no rige o está en duda: se encuentra solo para avisarlo, gratis
  aviso INTEGER NOT NULL CHECK (aviso IN (0, 1)),
  CHECK (NOT (derogado AND en_venta)), CHECK (NOT (aviso AND en_venta))
);
-- el resumen solo alimenta el embedding: la API nunca lee esta tabla
CREATE TABLE resumenes (
  articulo_id TEXT PRIMARY KEY REFERENCES articulos(id),
  resumen TEXT NOT NULL, temas_json TEXT NOT NULL, preguntas_json TEXT NOT NULL
);
-- n = 0: el resumen con sus preguntas; n > 0: cada pregunta por separado
CREATE TABLE vectores (
  articulo_id TEXT NOT NULL REFERENCES articulos(id), n INTEGER NOT NULL, modelo TEXT NOT NULL, vector BLOB NOT NULL,
  PRIMARY KEY (articulo_id, n)
);
-- la sentencia o la ley que afecta a un artículo
CREATE TABLE decisiones (
  id TEXT PRIMARY KEY, tipo TEXT NOT NULL, nombre TEXT NOT NULL, entidad TEXT NOT NULL, fecha TEXT NOT NULL,
  -- sin archivo = fallo viejo que no se puede consultar en línea
  ponente TEXT, objeto TEXT, url TEXT, archivo TEXT, sha256 TEXT CHECK (length(sha256) = 64), CHECK ((archivo IS NULL) = (sha256 IS NULL))
);
CREATE TABLE vigencias (
  id INTEGER PRIMARY KEY, decision_id TEXT NOT NULL REFERENCES decisiones(id),
  alcance TEXT NOT NULL, estado TEXT NOT NULL CHECK (estado IN
    ('inexequible', 'derogado', 'subrogado', 'modificado', 'vigente', 'vigencia temporal agotada',
     'exequibilidad condicionada', 'exequibilidad diferida', 'yerro corregido')),
  forma TEXT CHECK (forma IN ('expresa', 'tácita', 'orgánica')),
  -- la materia está regulada hoy por otra disposición
  reemplazo INTEGER NOT NULL CHECK (reemplazo IN (0, 1)),
  decision TEXT, condicion TEXT, razon TEXT, nota TEXT, efecto_desde TEXT, tachado_json TEXT,
  confirmado INTEGER NOT NULL CHECK (confirmado IN (0, 1)),
  CHECK (estado <> 'exequibilidad condicionada' OR condicion IS NOT NULL OR NOT confirmado),
  CHECK (decision IS NOT NULL OR NOT confirmado)
);
-- cada cambio de texto: quién lo hizo, qué decía su norma y con qué objeto (la razón que da la ley)
CREATE TABLE cambios (
  id INTEGER PRIMARY KEY, articulo_id TEXT NOT NULL REFERENCES articulos(id), alcance TEXT NOT NULL,
  cambio TEXT NOT NULL, por TEXT NOT NULL, nota TEXT NOT NULL, texto_del_cambio TEXT, url TEXT, razon TEXT
);
CREATE INDEX cambios_por_articulo ON cambios(articulo_id);
CREATE TABLE vigencia_articulos (
  vigencia_id INTEGER NOT NULL REFERENCES vigencias(id), articulo_id TEXT NOT NULL REFERENCES articulos(id),
  PRIMARY KEY (vigencia_id, articulo_id)
);
CREATE INDEX vigencia_por_articulo ON vigencia_articulos(articulo_id);
-- a dónde apuntan las referencias: un artículo nuestro, una norma nuestra o un texto oficial externo
CREATE TABLE destinos (
  id INTEGER PRIMARY KEY, ref_url TEXT NOT NULL UNIQUE, cita TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('propio', 'norma propia', 'artículo', 'documento', 'no consultable')),
  articulo_id TEXT REFERENCES articulos(id), norma_id TEXT REFERENCES normas(id),
  url TEXT, documento TEXT, entidad TEXT, encabezado TEXT, titulo TEXT, texto TEXT, archivo TEXT,
  sha256 TEXT CHECK (length(sha256) = 64), motivo TEXT,
  CHECK ((tipo = 'propio') = (articulo_id IS NOT NULL)), CHECK ((tipo = 'norma propia') = (norma_id IS NOT NULL)),
  CHECK (tipo <> 'artículo' OR (texto IS NOT NULL AND sha256 IS NOT NULL)),
  CHECK (tipo <> 'documento' OR sha256 IS NOT NULL), CHECK (tipo <> 'no consultable' OR motivo IS NOT NULL)
);
-- "cita": la ley remite a otra. "vigencia": una nota dice quién la modificó o derogó
CREATE TABLE referencias (
  articulo_id TEXT NOT NULL REFERENCES articulos(id), destino_id INTEGER NOT NULL REFERENCES destinos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('cita', 'vigencia')), contexto TEXT NOT NULL, correccion TEXT,
  PRIMARY KEY (articulo_id, destino_id, tipo)
);
CREATE INDEX referencias_por_destino ON referencias(destino_id);
-- búsqueda por palabras: raíces del texto (buscador.js), solo lo que está en venta y sin lo tachado
CREATE VIRTUAL TABLE articulos_fts USING fts5(
  articulo_id UNINDEXED, raices
);
`;

export function abrirLeyes() {
  try {
    return new DatabaseSync(LEYES_DB, { readOnly: true });
  } catch {
    throw new Error("Falta datos/leyes.db. Créala con: npm run indexar");
  }
}

// Un pago guardado permite repetir la respuesta sin cobrar otra vez, aunque la API se reinicie.
// De la firma se guarda solo su huella. La pregunta y la respuesta se borran a las 24 horas.
const HORAS = 24;
export function abrirVentas(archivo = VENTAS_DB) {
  if (archivo !== ":memory:") mkdirSync(dirname(archivo), { recursive: true });
  const db = new DatabaseSync(archivo);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pagos (
      clave TEXT PRIMARY KEY, creado INTEGER NOT NULL, ruta TEXT NOT NULL, transaccion TEXT NOT NULL,
      pagador TEXT, precio TEXT NOT NULL, recibo TEXT NOT NULL, pregunta TEXT, respuesta BLOB
    );
    CREATE INDEX IF NOT EXISTS pagos_creado ON pagos(creado);
    -- cada firma sirve para una sola consulta: la primera que llega a cobrarse
    CREATE TABLE IF NOT EXISTS usos (pago TEXT PRIMARY KEY, clave TEXT NOT NULL, creado INTEGER NOT NULL);
    -- respuestas listas cuyo pago no se confirmó: se entregan si la red dice que se cobró
    CREATE TABLE IF NOT EXISTS pendientes (
      clave TEXT PRIMARY KEY, creado INTEGER NOT NULL, transaccion TEXT, pregunta TEXT NOT NULL, respuesta BLOB NOT NULL
    );
  `);
  const leer = db.prepare("SELECT recibo, respuesta FROM pagos WHERE clave = ? AND creado > ? AND respuesta IS NOT NULL");
  const escribir = db.prepare(
    "INSERT OR IGNORE INTO pagos (clave, creado, ruta, transaccion, pagador, precio, recibo, pregunta, respuesta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const olvidar = db.prepare("UPDATE pagos SET pregunta = NULL, respuesta = NULL WHERE creado <= ? AND respuesta IS NOT NULL");
  const porHash = db.prepare("SELECT 1 FROM pagos WHERE transaccion = ?");
  const usar = db.prepare("INSERT OR IGNORE INTO usos (pago, clave, creado) VALUES (?, ?, ?)");
  const usoDe = db.prepare("SELECT clave FROM usos WHERE pago = ?");
  const olvidarUsos = db.prepare("DELETE FROM usos WHERE creado <= ?");
  const leerPendiente = db.prepare("SELECT transaccion, pregunta, respuesta FROM pendientes WHERE clave = ? AND creado > ?");
  const anotar = db.prepare("INSERT OR REPLACE INTO pendientes (clave, creado, transaccion, pregunta, respuesta) VALUES (?, ?, ?, ?, ?)");
  const quitar = db.prepare("DELETE FROM pendientes WHERE clave = ? OR creado <= ?");
  const limite = () => Date.now() - HORAS * 3_600_000;
  return {
    buscar: (clave) => leer.get(clave, limite()),
    guardar(p) {
      olvidar.run(limite());
      olvidarUsos.run(limite());
      escribir.run(p.clave, Date.now(), p.ruta, p.transaccion, p.pagador ?? null, p.precio, p.recibo, p.pregunta, p.respuesta);
    },
    pendiente: (clave) => leerPendiente.get(clave, limite()),
    ligar(pago, clave) {
      usar.run(pago, clave, Date.now());
      return usoDe.get(pago).clave === clave;
    },
    usada: (transaccion) => Boolean(porHash.get(transaccion)),
    anotarPendiente: (p) => anotar.run(p.clave, Date.now(), p.transaccion || null, p.pregunta, p.respuesta),
    quitarPendiente: (clave) => quitar.run(clave, limite()),
    cerrar: () => db.close(),
    db,
  };
}
