# Cambios principales

## Code2Text Universal Streaming 2.0.0

- Sustituye JSZip por zip.js para el ZIP exterior.
- Admite ZIP64 y archivos comprimidos de varios GB sin cargarlos completamente en RAM.
- Recorre entradas mediante `getEntriesGenerator()`.
- El escaneo ya no descomprime cada archivo.
- Descomprime y procesa una entrada por vez.
- Escribe el consolidado directamente al disco con File System Access API.
- Añade modo compatible en memoria con protección de 256 MB.
- Procesa archivos de texto grandes mediante streams.
- Limita la vista previa a 2.000 filas sin limitar el procesamiento.
- Añade cancelación segura para descompresión, streaming y Docling.
- Cambia la salida al formato `version="3" modo="streaming"`.
- Elimina el límite global de 150 MB para archivos de entrada y ZIP.
- Mantiene una protección dinámica por documento Office/PDF individual.
- Modifica el backend para guardar subidas por bloques de 8 MB.
- Eleva el límite predeterminado del backend a 2 GB por documento.

## Code2Text Universal 1.0.0

- Añade extracción local para Word, Excel, PowerPoint, Visio, PDF y RTF.
- Incluye backend Docling opcional y conversión con LibreOffice.
