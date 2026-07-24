# 🧠 Code2Text Universal

Convierte proyectos comprimidos y documentos en un único archivo de texto estructurado, pensado para proporcionar contexto a modelos de lenguaje.

Esta versión amplía el proyecto original para que los archivos que antes se marcaban simplemente como **binarios** puedan pasar por extractores especializados.

## Qué puede extraer

| Familia | Formatos principales | Ejecución | Contenido recuperado |
|---|---|---|---|
| Código y texto | TXT, MD, JSON, XML, YAML, código fuente y configuraciones | Navegador | Texto completo y limpieza opcional de comentarios |
| Microsoft Word | DOCX, DOCM, DOTX, DOTM | Navegador | Títulos, párrafos, listas, tablas, enlaces, notas y texto de cuadros compatibles |
| Microsoft Excel | XLSX, XLS, XLSB, XLSM, XLTX, XLTM, ODS | Navegador | Hojas, valores visibles y fórmulas |
| Microsoft PowerPoint | PPTX, PPTM, PPSX, PPSM, POTX, POTM | Navegador | Texto ordenado por diapositiva, tablas y notas del presentador |
| Microsoft Visio | VSDX, VSDM, VSSX, VSTX y variantes | Navegador | Textos contenidos en formas y páginas |
| PDF | PDF con capa de texto | Navegador | Metadatos básicos y contenido separado por página |
| RTF | RTF | Navegador | Texto normalizado |
| OCR y formatos complejos | PDF escaneado, imágenes, audio, video, correo y otros formatos compatibles con Docling | Backend opcional | Markdown producido por Docling |
| Microsoft Office antiguo | DOC, PPT y otros formatos antiguos convertibles | Backend opcional | Conversión temporal con LibreOffice y extracción posterior con Docling |

> **Importante:** DOCX, XLSX, PPTX y VSDX son contenedores comprimidos con XML. Aunque el navegador los detecta como binarios, no necesitan enviarse a un servidor para extraer su contenido.

## Resultado generado

El archivo descargado conserva la estructura compatible con Code2Text:

```xml
<estructura_proyecto>
entrada/
├── src/
│   └── app.js
└── documentos/
    └── informe.docx
</estructura_proyecto>

<documentos_codigo version="2">
  <archivo ruta="src/app.js" tipo=".js" metodo="text-decoder-local"><![CDATA[
  // contenido
  ]]></archivo>
  <archivo ruta="documentos/informe.docx" tipo=".docx" metodo="mammoth-local"><![CDATA[
  # Título del informe
  ...
  ]]></archivo>
</documentos_codigo>
```

También puede incluir:

- `<archivos_omitidos>` con la razón de cada omisión.
- `<advertencias>` para PDF sin texto, hojas truncadas, conversiones antiguas o errores parciales.
- El atributo `metodo`, que permite saber si se usó Mammoth, SheetJS, PDF.js, OOXML local o Docling.

## Uso sin instalar nada

1. Publica el contenido del repositorio mediante **GitHub Pages**.
2. Abre la página desde el navegador.
3. Arrastra un ZIP o selecciona uno o varios documentos.
4. Revisa la vista previa y pulsa **Procesar y descargar**.

Los archivos Word, Excel, PowerPoint, PDF con texto, Visio, RTF y archivos de código se procesan en el equipo del usuario.

### Probar localmente la página

Desde la carpeta del proyecto:

```bash
python -m http.server 8080
```

Después abre:

```text
http://localhost:8080
```

Se recomienda usar un servidor local en vez de abrir `index.html` con `file://`, especialmente para PDF.js.

## Publicar en GitHub Pages

1. Sube `index.html`, `README.md` y las demás carpetas al repositorio.
2. Abre **Settings → Pages**.
3. Selecciona **Deploy from a branch**.
4. Elige la rama principal y la carpeta `/ (root)`.
5. Guarda los cambios.

El backend no se ejecuta en GitHub Pages. La extracción local seguirá funcionando sin él.

## Backend Docling opcional

El backend se utiliza únicamente para:

- OCR de PDF escaneado.
- Imágenes.
- Formatos que no poseen extractor local.
- DOC y PPT antiguos, que se convierten primero mediante LibreOffice.
- Extracción avanzada cuando PDF.js no encuentra una capa de texto útil.

### Requisitos recomendados

- Docker Desktop o Docker Engine con Compose.
- Al menos 8 GB de RAM disponibles; 12 GB o más mejora el procesamiento de PDF complejos.
- Espacio suficiente para la imagen, modelos y caché de Docling.

### Iniciar el backend

```bash
docker compose up --build
```

Comprueba su estado en:

```text
http://localhost:8000/health
```

En la página, abre **Extracción avanzada con Docling** e introduce:

```text
http://localhost:8000
```

Luego pulsa **Probar conexión**.

### GitHub Pages y HTTPS

Una página publicada por GitHub Pages usa HTTPS. Algunos navegadores pueden bloquear solicitudes hacia un backend HTTP externo por contenido mixto. Para producción, publica el backend detrás de HTTPS. Para pruebas locales, abre la página con `python -m http.server 8080` y usa el backend HTTP de Docker.

### Configuración del backend

Variables disponibles en `docker-compose.yml`:

| Variable | Uso |
|---|---|
| `ALLOWED_ORIGINS` | Orígenes permitidos por CORS. En producción conviene indicar la URL exacta de GitHub Pages. |
| `MAX_UPLOAD_BYTES` | Tamaño máximo por archivo enviado al backend. |
| `CONVERSION_TIMEOUT_SECONDS` | Tiempo máximo para conversiones de LibreOffice. |

Ejemplo de origen restringido:

```yaml
environment:
  ALLOWED_ORIGINS: "https://usuario.github.io"
```

## Arquitectura

```text
code2text-universal/
├── index.html
├── README.md
├── THIRD_PARTY_NOTICES.md
├── docker-compose.yml
└── backend/
    ├── app.py
    ├── Dockerfile
    └── requirements.txt
```

### Modo local

- **JSZip** abre el proyecto ZIP y los contenedores OOXML.
- **Mammoth.js** convierte Word moderno a HTML semántico, que luego se transforma a Markdown seguro.
- **SheetJS** lee formatos de Excel modernos y antiguos.
- **PDF.js** extrae la capa de texto de PDF.
- Un extractor OOXML propio procesa PowerPoint y Visio.

### Modo avanzado

- El navegador envía exclusivamente el archivo que necesita extracción avanzada.
- El backend lo guarda en un directorio temporal.
- Los formatos DOC/PPT antiguos se convierten con LibreOffice.
- Docling produce Markdown.
- El directorio temporal se elimina al terminar.

## Limitaciones conocidas

- PDF.js no realiza OCR. Un PDF compuesto solo por imágenes necesita el backend.
- La extracción local de PowerPoint y Visio recupera texto y tablas, pero no interpreta visualmente diagramas, flechas, fotografías ni relaciones espaciales complejas.
- Los archivos protegidos con contraseña no se pueden procesar localmente.
- Los macros VBA se ignoran y nunca se ejecutan.
- Los libros Excel extremadamente grandes se limitan a 250.000 celdas y 500 columnas por hoja para evitar bloquear el navegador; el archivo de salida registra la advertencia.
- Publisher (`.pub`), OneNote (`.one`) y algunos `.msg` pueden no ser compatibles incluso con el backend, según la versión y estructura del archivo.
- La limpieza de comentarios es heurística; puede desactivarse desde la interfaz cuando se requiera fidelidad absoluta del código.
- Ninguna solución estática en GitHub Pages puede ejecutar Docling dentro de la página: Docling utiliza Python, modelos y dependencias nativas. Por eso el diseño separa el modo local del backend avanzado.

## Seguridad

- El modo local no sube documentos.
- No se ejecutan macros, scripts incrustados ni enlaces.
- Los documentos Word se convierten a una representación intermedia y no se insertan como HTML activo en la interfaz.
- El backend debe ejecutarse en un contenedor aislado y mantenerse actualizado porque procesa archivos no confiables mediante bibliotecas complejas.
- Antes de exponer el backend en Internet, agrega autenticación, HTTPS, límites de solicitudes y un proxy inverso.

## Dependencias

La página carga bibliotecas desde CDN para conservar el repositorio simple y compatible con GitHub Pages. En entornos corporativos aislados, descarga esas bibliotecas, guárdalas en una carpeta `vendor/` y reemplaza las URL de los `<script>` por rutas locales.

Consulta `THIRD_PARTY_NOTICES.md` para licencias y proyectos utilizados.
