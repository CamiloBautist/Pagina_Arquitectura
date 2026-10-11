/**
 * modo-protegido.js
 * Lógica de validación de modo protegido x86 (selector → GDT/LDT → descriptor → dirección lineal).
 * Clase independiente: NO usa el DOM, por lo que funciona en el navegador y en Node.js.
 *
 * Uso en el navegador:  <script src="js/modo-protegido.js"></script>   → ModoProtegido
 * Uso en Node.js:       const ModoProtegido = require("./modo-protegido.js");
 *
 * Ejemplo:
 *   const mp = new ModoProtegido();
 *   const r = mp.validar({ selector: 0x0008, tipoSegmento: "CS", offset: 0x1000, operacion: "execute", cpl: 0 });
 *   r.ok        // true
 *   r.lineal    // 4096 (0x1000)
 *   r.excepcion // null  (o "#GP(0x0008)", "#NP(...)", "#SS(0)", ...)
 */
class ModoProtegido {
  // Descriptores de ejemplo: 64 bits en hexadecimal (16 dígitos), formato x86 clásico.
  static GDT_EJEMPLO = [
    { name: "Descriptor nulo",             raw: "0000000000000000" },
    { name: "Código kernel (flat 4 GB)",   raw: "00CF9A000000FFFF" },
    { name: "Datos kernel (flat 4 GB)",    raw: "00CF92000000FFFF" },
    { name: "Código usuario (flat 4 GB)",  raw: "00CFFA000000FFFF" },
    { name: "Datos usuario (flat 4 GB)",   raw: "00CFF2000000FFFF" },
    { name: "Datos solo lectura (4 KB)",   raw: "0040903000000FFF" },
    { name: "Pila expansión abajo",        raw: "0040961000000FFF" },
    { name: "Código legible (8 KB)",       raw: "00409A2000001FFF" },
    { name: "Segmento no presente",        raw: "00401A4000000FFF" },
    { name: "TSS (descriptor de sistema)", raw: "0040895000000067" }
  ];
  static LDT_EJEMPLO = [
    { name: "Datos local (4 KB)",  raw: "0040926000000FFF" },
    { name: "Código local (4 KB)", raw: "00409A7000000FFF" },
    { name: "Datos DPL 3 (4 KB)",  raw: "0040F28000000FFF" }
  ];

  /** @param {{gdt?: {name:string, raw:string}[], ldt?: {name:string, raw:string}[]}} tablas */
  constructor({ gdt = ModoProtegido.GDT_EJEMPLO, ldt = ModoProtegido.LDT_EJEMPLO } = {}) {
    this.gdt = gdt;
    this.ldt = ldt;
  }

  /** Número → hexadecimal en mayúsculas con relleno de ceros. */
  static hex(n, ancho = 1) {
    return n.toString(16).toUpperCase().padStart(ancho, "0");
  }

  /** Texto hexadecimal (1..maxDigitos dígitos) → número, o null si no es válido. */
  static parseHex(texto, maxDigitos) {
    const t = String(texto).trim();
    return new RegExp(`^[0-9a-fA-F]{1,${maxDigitos}}$`).test(t) ? parseInt(t, 16) : null;
  }

  /** Nombres de los tipos de descriptor de sistema (S = 0) en IA-32. Los que no aparecen están reservados. */
  static NOMBRES_SISTEMA = {
    0x1: "TSS 16 bits (disponible)", 0x2: "LDT", 0x3: "TSS 16 bits (ocupado)",
    0x4: "Puerta de llamada 16 bits", 0x5: "Puerta de tarea", 0x6: "Puerta de interrupción 16 bits",
    0x7: "Puerta de trampa 16 bits", 0x9: "TSS 32 bits (disponible)", 0xB: "TSS 32 bits (ocupado)",
    0xC: "Puerta de llamada 32 bits", 0xE: "Puerta de interrupción 32 bits", 0xF: "Puerta de trampa 32 bits"
  };

  /**
   * Distribución de los 64 bits de un descriptor, de izquierda (bit 63) a derecha (bit 0).
   * desde/hasta son posiciones en la cadena binaria (hasta excluido). grupo: base | flags | limite | acceso.
   */
  static CAMPOS_BITS = [
    { id: "baseHi",  grupo: "base",   etiqueta: "BASE 31:24",   desde: 0,  hasta: 8 },
    { id: "flags",   grupo: "flags",  etiqueta: "FLAGS",        desde: 8,  hasta: 12 },
    { id: "limHi",   grupo: "limite", etiqueta: "LÍMITE 19:16", desde: 12, hasta: 16 },
    { id: "acceso",  grupo: "acceso", etiqueta: "ACCESO",       desde: 16, hasta: 24 },
    { id: "baseMid", grupo: "base",   etiqueta: "BASE 23:16",   desde: 24, hasta: 32 },
    { id: "baseLo",  grupo: "base",   etiqueta: "BASE 15:0",    desde: 32, hasta: 48 },
    { id: "limLo",   grupo: "limite", etiqueta: "LÍMITE 15:0",  desde: 48, hasta: 64 }
  ];

  /** Hexadecimal de 16 dígitos → cadena de 64 bits (bit 63 a la izquierda). */
  static hexABinario(hex) {
    return [...String(hex)].map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("");
  }

  /** Cadena de 64 bits → hexadecimal de 16 dígitos en mayúsculas. */
  static binarioAHex(bits) {
    return bits.match(/.{4}/g).map((n) => parseInt(n, 2).toString(16)).join("").toUpperCase();
  }

  /**
   * Valida el ingreso binario del Reversing: exactamente 64 bits (0/1). Se ignoran espacios, guiones y guiones bajos.
   * @returns {{ok:boolean, error:string|null, bits:string, cantidad:number, hex:string|null}}
   */
  static validarBinario64(texto) {
    const bits = String(texto ?? "").replace(/[\s_-]/g, "");
    const cantidad = bits.length;
    const resultado = (error) => ({ ok: false, error, bits, cantidad, hex: null });
    if (cantidad === 0) return resultado("Ingresa los 64 bits del descriptor (solo 0 y 1).");
    const malo = bits.search(/[^01]/);
    if (malo !== -1) return resultado(`Carácter no válido «${bits[malo]}» en la posición ${malo + 1}. Solo se permiten 0 y 1.`);
    if (cantidad < 64) return resultado(`${64 - cantidad === 1 ? "Falta" : "Faltan"} ${64 - cantidad} ${64 - cantidad === 1 ? "bit" : "bits"}: el descriptor debe tener exactamente 64 (llevas ${cantidad}).`);
    if (cantidad > 64) return resultado(`${cantidad - 64 === 1 ? "Sobra" : "Sobran"} ${cantidad - 64} ${cantidad - 64 === 1 ? "bit" : "bits"}: el descriptor debe tener exactamente 64 (tienes ${cantidad}).`);
    return { ok: true, error: null, bits, cantidad, hex: ModoProtegido.binarioAHex(bits) };
  }

  /**
   * Acepta un descriptor como hexadecimal (16 dígitos, admite prefijo 0x o sufijo h) o como binario (64 bits)
   * y devuelve siempre el hexadecimal normalizado en mayúsculas.
   * @returns {{ok:boolean, error:string|null, hex:string|null, formato:"hex"|"binario"|null}}
   */
  static normalizarDescriptor(texto) {
    let t = String(texto ?? "").replace(/[\s_-]/g, "");
    const falla = (error) => ({ ok: false, error, hex: null, formato: null });
    if (t === "") return falla("Ingresa el descriptor: 16 dígitos hexadecimales o 64 bits.");
    if (/^[01]{17,}$/.test(t)) {   // más de 16 símbolos 0/1: solo puede ser un intento de binario
      const b = ModoProtegido.validarBinario64(t);
      return b.ok ? { ok: true, error: null, hex: b.hex, formato: "binario" } : falla(b.error);
    }
    t = t.replace(/^0x/i, "").replace(/h$/i, "");
    const malo = t.search(/[^0-9a-fA-F]/);
    if (malo !== -1) return falla(`Carácter no válido «${t[malo]}». Usa dígitos hexadecimales (0–9, A–F) o 64 bits en binario.`);
    if (t.length !== 16) return falla(`El descriptor hexadecimal debe tener 16 dígitos (tienes ${t.length}). Para binario, usa 64 bits.`);
    return { ok: true, error: null, hex: t.toUpperCase(), formato: "hex" };
  }

  /** Tamaño legible de un segmento a partir de su límite efectivo (en bytes). */
  static tamanoLegible(limite) {
    const n = limite + 1;
    for (const [factor, unidad] of [[2 ** 30, "GB"], [2 ** 20, "MB"], [2 ** 10, "KB"]]) {
      if (n >= factor && n % factor === 0) return `${n / factor} ${unidad}`;
    }
    return `${n.toLocaleString("es-CO")} ${n === 1 ? "byte" : "bytes"}`;
  }

  /** Selector de 16 bits → { indice, ti, rpl }. TI: 0 = GDT, 1 = LDT. */
  static parseSelector(selector) {
    return { indice: selector >> 3, ti: (selector >> 2) & 1, rpl: selector & 3 };
  }

  /** Descriptor de 64 bits (cadena hex de 16 dígitos) → campos decodificados. Lanza RangeError si el formato no es válido. */
  static parseDescriptor(raw) {
    if (typeof raw !== "string" || !/^[0-9a-fA-F]{16}$/.test(raw)) {
      throw new RangeError("descriptor inválido: se esperan 16 dígitos hexadecimales (64 bits)");
    }
    raw = raw.toUpperCase();
    const hx = (a, b) => parseInt(raw.slice(a, b), 16);
    const baseHi = hx(0, 2), flags = hx(2, 4), access = hx(4, 6);
    const baseMid = hx(6, 8), baseLo = hx(8, 12), limLo = hx(12, 16);
    const base = baseHi * 0x1000000 + baseMid * 0x10000 + baseLo;
    const limitRaw = (flags & 0xF) * 0x10000 + limLo;
    const G = (flags >> 7) & 1;
    const type = access & 0xF;
    const S = (access >> 4) & 1;
    const isCode = !!(type & 8);
    const d = {
      raw, bits: ModoProtegido.hexABinario(raw), base, limitRaw, G,
      limit: G ? limitRaw * 0x1000 + 0xFFF : limitRaw, // límite efectivo en bytes
      DB: (flags >> 6) & 1, L: (flags >> 5) & 1, AVL: (flags >> 4) & 1,
      P: (access >> 7) & 1, DPL: (access >> 5) & 3, S, type, access, flags,
      isCode,
      conforming: S === 1 && isCode && !!(type & 4),
      expandDown: S === 1 && !isCode && !!(type & 4),
      readable: isCode ? !!(type & 2) : true,
      writable: !isCode && !!(type & 2),
      accessed: !!(type & 1)
    };
    d.esNulo = /^0{16}$/.test(raw);
    d.categoria = S === 0 ? "sistema" : isCode ? "codigo" : "datos";
    d.typeName = S === 0
      ? (ModoProtegido.NOMBRES_SISTEMA[type] ?? `Sistema reservado (tipo ${ModoProtegido.hex(type)}h)`)
      : isCode
        ? `Código${d.conforming ? " conforme" : ""} · ${d.readable ? "ejecución/lectura" : "solo ejecución"}`
        : `Datos${d.expandDown ? " expansión abajo" : ""} · ${d.writable ? "lectura/escritura" : "solo lectura"}`;
    d.advertencias = ModoProtegido.advertenciasDescriptor(d);
    d.resumen = ModoProtegido.resumenDescriptor(d);
    return d;
  }

  /** Observaciones sobre combinaciones inusuales o inválidas de un descriptor ya decodificado. */
  static advertenciasDescriptor(d) {
    const hex = ModoProtegido.hex;
    const av = [];
    if (d.esNulo) av.push("Descriptor nulo: todos los bits en 0. Cargarlo en CS o SS provoca #GP(0); en DS/ES/FS/GS solo falla al usarlo.");
    if (d.S === 0 && ModoProtegido.NOMBRES_SISTEMA[d.type] === undefined && !d.esNulo) {
      av.push(`Tipo de sistema ${hex(d.type)}h reservado: no está definido en IA-32.`);
    }
    if (d.S === 0 && !d.esNulo) av.push("Es un descriptor de sistema (S = 0): no puede cargarse en CS, DS ni SS.");
    if (d.S === 1 && d.isCode && d.L === 1 && d.DB === 1) av.push("Combinación inválida: L = 1 y D/B = 1 en un segmento de código (el modo de 64 bits exige D/B = 0).");
    else if (d.S === 1 && d.isCode && d.L === 1) av.push("L = 1: segmento de código de 64 bits (modo largo). En ese modo la base y el límite se ignoran.");
    if (d.S === 1 && !d.isCode && d.L === 1) av.push("L = 1 en un segmento de datos: el bit L solo tiene significado en segmentos de código.");
    if (d.P === 0 && !d.esNulo) av.push("P = 0: el segmento no está presente. Usarlo provoca #NP (o #SS si se carga en SS).");
    if (d.S === 1 && d.isCode && d.conforming) av.push(`Código conforme: puede ejecutarse desde cualquier CPL ≥ DPL (${d.DPL}) y el CPL no cambia al saltar a él.`);
    if (d.S === 1 && d.expandDown) av.push("Expansión hacia abajo: los offsets válidos están por encima del límite, no por debajo.");
    if (d.S === 1 && d.G === 1 && d.limitRaw === 0xFFFFF) av.push("Segmento «flat»: G = 1 con límite FFFFFh abarca los 4 GB completos.");
    return av;
  }

  /** Descripción en una frase de quién es el descriptor y cuáles son sus características. */
  static resumenDescriptor(d) {
    const hex = ModoProtegido.hex;
    if (d.esNulo) return "Descriptor nulo: entrada vacía de la GDT. No describe ningún segmento.";
    if (d.S === 0) {
      return `Descriptor de sistema: ${d.typeName}, DPL ${d.DPL}, ${d.P ? "presente" : "no presente"}. Base ${hex(d.base, 8)}h, límite ${hex(d.limit, 8)}h.`;
    }
    const tam = ModoProtegido.tamanoLegible(d.limit);
    const tipo = d.isCode ? `código${d.conforming ? " conforme" : " no conforme"}` : `datos${d.expandDown ? " con expansión hacia abajo" : ""}`;
    const permisos = d.isCode ? (d.readable ? "ejecutable y legible" : "solo ejecutable") : (d.writable ? "de lectura y escritura" : "de solo lectura");
    const bits = d.isCode && d.L ? "64 bits (modo largo)" : d.DB ? "32 bits" : "16 bits";
    return `Segmento de ${tipo}, ${permisos}, DPL ${d.DPL}, ${bits}. Base ${hex(d.base, 8)}h, tamaño ${tam} (límite ${hex(d.limit, 8)}h, ${d.G ? "granularidad 4 KB" : "granularidad en bytes"}), ${d.P ? "presente" : "no presente"}.`;
  }

  /**
   * Valida un acceso y calcula la dirección lineal.
   * @param {object} p
   * @param {number} p.selector      0..0xFFFF
   * @param {"CS"|"DS"|"SS"} p.tipoSegmento
   * @param {number} p.offset        0..0xFFFFFFFF
   * @param {"execute"|"read"|"write"} p.operacion
   * @param {number} p.cpl           0..3
   * @param {string} [p.descriptor]  descriptor ingresado (hex de 16 dígitos o 64 bits en binario). Si se indica, se usa
   *                                 directamente y del selector solo se toman TI y RPL; si se omite, se busca en la GDT/LDT.
   * @returns {{ok:boolean, excepcion:string|null, verificaciones:{ok:boolean,text:string}[],
   *            pasos:string[], selector:object, tabla:string, descriptor:object|null,
   *            lineal:number|null, desbordo:boolean}}
   */
  validar({ selector, tipoSegmento, offset, operacion, cpl, descriptor }) {
    if (!Number.isInteger(selector) || selector < 0 || selector > 0xFFFF) throw new RangeError("selector fuera de rango (0000–FFFF)");
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xFFFFFFFF) throw new RangeError("offset fuera de rango (00000000–FFFFFFFF)");
    if (!["CS", "DS", "SS"].includes(tipoSegmento)) throw new RangeError("tipoSegmento debe ser CS, DS o SS");
    if (!["execute", "read", "write"].includes(operacion)) throw new RangeError("operacion debe ser execute, read o write");
    if (![0, 1, 2, 3].includes(cpl)) throw new RangeError("cpl debe ser 0, 1, 2 o 3");

    let descriptorIngresado = null;
    if (descriptor !== undefined && descriptor !== null) {
      const norm = ModoProtegido.normalizarDescriptor(descriptor);
      if (!norm.ok) throw new RangeError(norm.error);
      descriptorIngresado = norm.hex;
    }

    const hex = ModoProtegido.hex;
    const { indice, ti, rpl } = ModoProtegido.parseSelector(selector);
    const manual = descriptorIngresado !== null;
    const nombreTabla = manual ? "Descriptor ingresado" : ti ? "LDT" : "GDT";
    const tabla = ti ? this.ldt : this.gdt;
    const codigoError = "0x" + hex(selector & 0xFFFC, 4);
    const gp = `#GP(${codigoError})`;
    const segExc = tipoSegmento === "SS" ? "#SS(0)" : "#GP(0)";

    const verificaciones = [];
    let excepcion = null;
    let d = null;
    const check = (ok, okMsg, failMsg, exc) => {
      verificaciones.push({ ok, text: ok ? okMsg : failMsg });
      if (!ok && !excepcion) excepcion = exc;
      return ok;
    };

    validacion: {
      if (manual) {
        // 1) Descriptor ingresado: no se consulta ninguna tabla; del selector solo importan TI y RPL.
        verificaciones.push({ ok: true, text: `Descriptor ingresado directamente (${descriptorIngresado}h); del selector se usan RPL = ${rpl} y TI = ${ti}, el índice ${indice} no se consulta.` });
        d = ModoProtegido.parseDescriptor(descriptorIngresado);
      } else {
        // 1) Selector
        if (!check(!(ti === 0 && indice === 0),
          "El selector no es nulo.",
          "Selector nulo (GDT, índice 0): no puede usarse para acceder a memoria.", "#GP(0)")) break validacion;
        if (!check(indice < tabla.length,
          `Índice ${indice} dentro de la ${nombreTabla} (${tabla.length} descriptores).`,
          `Índice ${indice} fuera del límite de la ${nombreTabla} (solo ${tabla.length} descriptores).`, gp)) break validacion;

        d = ModoProtegido.parseDescriptor(tabla[indice].raw);
      }

      // 2) Descriptor
      if (!check(d.S === 1, "S = 1: descriptor de código o datos.",
        "S = 0: es un descriptor de sistema y no puede cargarse en CS, DS ni SS.", gp)) break validacion;
      if (!check(d.P === 1, "P = 1: el segmento está presente en memoria.",
        "P = 0: el segmento no está presente.", tipoSegmento === "SS" ? `#SS(${codigoError})` : `#NP(${codigoError})`)) break validacion;

      // 3) Tipo de segmento y privilegios al cargar el registro
      if (tipoSegmento === "CS") {
        if (!check(d.isCode, "El descriptor es de código, válido para CS.",
          "CS requiere un segmento de código (bit 3 del tipo = 1).", gp)) break validacion;
        if (d.conforming) {
          if (!check(d.DPL <= cpl, `Código conforme: DPL (${d.DPL}) ≤ CPL (${cpl}).`,
            `Código conforme: DPL (${d.DPL}) debe ser ≤ CPL (${cpl}).`, gp)) break validacion;
        } else if (!check(rpl <= cpl && d.DPL === cpl,
          `Código no conforme: RPL (${rpl}) ≤ CPL (${cpl}) y DPL (${d.DPL}) = CPL.`,
          `Código no conforme: se exige RPL (${rpl}) ≤ CPL (${cpl}) y DPL (${d.DPL}) = CPL (${cpl}).`, gp)) break validacion;
      } else if (tipoSegmento === "DS") {
        if (!check(!d.isCode || d.readable, "El descriptor puede cargarse en DS.",
          "Un segmento de código solo puede cargarse en DS si es legible (R = 1).", gp)) break validacion;
        if (!d.conforming) {
          const ef = Math.max(cpl, rpl);
          if (!check(ef <= d.DPL, `Privilegio: máx(CPL ${cpl}, RPL ${rpl}) = ${ef} ≤ DPL (${d.DPL}).`,
            `Privilegio: máx(CPL ${cpl}, RPL ${rpl}) = ${ef} excede el DPL (${d.DPL}).`, gp)) break validacion;
        } else {
          check(true, "Código conforme: no se compara el DPL al cargar DS.", "", null);
        }
      } else { // SS
        if (!check(!d.isCode && d.writable, "El descriptor es un segmento de datos escribible, válido para SS.",
          "SS requiere un segmento de datos escribible (tipo datos con W = 1).", gp)) break validacion;
        if (!check(rpl === cpl && d.DPL === cpl, `RPL (${rpl}) = DPL (${d.DPL}) = CPL (${cpl}).`,
          `SS exige RPL (${rpl}) = DPL (${d.DPL}) = CPL (${cpl}).`, gp)) break validacion;
      }

      // 4) Permisos de la operación
      if (operacion === "execute") {
        if (!check(tipoSegmento === "CS" && d.isCode, "Ejecución permitida: segmento de código cargado en CS.",
          "Solo un segmento de código cargado en CS puede ejecutarse.", "#GP(0)")) break validacion;
      } else if (operacion === "read") {
        if (!check(!d.isCode || d.readable, "Lectura permitida por el descriptor.",
          "Lectura denegada: el segmento de código no es legible (R = 0).", segExc)) break validacion;
      } else if (!check(!d.isCode && d.writable, "Escritura permitida: segmento de datos escribible.",
        d.isCode ? "Escritura denegada: los segmentos de código nunca son escribibles."
                 : "Escritura denegada: segmento de datos de solo lectura (W = 0).", segExc)) break validacion;

      // 5) Límite
      if (d.expandDown) {
        const max = d.DB ? 0xFFFFFFFF : 0xFFFF;
        check(offset > d.limit && offset <= max,
          `Expansión abajo: ${hex(d.limit, 8)}h < offset ${hex(offset, 8)}h ≤ ${hex(max, 8)}h.`,
          `Expansión abajo: el offset ${hex(offset, 8)}h debe estar entre ${hex(d.limit + 1, 8)}h y ${hex(max, 8)}h.`, segExc);
      } else {
        check(offset <= d.limit,
          `Offset ${hex(offset, 8)}h ≤ límite efectivo ${hex(d.limit, 8)}h.`,
          `Offset ${hex(offset, 8)}h excede el límite efectivo ${hex(d.limit, 8)}h.`, segExc);
      }
    }

    // Procedimiento paso a paso
    const pasos = [
      `Selector ${hex(selector, 4)}h = ${selector.toString(2).padStart(16, "0").replace(/(.{4})(?=.)/g, "$1 ")}b → índice ${indice}, TI = ${ti} (${nombreTabla}), RPL = ${rpl}.`
    ];
    if (d) {
      pasos.push(manual
        ? `Descriptor ingresado: ${d.raw}h (el índice ${indice} del selector no se usa para buscarlo).`
        : `Descriptor leído: ${nombreTabla}[${indice}] = ${d.raw}h.`);
      pasos.push(`Base = ${hex(d.base, 8)}h; límite = ${hex(d.limitRaw, 5)}h${d.G ? " × 4 KB (G = 1) → " : " (G = 0) → "}${hex(d.limit, 8)}h.`);
    }
    let lineal = null, desbordo = false;
    if (!excepcion) {
      const suma = d.base + offset;
      desbordo = suma > 0xFFFFFFFF;
      lineal = suma % 0x100000000;
      pasos.push(`Dirección lineal = base + offset = ${hex(d.base, 8)}h + ${hex(offset, 8)}h = ${hex(suma, 9)}h` +
        (desbordo ? ` → se trunca a 32 bits: ${hex(lineal, 8)}h.` : "."));
      pasos.push("Con paginación desactivada, la dirección lineal coincide con la física.");
    } else {
      pasos.push(`Validación interrumpida: se genera la excepción ${excepcion}.`);
    }

    return {
      ok: !excepcion, excepcion, verificaciones, pasos,
      selector: { valor: selector, indice, ti, rpl, codigoError },
      tabla: nombreTabla, origen: manual ? "manual" : "tabla", descriptor: d, lineal, desbordo
    };
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = ModoProtegido;
else if (typeof window !== "undefined") window.ModoProtegido = ModoProtegido;
