# 🧠 Code2Text Universal Streaming

Convierte proyectos comprimidos y documentos en un único archivo de texto estructurado para modelos de lenguaje. Esta edición está preparada para ZIP de gran tamaño: el ZIP exterior se lee por rangos, cada entrada se descomprime una sola vez y el consolidado se escribe progresivamente al disco.

## Cambio principal de esta versión

La versión anterior usaba JSZip para abrir el ZIP exterior, descomprimía archivos durante el escaneo y construía todo el resultado en memoria. Eso impedía trabajar de forma confiable con ZIP de 1 GB o más.

La versión Streaming utiliza:

- **zip.js** para leer ZIP y ZIP64 sin cargar el archivo completo en RAM.
- `getEntriesGenerator()` para recorrer el índice de forma incremental.
- Descompresión de **una entrada por vez**.
- Escritura directa mediante **File System Access API** en Edge y Chrome.
- Procesamiento por streaming para archivos de texto de 16 MB o más.
- Vista previa limitada a 2.000 filas, aunque todos los archivos se procesan.
- Backend Docling con subida por bloques, sin `await file.read()` sobre el archivo completo.

No existe un límite fijo para el tamaño total del ZIP. El límite real depende del sistema de archivos, espacio libre, navegador y cantidad de entradas. Los documentos complejos individuales —Word, Excel, PowerPoint, Visio y PDF— sí requieren memoria durante su extracción local y cuentan con una protección calculada según el límite de memoria del navegador.

## Formatos

| Familia | Formatos principales | Ejecución | Contenido recuperado |
|---|---|---|---|
| Código y texto | TXT, MD, JSON, XML, YAML, CSV y lenguajes de programación | Navegador | Texto completo; archivos grandes se copian por streaming |
| Microsoft Word | DOCX, DOCM, DOTX, DOTM | Navegador | Títulos, párrafos, listas, tablas y enlaces compatibles |
| Microsoft Excel | XLSX, XLS, XLSB, XLSM, XLTX, XLTM, ODS | Navegador | Hojas, valores visibles y fórmulas |
| Microsoft PowerPoint | PPTX, PPTM, PPSX, PPSM, POTX, POTM | Navegador | Texto por diapositiva, tablas y notas |
| Microsoft Visio | VSDX, VSDM, VSSX, VSTX y variantes | Navegador | Textos de páginas, formas y maestros |
| PDF | PDF con capa de texto | Navegador | Metadatos y contenido por página |
| RTF | RTF | Navegador | Texto normalizado |
| OCR y formatos complejos | PDF escaneado, imágenes y formatos compatibles con Docling | Backend opcional | Markdown producido por Docling |
| Office antiguo | DOC, PPT y otros convertibles | Backend opcional | Conversión con LibreOffice y extracción con Docling |

## Uso recomendado para ZIP grandes

1. Publica el repositorio mediante GitHub Pages o ejecútalo en `localhost`.
2. Abre la herramienta en **Microsoft Edge o Google Chrome de escritorio**.
3. Selecciona el ZIP.
4. Espera a que se lea el índice. En esta etapa no se descomprime todo el ZIP.
5. Pulsa **Procesar y guardar**.
6. Selecciona inmediatamente dónde guardar el consolidado.
7. Mantén espacio libre suficiente para el TXT resultante.

La selección del destino al comienzo es intencional: permite escribir el resultado directamente al disco y evita crear un `Blob` gigante al final.

### Ejecutar localmente

```bash
python -m http.server 8080
```

Abre:

```text
http://localhost:8080
```

No se recomienda abrir `index.html` directamente con `file://`, porque algunas API de navegador y trabajadores pueden quedar restringidos.

## Formato del resultado

La salida usa un formato XML-like apto para lectura incremental:

```xml
<estructura_proyecto version="3" modo="lista-streaming">
  <entrada ruta="src/app.js" tipo=".js" tamano_bytes="1250" origen="zip" />
  <entrada ruta="documentos/informe.docx" tipo=".docx" tamano_bytes="87000" origen="zip" />
</estructura_proyecto>

<documentos_codigo version="3" modo="streaming">
  <archivo ruta="src/app.js" tipo=".js" metodo="text-decoder-local" estado="extraido"><![CDATA[
  // contenido
  ]]></archivo>

  <archivo ruta="documentos/informe.docx" tipo=".docx" metodo="mammoth-local" estado="extraido"><![CDATA[
  # Informe
  ]]></archivo>

  <archivo ruta="binario.dat" tipo=".dat" estado="omitido" tamano_bytes="100" motivo="Binario no compatible" />
  <advertencia archivo="documentos/escaneado.pdf"><![CDATA[Se recomienda OCR.]]></advertencia>
</documentos_codigo>
```

La estructura se escribe como lista en vez de árbol para no construir en memoria una representación enorme cuando el ZIP contiene cientos de miles de archivos.

## Cómo se controla la memoria

### ZIP exterior

- Se mantiene una referencia al archivo seleccionado.
- zip.js lee el directorio central y los rangos necesarios del `Blob`.
- El escaneo no extrae el contenido de las entradas.
- Cada entrada se libera después de procesarla.

### Texto grande

Los archivos de texto de 16 MB o más se decodifican por bloques y se escriben directamente al consolidado. En ese modo se omite la limpieza heurística de comentarios, porque esa función necesita disponer del archivo completo.

### Word, Excel, PowerPoint, Visio y PDF

Las bibliotecas utilizadas necesitan abrir el documento individual. Por eso se calcula una protección local entre aproximadamente 160 MB y 512 MB, según el límite de heap informado por Chromium. Esto no limita el tamaño total del ZIP: solo evita que un único documento gigante cierre la pestaña.

Cuando se configura Docling, un documento que supera la protección local se deriva al backend.

### Navegadores sin File System Access API

La herramienta conserva un modo compatible basado en `Blob`, limitado a 256 MB de salida para evitar agotar la RAM. Para consolidados grandes, utiliza Edge o Chrome en HTTPS o `localhost`.

## Backend Docling opcional

El backend se utiliza para OCR, formatos antiguos y documentos demasiado grandes para los extractores locales.

### Iniciar

```bash
docker compose up --build
```

Después configura en la página:

```text
http://localhost:8000
```

### Subidas grandes

El backend guarda cada subida en un archivo temporal mediante bloques de 8 MB. El valor predeterminado permite hasta 2 GB por documento individual:

```yaml
environment:
  MAX_UPLOAD_BYTES: "2147483648"
  UPLOAD_CHUNK_BYTES: "8388608"
```

`MAX_UPLOAD_BYTES=0` desactiva el límite de la aplicación, aunque todavía pueden existir límites del proxy, Docker, disco o servidor HTTP.

### Requisitos

- Docker Desktop o Docker Engine con Compose.
- 8 GB de RAM como mínimo; más memoria mejora PDF y documentos complejos.
- Espacio temporal suficiente para el archivo original, conversiones de LibreOffice y caché de Docling.

## Publicar en GitHub Pages

1. Sube el contenido del repositorio.
2. Abre **Settings → Pages**.
3. Selecciona **Deploy from a branch**.
4. Elige la rama principal y la carpeta raíz.
5. Guarda.

GitHub Pages ejecuta únicamente el modo local. Docling debe publicarse por separado y, para una página HTTPS, también debe exponerse mediante HTTPS.

## Arquitectura

```text
code2text-universal-streaming/
├── index.html
├── README.md
├── CHANGELOG.md
├── THIRD_PARTY_NOTICES.md
├── docker-compose.yml
├── backend/
│   ├── app.py
│   ├── Dockerfile
│   └── requirements.txt
└── tests/
    └── validate_project.py
```

- **zip.js**: ZIP exterior, ZIP64 y descompresión incremental.
- **JSZip**: contenedores OOXML individuales ya extraídos del ZIP exterior.
- **Mammoth.js**: Word moderno.
- **SheetJS**: Excel.
- **PDF.js**: capa de texto PDF.
- Extractores OOXML propios: PowerPoint y Visio.
- **File System Access API**: salida progresiva al disco.
- **Docling + LibreOffice**: modo avanzado opcional.

## Limitaciones

- Un ZIP cifrado necesita contraseña y actualmente se registra como omitido.
- Los ZIP anidados se registran, pero no se expanden automáticamente para evitar recursión y uso de disco inesperados.
- Un documento individual muy grande puede exceder la memoria que requieren Mammoth, SheetJS, PDF.js o JSZip interno, aunque el ZIP exterior se procese eficientemente.
- PDF.js no realiza OCR.
- La extracción de PowerPoint y Visio recupera texto, no interpreta visualmente todas las relaciones espaciales.
- Excel limita cada hoja a 250.000 celdas y 500 columnas en la salida.
- La cantidad máxima práctica de entradas depende de la memoria necesaria para conservar sus metadatos. La interfaz solo renderiza 2.000 filas.
- El backend procesa una conversión Docling a la vez para evitar sobrecargar CPU y RAM.

## Validación

```bash
python tests/validate_project.py
```

El script comprueba la sintaxis JavaScript y Python, la presencia del procesamiento incremental y que no se haya reintroducido el antiguo límite global de 150 MB.
