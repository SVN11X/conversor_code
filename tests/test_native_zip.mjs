import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
await import(path.join(root, "assets", "native-zip.js"));

const archivePath = process.argv[2];
const mode = process.argv[3] || "standard";
if (!archivePath) throw new Error("Uso: node tests/test_native_zip.mjs archivo.zip [standard|zip64]");
const bytes = fs.readFileSync(archivePath);
const reader = new globalThis.Code2TextZip.NativeZipReader(new Blob([bytes]));
const extracted = new Map();
for await (const entry of reader.entries()) {
  if (entry.directory) continue;
  extracted.set(entry.filename, new TextDecoder().decode(await entry.getUint8Array()));
}
await reader.close();

const expected = mode === "zip64"
  ? new Map([["zip64/archivo.txt", "contenido ZIP64 pequeño"]])
  : new Map([
      ["hello.txt", "hola mundo"],
      ["folder/stored.txt", "sin comprimir"],
      ["carpeta/ñandú.md", "# título\ncontenido"],
      ["empty.txt", ""]
    ]);
for (const [name, content] of expected) {
  if (!extracted.has(name)) throw new Error(`No se encontró ${name}`);
  if (extracted.get(name) !== content) throw new Error(`Contenido incorrecto en ${name}`);
}
if (extracted.size !== expected.size) throw new Error(`Cantidad inesperada de archivos: ${extracted.size}`);
console.log(mode === "zip64"
  ? "OK: lector ZIP local extrajo un archivo ZIP64"
  : "OK: lector ZIP local extrajo STORE, DEFLATE, UTF-8 y archivo vacío");
