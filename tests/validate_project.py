from __future__ import annotations

import py_compile
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
BACKEND = ROOT / "backend" / "app.py"


def main() -> None:
    html = INDEX.read_text(encoding="utf-8")
    required = [
        "window.zip.ZipReader",
        "getEntriesGenerator",
        "FileSystemSink",
        "showSaveFilePicker",
        "streamLargeText",
        "JSZip",
        "XLSX",
        "mammoth",
        "pdfjsLib",
        "extractWord",
        "extractSpreadsheet",
        "extractPowerPoint",
        "extractPdf",
        "extractVisio",
        "/api/extract",
    ]
    missing = [token for token in required if token not in html]
    if missing:
        raise SystemExit(f"Faltan componentes en index.html: {', '.join(missing)}")

    forbidden = [
        "const MAX_FILE_BYTES = 150 * 1024 * 1024",
        "JSZip.loadAsync(file)",
        "const extracted = []",
        "new Blob([content]",
    ]
    reintroduced = [token for token in forbidden if token in html]
    if reintroduced:
        raise SystemExit(f"Se reintrodujeron patrones no escalables: {', '.join(reintroduced)}")

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
        finally:
            temp_path.unlink(missing_ok=True)
        print("OK: sintaxis JavaScript")
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
    print("OK: ZIP exterior incremental")
    print("OK: salida progresiva al disco")
    print("OK: backend con subida por bloques")


if __name__ == "__main__":
    main()
