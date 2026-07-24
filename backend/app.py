from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import tempfile
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

try:
    from docling.document_converter import DocumentConverter
except ImportError as exc:  # pragma: no cover
    raise RuntimeError("Docling no está instalado. Ejecuta pip install docling.") from exc

APP_VERSION = "1.0.0"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(150 * 1024 * 1024)))
CONVERSION_TIMEOUT_SECONDS = int(os.getenv("CONVERSION_TIMEOUT_SECONDS", "240"))
ALLOWED_ORIGINS = [
    item.strip()
    for item in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if item.strip()
]

app = FastAPI(
    title="Code2Text Docling Backend",
    version=APP_VERSION,
    description="Extracción avanzada para Code2Text Universal mediante Docling y LibreOffice.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_converter: DocumentConverter | None = None
_converter_lock = Lock()
_conversion_lock = asyncio.Lock()

LEGACY_CONVERSIONS = {
    ".doc": "docx",
    ".dot": "docx",
    ".rtf": "docx",
    ".xls": "xlsx",
    ".xlt": "xlsx",
    ".ppt": "pptx",
    ".pps": "pptx",
    ".pot": "pptx",
}


def safe_filename(filename: str | None) -> str:
    name = Path(filename or "documento.bin").name
    name = re.sub(r"[^A-Za-z0-9._()\- áéíóúÁÉÍÓÚñÑ]", "_", name)
    return name[:180] or "documento.bin"


def get_converter() -> DocumentConverter:
    global _converter
    if _converter is None:
        with _converter_lock:
            if _converter is None:
                _converter = DocumentConverter()
    return _converter


def package_version(package: str) -> str:
    try:
        return version(package)
    except PackageNotFoundError:
        return "desconocida"


def convert_legacy_with_libreoffice(source: Path, output_dir: Path) -> Path:
    target_format = LEGACY_CONVERSIONS.get(source.suffix.lower())
    if not target_format:
        return source

    output_dir.mkdir(parents=True, exist_ok=True)
    executable = shutil.which("soffice") or shutil.which("libreoffice")
    if executable is None:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{source.suffix} requiere LibreOffice para convertirse antes de Docling, "
                "pero soffice no está instalado en el backend."
            ),
        )

    command = [
        executable,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        "--convert-to",
        target_format,
        "--outdir",
        str(output_dir),
        str(source),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=CONVERSION_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="LibreOffice agotó el tiempo de conversión.") from exc

    candidates = sorted(output_dir.glob(f"{source.stem}.*"), key=lambda path: path.stat().st_mtime, reverse=True)
    converted = next((path for path in candidates if path.suffix.lower() == f".{target_format}"), None)
    if completed.returncode != 0 or converted is None:
        detail = (completed.stderr or completed.stdout or "Error desconocido de LibreOffice").strip()
        raise HTTPException(status_code=422, detail=f"No se pudo convertir {source.name}: {detail[:800]}")
    return converted


def run_docling(path: Path) -> str:
    try:
        result = get_converter().convert(path)
        markdown = result.document.export_to_markdown()
    except Exception as exc:  # Docling expone diferentes excepciones según el formato
        raise HTTPException(status_code=422, detail=f"Docling no pudo procesar el archivo: {exc}") from exc

    if not markdown or not markdown.strip():
        raise HTTPException(status_code=422, detail="Docling no encontró contenido textual extraíble.")
    return markdown.strip()


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "Code2Text Docling Backend",
        "version": APP_VERSION,
        "docling": package_version("docling"),
    }


@app.post("/api/extract")
async def extract(file: UploadFile = File(...)) -> dict[str, object]:
    filename = safe_filename(file.filename)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo supera el límite de {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    if not data:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")

    async with _conversion_lock:
        with tempfile.TemporaryDirectory(prefix="code2text_") as temp:
            temp_dir = Path(temp)
            source = temp_dir / filename
            source.write_bytes(data)
            converted = convert_legacy_with_libreoffice(source, temp_dir / "converted")
            method = "docling"
            warnings: list[str] = []
            if converted != source:
                method = f"libreoffice-{source.suffix.lower().lstrip('.')}→{converted.suffix.lower().lstrip('.')}+docling"
                warnings.append(
                    f"El formato antiguo {source.suffix} se convirtió temporalmente a {converted.suffix} antes de extraerlo."
                )
            markdown = await asyncio.to_thread(run_docling, converted)

    return {
        "filename": filename,
        "markdown": markdown,
        "method": method,
        "warnings": warnings,
    }
