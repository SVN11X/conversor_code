/* Code2Text Native ZIP Reader - ZIP/ZIP64 por rangos, sin CDN ni workers externos. */
(function (root) {
  "use strict";

  const SIG_LOCAL = 0x04034b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_EOCD = 0x06054b50;
  const SIG_ZIP64_EOCD = 0x06064b50;
  const SIG_ZIP64_LOCATOR = 0x07064b50;
  const ZIP64_EXTRA = 0x0001;
  const FLAG_ENCRYPTED = 0x0001;
  const FLAG_UTF8 = 0x0800;
  const LOCAL_FIXED = 30;
  const CENTRAL_FIXED = 46;
  const EOCD_FIXED = 22;
  const ZIP64_LOCATOR_SIZE = 20;
  const ZIP64_EOCD_SIZE = 56;
  const EOCD_SEARCH = 1024 * 1024;
  const CENTRAL_CHUNK = 4 * 1024 * 1024;
  const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

  const CP437 = [
    "Ç","ü","é","â","ä","à","å","ç","ê","ë","è","ï","î","ì","Ä","Å",
    "É","æ","Æ","ô","ö","ò","û","ù","ÿ","Ö","Ü","¢","£","¥","₧","ƒ",
    "á","í","ó","ú","ñ","Ñ","ª","º","¿","⌐","¬","½","¼","¡","«","»",
    "░","▒","▓","│","┤","Á","Â","À","©","╣","║","╗","╝","¢","¥","┐",
    "└","┴","┬","├","─","┼","ã","Ã","╚","╔","╩","╦","╠","═","╬","¤",
    "ð","Ð","Ê","Ë","È","ı","Í","Î","Ï","┘","┌","█","▄","¦","Ì","▀",
    "Ó","ß","Ô","Ò","õ","Õ","µ","þ","Þ","Ú","Û","Ù","ý","Ý","¯","´",
    "≡","±","‗","¾","¶","§","÷","¸","°","¨","·","¹","³","²","■"," "
  ];

  class ZipFormatError extends Error {
    constructor(message, code = "ERR_INVALID_ZIP") {
      super(message);
      this.name = "ZipFormatError";
      this.code = code;
    }
  }

  function abortIfNeeded(signal) {
    if (signal?.aborted) throw new DOMException("Operación cancelada", "AbortError");
  }

  function safeNumber(value, label) {
    const big = typeof value === "bigint" ? value : BigInt(value);
    if (big < 0n || big > MAX_SAFE_BIGINT) {
      throw new ZipFormatError(`${label} excede el rango seguro del navegador`, "ERR_UNSAFE_INTEGER");
    }
    return Number(big);
  }

  function u64(view, offset, label) {
    if (typeof view.getBigUint64 === "function") return safeNumber(view.getBigUint64(offset, true), label);
    const low = BigInt(view.getUint32(offset, true));
    const high = BigInt(view.getUint32(offset + 4, true));
    return safeNumber((high << 32n) | low, label);
  }

  async function readRange(blob, start, length, signal) {
    abortIfNeeded(signal);
    if (start < 0 || length < 0 || start + length > blob.size) {
      throw new ZipFormatError("El ZIP contiene rangos fuera del archivo", "ERR_BOUNDS");
    }
    const bytes = new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
    abortIfNeeded(signal);
    return bytes;
  }

  function concat(a, b) {
    if (!a.length) return b;
    if (!b.length) return a;
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }

  function decodeCp437(bytes) {
    let text = "";
    for (const byte of bytes) text += byte < 128 ? String.fromCharCode(byte) : (CP437[byte - 128] || "�");
    return text;
  }

  function decodeName(bytes, utf8) {
    return utf8 ? new TextDecoder("utf-8", { fatal: false }).decode(bytes) : decodeCp437(bytes);
  }

  function findExtra(extra, wantedId) {
    let offset = 0;
    while (offset + 4 <= extra.length) {
      const view = new DataView(extra.buffer, extra.byteOffset + offset, extra.length - offset);
      const id = view.getUint16(0, true);
      const size = view.getUint16(2, true);
      const start = offset + 4;
      const end = start + size;
      if (end > extra.length) return null;
      if (id === wantedId) return extra.subarray(start, end);
      offset = end;
    }
    return null;
  }

  function unicodeName(extra) {
    const field = findExtra(extra, 0x7075);
    if (!field || field.length < 5 || field[0] !== 1) return "";
    return new TextDecoder("utf-8", { fatal: false }).decode(field.subarray(5));
  }

  function zip64Values(extra, needed) {
    const field = findExtra(extra, ZIP64_EXTRA);
    if (!field) return {};
    const view = new DataView(field.buffer, field.byteOffset, field.byteLength);
    let offset = 0;
    const result = {};
    const read64 = (label) => {
      if (offset + 8 > field.length) throw new ZipFormatError(`Campo ZIP64 incompleto: ${label}`);
      const value = u64(view, offset, label);
      offset += 8;
      return value;
    };
    if (needed.uncompressed) result.uncompressedSize = read64("tamaño sin comprimir");
    if (needed.compressed) result.compressedSize = read64("tamaño comprimido");
    if (needed.localOffset) result.localHeaderOffset = read64("desplazamiento local");
    if (needed.disk) {
      if (offset + 4 > field.length) throw new ZipFormatError("Campo ZIP64 incompleto: disco");
      result.diskStart = view.getUint32(offset, true);
    }
    return result;
  }

  function sanitizePath(value) {
    return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\0/g, "");
  }

  function decompressor(method) {
    if (method === 0) return null;
    if (method !== 8) throw new ZipFormatError(`Método de compresión ZIP no compatible: ${method}`, "ERR_UNSUPPORTED_COMPRESSION");
    if (typeof root.DecompressionStream !== "function") {
      throw new ZipFormatError("Este navegador no dispone de DecompressionStream", "ERR_NO_DECOMPRESSION_STREAM");
    }
    try {
      return new root.DecompressionStream("deflate-raw");
    } catch (error) {
      throw new ZipFormatError(`El navegador no admite DEFLATE sin cabecera: ${error.message}`, "ERR_NO_DEFLATE_RAW");
    }
  }

  class NativeZipEntry {
    constructor(reader, metadata) {
      Object.assign(this, metadata);
      this.reader = reader;
    }

    async compressedBlob(signal) {
      if (this.encrypted) throw new ZipFormatError("El archivo ZIP está cifrado", "ERR_ENCRYPTED_ZIP");
      const header = await readRange(this.reader.blob, this.localHeaderOffset, LOCAL_FIXED, signal);
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (view.getUint32(0, true) !== SIG_LOCAL) {
        throw new ZipFormatError(`Cabecera local inválida para ${this.filename}`, "ERR_LOCAL_HEADER");
      }
      const nameLength = view.getUint16(26, true);
      const extraLength = view.getUint16(28, true);
      const start = this.localHeaderOffset + LOCAL_FIXED + nameLength + extraLength;
      const end = start + this.compressedSize;
      if (end > this.reader.blob.size) throw new ZipFormatError(`Entrada truncada: ${this.filename}`, "ERR_TRUNCATED_ENTRY");
      return this.reader.blob.slice(start, end);
    }

    async pipeTo(writable, options = {}) {
      const signal = options.signal;
      abortIfNeeded(signal);
      let readable = (await this.compressedBlob(signal)).stream();
      const transform = decompressor(this.compressionMethod);
      if (transform) readable = readable.pipeThrough(transform, { signal });
      await readable.pipeTo(writable, { signal });
    }

    async getUint8Array(options = {}) {
      const chunks = [];
      let total = 0;
      const writable = new WritableStream({
        write(chunk) {
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          const copy = bytes.slice();
          chunks.push(copy);
          total += copy.byteLength;
        }
      });
      await this.pipeTo(writable, options);
      if (total !== this.uncompressedSize) {
        throw new ZipFormatError(`Tamaño extraído inesperado en ${this.filename}: ${total}/${this.uncompressedSize}`, "ERR_SIZE_MISMATCH");
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    }

    async getBlob(type = "application/octet-stream", options = {}) {
      return new Blob([await this.getUint8Array(options)], { type });
    }
  }

  class NativeZipReader {
    constructor(blob) {
      if (!(blob instanceof Blob)) throw new TypeError("NativeZipReader requiere un File o Blob");
      this.blob = blob;
      this.closed = false;
      this.directoryInfo = null;
    }

    async locateDirectory(signal) {
      if (this.directoryInfo) return this.directoryInfo;
      if (this.blob.size < EOCD_FIXED) throw new ZipFormatError("El archivo es demasiado pequeño para ser ZIP");
      const searchSize = Math.min(this.blob.size, EOCD_SEARCH);
      const searchStart = this.blob.size - searchSize;
      const tail = await readRange(this.blob, searchStart, searchSize, signal);
      const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
      let eocdIndex = -1;
      for (let i = tail.length - EOCD_FIXED; i >= 0; i--) {
        if (view.getUint32(i, true) !== SIG_EOCD) continue;
        const commentLength = view.getUint16(i + 20, true);
        if (i + EOCD_FIXED + commentLength === tail.length) {
          eocdIndex = i;
          break;
        }
      }
      if (eocdIndex < 0) throw new ZipFormatError("No se encontró el directorio central del ZIP", "ERR_EOCD_NOT_FOUND");
      const eocdOffset = searchStart + eocdIndex;
      const disk = view.getUint16(eocdIndex + 4, true);
      const centralDisk = view.getUint16(eocdIndex + 6, true);
      if (disk !== 0 || centralDisk !== 0) throw new ZipFormatError("Los ZIP multidisco no son compatibles", "ERR_MULTIDISK_ZIP");
      let entriesTotal = view.getUint16(eocdIndex + 10, true);
      let centralSize = view.getUint32(eocdIndex + 12, true);
      let centralOffset = view.getUint32(eocdIndex + 16, true);

      if (entriesTotal === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        const locator = await readRange(this.blob, eocdOffset - ZIP64_LOCATOR_SIZE, ZIP64_LOCATOR_SIZE, signal);
        const locatorView = new DataView(locator.buffer, locator.byteOffset, locator.byteLength);
        if (locatorView.getUint32(0, true) !== SIG_ZIP64_LOCATOR) throw new ZipFormatError("Falta el localizador ZIP64", "ERR_ZIP64_LOCATOR");
        if (locatorView.getUint32(4, true) !== 0 || locatorView.getUint32(16, true) !== 1) {
          throw new ZipFormatError("Los ZIP64 multidisco no son compatibles", "ERR_MULTIDISK_ZIP64");
        }
        const zip64Offset = u64(locatorView, 8, "desplazamiento EOCD ZIP64");
        const record = await readRange(this.blob, zip64Offset, ZIP64_EOCD_SIZE, signal);
        const recordView = new DataView(record.buffer, record.byteOffset, record.byteLength);
        if (recordView.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipFormatError("Registro ZIP64 inválido", "ERR_ZIP64_EOCD");
        if (recordView.getUint32(16, true) !== 0 || recordView.getUint32(20, true) !== 0) {
          throw new ZipFormatError("Los ZIP64 multidisco no son compatibles", "ERR_MULTIDISK_ZIP64");
        }
        entriesTotal = u64(recordView, 32, "cantidad de entradas ZIP64");
        centralSize = u64(recordView, 40, "tamaño del directorio ZIP64");
        centralOffset = u64(recordView, 48, "desplazamiento del directorio ZIP64");
      }
      if (centralOffset + centralSize > this.blob.size) throw new ZipFormatError("El directorio central apunta fuera del ZIP", "ERR_CENTRAL_BOUNDS");
      this.directoryInfo = { entriesTotal, centralSize, centralOffset };
      return this.directoryInfo;
    }

    async *entries(options = {}) {
      if (this.closed) throw new ZipFormatError("El lector ZIP ya está cerrado", "ERR_READER_CLOSED");
      const signal = options.signal;
      const info = await this.locateDirectory(signal);
      const centralEnd = info.centralOffset + info.centralSize;
      let absolute = info.centralOffset;
      let pending = new Uint8Array(0);
      let count = 0;

      while (absolute < centralEnd || pending.length) {
        abortIfNeeded(signal);
        if (absolute < centralEnd) {
          const size = Math.min(CENTRAL_CHUNK, centralEnd - absolute);
          pending = concat(pending, await readRange(this.blob, absolute, size, signal));
          absolute += size;
        }
        let cursor = 0;
        while (pending.length - cursor >= CENTRAL_FIXED) {
          const view = new DataView(pending.buffer, pending.byteOffset + cursor, pending.length - cursor);
          if (view.getUint32(0, true) !== SIG_CENTRAL) {
            throw new ZipFormatError(`Cabecera central inválida en entrada ${count + 1}`, "ERR_CENTRAL_HEADER");
          }
          const nameLength = view.getUint16(28, true);
          const extraLength = view.getUint16(30, true);
          const commentLength = view.getUint16(32, true);
          const recordLength = CENTRAL_FIXED + nameLength + extraLength + commentLength;
          if (pending.length - cursor < recordLength) break;
          const flags = view.getUint16(8, true);
          const compressionMethod = view.getUint16(10, true);
          const crc32 = view.getUint32(16, true);
          let compressedSize = view.getUint32(20, true);
          let uncompressedSize = view.getUint32(24, true);
          let diskStart = view.getUint16(34, true);
          const externalAttributes = view.getUint32(38, true);
          let localHeaderOffset = view.getUint32(42, true);
          const nameBytes = pending.subarray(cursor + CENTRAL_FIXED, cursor + CENTRAL_FIXED + nameLength);
          const extra = pending.subarray(cursor + CENTRAL_FIXED + nameLength, cursor + CENTRAL_FIXED + nameLength + extraLength);
          const z64 = zip64Values(extra, {
            uncompressed: uncompressedSize === 0xffffffff,
            compressed: compressedSize === 0xffffffff,
            localOffset: localHeaderOffset === 0xffffffff,
            disk: diskStart === 0xffff
          });
          if (z64.uncompressedSize !== undefined) uncompressedSize = z64.uncompressedSize;
          if (z64.compressedSize !== undefined) compressedSize = z64.compressedSize;
          if (z64.localHeaderOffset !== undefined) localHeaderOffset = z64.localHeaderOffset;
          if (z64.diskStart !== undefined) diskStart = z64.diskStart;
          if (diskStart !== 0) throw new ZipFormatError("Entrada ubicada en otro volumen ZIP", "ERR_MULTIDISK_ENTRY");
          let filename = decodeName(nameBytes, Boolean(flags & FLAG_UTF8));
          if (!(flags & FLAG_UTF8)) filename = unicodeName(extra) || filename;
          filename = sanitizePath(filename);
          const unixMode = (externalAttributes >>> 16) & 0xffff;
          const fileType = unixMode & 0xf000;
          count += 1;
          yield new NativeZipEntry(this, {
            filename,
            directory: filename.endsWith("/") || fileType === 0x4000,
            symlink: fileType === 0xa000,
            encrypted: Boolean(flags & FLAG_ENCRYPTED),
            flags,
            compressionMethod,
            crc32,
            compressedSize,
            uncompressedSize,
            localHeaderOffset,
            externalAttributes
          });
          cursor += recordLength;
        }
        pending = cursor ? pending.slice(cursor) : pending;
        if (absolute >= centralEnd) {
          if (pending.length) throw new ZipFormatError("Directorio central truncado", "ERR_TRUNCATED_CENTRAL");
          break;
        }
      }
      if (count !== info.entriesTotal) {
        throw new ZipFormatError(`El ZIP declara ${info.entriesTotal} entradas, pero se leyeron ${count}`, "ERR_ENTRY_COUNT");
      }
      return true;
    }

    async close() {
      this.closed = true;
      this.directoryInfo = null;
    }
  }

  root.Code2TextZip = Object.freeze({ NativeZipReader, NativeZipEntry, ZipFormatError, version: "1.0.0" });
})(typeof window !== "undefined" ? window : globalThis);
