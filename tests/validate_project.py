from __future__ import annotations

import py_compile
import shutil
import struct
import subprocess
import tempfile
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
BACKEND = ROOT / "backend" / "app.py"
NATIVE_ZIP = ROOT / "assets" / "native-zip.js"
LOCAL_JSZIP = ROOT / "assets" / "jszip.min.js"
JSZIP_LICENSE = ROOT / "assets" / "JSZIP-LICENSE.md"
NATIVE_ZIP_TEST = ROOT / "tests" / "test_native_zip.mjs"


def main() -> None:
    html = INDEX.read_text(encoding="utf-8")
    required = [
        "Code2TextZip.NativeZipReader", "reader.entries", "getUint8Array",
        "FileSystemSink", "showSaveFilePicker", "streamLargeText", "JSZip",
        "XLSX", "mammoth", "pdfjsLib", "extractWord", "extractSpreadsheet",
        "extractPowerPoint", "extractPdf", "extractVisio", "/api/extract",
        "./assets/native-zip.js", "./assets/jszip.min.js",
    ]
    missing = [token for token in required if token not in html]
    if missing:
        raise SystemExit(f"Faltan componentes en index.html: {', '.join(missing)}")

    forbidden = [
        "const MAX_FILE_BYTES = 150 * 1024 * 1024", "JSZip.loadAsync(file)",
        "const extracted = []", "new Blob([content]",
        "cdn.jsdelivr.net/npm/@zip.js/zip.js", "zip-web-worker.js",
    ]
    reintroduced = [token for token in forbidden if token in html]
    if reintroduced:
        raise SystemExit(f"Se reintrodujeron patrones no escalables: {', '.join(reintroduced)}")

    for asset in (NATIVE_ZIP, LOCAL_JSZIP, JSZIP_LICENSE, NATIVE_ZIP_TEST):
        if not asset.is_file() or asset.stat().st_size == 0:
            raise SystemExit(f"Falta el recurso local requerido: {asset.relative_to(ROOT)}")

    native_text = NATIVE_ZIP.read_text(encoding="utf-8")
    native_required = [
        "class NativeZipReader", "class NativeZipEntry", "SIG_ZIP64_EOCD",
        "DecompressionStream", "deflate-raw", "CENTRAL_CHUNK",
    ]
    native_missing = [token for token in native_required if token not in native_text]
    if native_missing:
        raise SystemExit(f"Faltan componentes en el lector ZIP local: {', '.join(native_missing)}")

    start = html.rfind("<script>")
    end = html.rfind("</script>")
    if start < 0 or end < start:
        raise SystemExit("No se encontró el script principal.")
    javascript = html[start + len("<script>") : end]

    node = shutil.which("node")
    if node:
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as temp:
            temp.write(javascript)
            temp_path = Path(temp.name)
        try:
            subprocess.run([node, "--check", str(temp_path)], check=True)
            subprocess.run([node, "--check", str(NATIVE_ZIP)], check=True)
            with tempfile.TemporaryDirectory() as tmp_dir:
                archive = Path(tmp_dir) / "native-reader-test.zip"
                with zipfile.ZipFile(archive, "w") as zf:
                    zf.writestr("hello.txt", "hola mundo", compress_type=zipfile.ZIP_DEFLATED)
                    zf.writestr("folder/stored.txt", "sin comprimir", compress_type=zipfile.ZIP_STORED)
                    zf.writestr("carpeta/ñandú.md", "# título\ncontenido", compress_type=zipfile.ZIP_DEFLATED)
                    zf.writestr("empty.txt", "", compress_type=zipfile.ZIP_DEFLATED)
                    zf.writestr("folder/", "", compress_type=zipfile.ZIP_STORED)
                subprocess.run([node, str(NATIVE_ZIP_TEST), str(archive)], check=True)

                zip64_archive = Path(tmp_dir) / "native-reader-zip64.zip"
                name = "zip64/archivo.txt".encode("utf-8")
                data = "contenido ZIP64 pequeño".encode("utf-8")
                crc = zlib.crc32(data) & 0xFFFFFFFF
                local_extra = struct.pack("<HHQQ", 0x0001, 16, len(data), len(data))
                local = (
                    struct.pack(
                        "<IHHHHHIIIHH", 0x04034B50, 45, 0x0800, 0, 0, 0, crc,
                        0xFFFFFFFF, 0xFFFFFFFF, len(name), len(local_extra),
                    ) + name + local_extra + data
                )
                central_offset = len(local)
                central_extra = struct.pack("<HHQQQ", 0x0001, 24, len(data), len(data), 0)
                central = (
                    struct.pack(
                        "<IHHHHHHIIIHHHHHII", 0x02014B50, 0x033F, 45, 0x0800,
                        0, 0, 0, crc, 0xFFFFFFFF, 0xFFFFFFFF, len(name),
                        len(central_extra), 0, 0, 0, 0, 0xFFFFFFFF,
                    ) + name + central_extra
                )
                zip64_eocd_offset = central_offset + len(central)
                zip64_eocd = struct.pack(
                    "<IQHHIIQQQQ", 0x06064B50, 44, 45, 45, 0, 0, 1, 1,
                    len(central), central_offset,
                )
                locator = struct.pack("<IIQI", 0x07064B50, 0, zip64_eocd_offset, 1)
                eocd = struct.pack(
                    "<IHHHHIIH", 0x06054B50, 0, 0, 0xFFFF, 0xFFFF,
                    0xFFFFFFFF, 0xFFFFFFFF, 0,
                )
                zip64_archive.write_bytes(local + central + zip64_eocd + locator + eocd)
                subprocess.run([node, str(NATIVE_ZIP_TEST), str(zip64_archive), "zip64"], check=True)
        finally:
            temp_path.unlink(missing_ok=True)
        print("OK: sintaxis JavaScript y lector ZIP local")
    else:
        print("AVISO: Node.js no está instalado; se omitió la comprobación JavaScript")

    backend_text = BACKEND.read_text(encoding="utf-8")
    backend_required = ["save_upload_streaming", "UPLOAD_CHUNK_BYTES", "while True:"]
    backend_missing = [token for token in backend_required if token not in backend_text]
    if backend_missing:
        raise SystemExit(f"Falta streaming en backend: {', '.join(backend_missing)}")
    if "data = await file.read(MAX_UPLOAD_BYTES + 1)" in backend_text:
        raise SystemExit("El backend volvió a cargar la subida completa en RAM.")

    with tempfile.NamedTemporaryFile(suffix=".pyc", delete=False) as compiled:
        compiled_path = Path(compiled.name)
    try:
        py_compile.compile(str(BACKEND), cfile=str(compiled_path), doraise=True)
    finally:
        compiled_path.unlink(missing_ok=True)
    print("OK: sintaxis Python")
    print("OK: ZIP/ZIP64 exterior incremental y sin CDN")
    print("OK: salida progresiva al disco")
    print("OK: backend con subida por bloques")


if __name__ == "__main__":
    main()
