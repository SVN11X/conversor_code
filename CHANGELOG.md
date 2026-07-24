# Cambios principales

## Code2Text Universal 1.0.0

- Mantiene la extracción original de proyectos ZIP y archivos de texto.
- Permite seleccionar varios ZIP o documentos individuales.
- Añade extracción local para Word moderno mediante Mammoth.js.
- Añade extracción local para Excel moderno y antiguo mediante SheetJS, incluyendo fórmulas.
- Añade extracción OOXML propia para PowerPoint, notas del presentador y tablas.
- Añade extracción de texto para páginas y maestros de Visio.
- Añade extracción de PDF por página mediante PDF.js.
- Añade extracción básica de RTF.
- Registra método de extracción, advertencias y archivos omitidos.
- Añade límites de memoria para archivos y hojas Excel extremadamente grandes.
- Incluye backend Docling opcional con OCR.
- Incluye conversión previa de DOC, XLS y PPT antiguos mediante LibreOffice en el backend.
- Incluye Dockerfile, Docker Compose, comprobación de salud y configuración CORS.
- Incluye script de validación estática para JavaScript y Python.
