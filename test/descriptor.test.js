const test = require("node:test");
const assert = require("node:assert/strict");
const ModoProtegido = require("../src/js/modo-protegido.js");

const CODIGO_KERNEL = "00CF9A000000FFFF";
const CODIGO_KERNEL_BIN = "00000000 11001111 10011010 00000000 00000000 00000000 11111111 11111111";

// ---------- Entrada binaria (Reversing) ----------
test("validarBinario64 acepta 64 bits, con o sin separadores, y entrega el hexadecimal", () => {
  const sin = ModoProtegido.validarBinario64(CODIGO_KERNEL_BIN.replace(/ /g, ""));
  assert.equal(sin.ok, true);
  assert.equal(sin.hex, CODIGO_KERNEL);
  const con = ModoProtegido.validarBinario64(CODIGO_KERNEL_BIN);
  assert.equal(con.hex, CODIGO_KERNEL);
  assert.equal(ModoProtegido.validarBinario64(CODIGO_KERNEL_BIN.replace(/ /g, "-")).ok, true);
});

test("validarBinario64 rechaza vacío, caracteres no binarios y longitudes incorrectas", () => {
  assert.equal(ModoProtegido.validarBinario64("").ok, false);
  assert.equal(ModoProtegido.validarBinario64(null).ok, false);

  const malo = ModoProtegido.validarBinario64("0".repeat(10) + "2" + "0".repeat(53));
  assert.equal(malo.ok, false);
  assert.match(malo.error, /posición 11/);

  const corto = ModoProtegido.validarBinario64("1".repeat(63));
  assert.equal(corto.ok, false);
  assert.match(corto.error, /Falta 1 bit/);

  const corto2 = ModoProtegido.validarBinario64("1".repeat(60));
  assert.match(corto2.error, /Faltan 4 bits/);

  const largo = ModoProtegido.validarBinario64("1".repeat(65));
  assert.equal(largo.ok, false);
  assert.match(largo.error, /Sobra 1 bit/);
});

test("hexABinario y binarioAHex son inversas para todos los descriptores de ejemplo", () => {
  for (const e of [...ModoProtegido.GDT_EJEMPLO, ...ModoProtegido.LDT_EJEMPLO]) {
    const bits = ModoProtegido.hexABinario(e.raw);
    assert.equal(bits.length, 64);
    assert.equal(ModoProtegido.binarioAHex(bits), e.raw);
    assert.equal(ModoProtegido.validarBinario64(bits).hex, e.raw);
  }
});

// ---------- Entrada flexible (hex o binario) ----------
test("normalizarDescriptor acepta hexadecimal, 0x, sufijo h, minúsculas y binario", () => {
  assert.deepEqual(ModoProtegido.normalizarDescriptor(CODIGO_KERNEL), { ok: true, error: null, hex: CODIGO_KERNEL, formato: "hex" });
  assert.equal(ModoProtegido.normalizarDescriptor("0x00cf9a000000ffff").hex, CODIGO_KERNEL);
  assert.equal(ModoProtegido.normalizarDescriptor("00CF9A000000FFFFh").hex, CODIGO_KERNEL);
  assert.equal(ModoProtegido.normalizarDescriptor("00CF 9A00 0000 FFFF").hex, CODIGO_KERNEL);
  const bin = ModoProtegido.normalizarDescriptor(CODIGO_KERNEL_BIN);
  assert.equal(bin.ok, true);
  assert.equal(bin.formato, "binario");
  assert.equal(bin.hex, CODIGO_KERNEL);
});

test("normalizarDescriptor rechaza entradas inválidas con un mensaje claro", () => {
  for (const malo of ["", "   ", "xyz", "00CF9A", "00CF9A000000FFFFAA", "00CF9A000000FFFG", "1".repeat(63)]) {
    const r = ModoProtegido.normalizarDescriptor(malo);
    assert.equal(r.ok, false, `debía rechazar «${malo}»`);
    assert.ok(r.error.length > 0);
    assert.equal(r.hex, null);
  }
  assert.match(ModoProtegido.normalizarDescriptor("00CF9A").error, /16 dígitos \(tienes 6\)/);
  assert.match(ModoProtegido.normalizarDescriptor("1".repeat(63)).error, /Falta 1 bit/);
});

// ---------- Decodificación ----------
test("parseDescriptor lanza RangeError si el formato no es de 16 dígitos hexadecimales", () => {
  for (const malo of ["xyz", "00CF9A", "", "00CF9A000000FFFFF", "00CF9A000000FFFG", null, undefined, 123]) {
    assert.throws(() => ModoProtegido.parseDescriptor(malo), RangeError);
  }
});

test("parseDescriptor decodifica un segmento flat de código y genera el resumen", () => {
  const d = ModoProtegido.parseDescriptor(CODIGO_KERNEL.toLowerCase());
  assert.equal(d.raw, CODIGO_KERNEL);
  assert.equal(d.bits, CODIGO_KERNEL_BIN.replace(/ /g, ""));
  assert.equal(d.base, 0);
  assert.equal(d.limit, 0xFFFFFFFF);
  assert.equal(d.categoria, "codigo");
  assert.equal(d.DPL, 0);
  assert.equal(d.conforming, false);
  assert.match(d.resumen, /código no conforme/);
  assert.match(d.resumen, /4 GB/);
  assert.match(d.resumen, /32 bits/);
  assert.ok(d.advertencias.some((a) => /flat/.test(a)));
});

test("parseDescriptor reensambla la base a partir de sus tres fragmentos", () => {
  // base = 12 | 34 | 5678 → 0x12345678 ; límite 0x0ABCD
  const d = ModoProtegido.parseDescriptor("12409234" + "5678" + "ABCD");
  assert.equal(d.base, 0x12345678);
  assert.equal(d.limitRaw, 0x0ABCD);
  assert.equal(d.limit, 0x0ABCD);
});

test("CAMPOS_BITS cubre exactamente los 64 bits sin huecos ni solapes", () => {
  let pos = 0;
  for (const c of ModoProtegido.CAMPOS_BITS) {
    assert.equal(c.desde, pos);
    pos = c.hasta;
  }
  assert.equal(pos, 64);
});

test("los descriptores de sistema muestran su nombre y los reservados se advierten", () => {
  assert.equal(ModoProtegido.parseDescriptor("0040895000000067").typeName, "TSS 32 bits (disponible)");
  assert.equal(ModoProtegido.parseDescriptor("00408B5000000067").typeName, "TSS 32 bits (ocupado)");
  assert.equal(ModoProtegido.parseDescriptor("0040820000001000").typeName, "LDT");
  const r = ModoProtegido.parseDescriptor("0040800000000FFF"); // S=0, tipo 0 reservado
  assert.match(r.typeName, /reservado/);
  assert.ok(r.advertencias.some((a) => /reservado/.test(a)));
  assert.ok(ModoProtegido.parseDescriptor("0040895000000067").advertencias.some((a) => /sistema/.test(a)));
});

test("advertencias: nulo, no presente, L=1 con D/B=1, L en datos y expansión abajo", () => {
  const nulo = ModoProtegido.parseDescriptor("0000000000000000");
  assert.equal(nulo.esNulo, true);
  assert.match(nulo.resumen, /nulo/);

  const noPresente = ModoProtegido.parseDescriptor("00401A4000000FFF");
  assert.equal(noPresente.P, 0);
  assert.ok(noPresente.advertencias.some((a) => /no está presente/.test(a)));

  // código con L=1 y D/B=1 (flags = 0x60 | 0xC0 -> G=1, DB=1, L=1)
  const invalida = ModoProtegido.parseDescriptor("00EF9A000000FFFF");
  assert.ok(invalida.advertencias.some((a) => /Combinación inválida/.test(a)));
  // código de 64 bits correcto: L=1, D/B=0
  const largo = ModoProtegido.parseDescriptor("00AF9A000000FFFF");
  assert.ok(largo.advertencias.some((a) => /64 bits/.test(a)));
  assert.match(largo.resumen, /64 bits/);
  // datos con L=1
  const datosL = ModoProtegido.parseDescriptor("00AF92000000FFFF");
  assert.ok(datosL.advertencias.some((a) => /segmento de datos/.test(a)));

  const abajo = ModoProtegido.parseDescriptor("0040961000000FFF");
  assert.equal(abajo.expandDown, true);
  assert.ok(abajo.advertencias.some((a) => /Expansión hacia abajo/.test(a)));
});

test("un descriptor coherente y común no genera advertencias de error", () => {
  const d = ModoProtegido.parseDescriptor("00409A2000001FFF");
  assert.deepEqual(d.advertencias.filter((a) => /inválida|reservado/.test(a)), []);
});

test("tamanoLegible expresa el límite en GB, MB, KB o bytes", () => {
  assert.equal(ModoProtegido.tamanoLegible(0xFFFFFFFF), "4 GB");
  assert.equal(ModoProtegido.tamanoLegible(0xFFFFF), "1 MB");
  assert.equal(ModoProtegido.tamanoLegible(0xFFF), "4 KB");
  assert.equal(ModoProtegido.tamanoLegible(0x67), "104 bytes");
  assert.equal(ModoProtegido.tamanoLegible(0), "1 byte");
});

// ---------- validar() con descriptor ingresado ----------
const mp = new ModoProtegido();
const base = { tipoSegmento: "CS", offset: 0x1000, operacion: "execute", cpl: 0 };

test("validar con descriptor ingresado usa su base y no consulta la tabla", () => {
  const r = mp.validar({ ...base, selector: 0x0008, descriptor: "00CF9A100000FFFF" }); // base 0x00100000
  assert.equal(r.ok, true);
  assert.equal(r.origen, "manual");
  assert.equal(r.tabla, "Descriptor ingresado");
  assert.equal(r.lineal, 0x00101000);
});

test("validar con descriptor ingresado ignora el índice del selector (incluso un selector nulo o fuera de tabla)", () => {
  assert.equal(mp.validar({ ...base, selector: 0x0000, descriptor: CODIGO_KERNEL }).ok, true);
  assert.equal(mp.validar({ ...base, selector: 0xFFF8, descriptor: CODIGO_KERNEL }).ok, true);
  // …pero con origen tabla el selector nulo sigue fallando
  const t = mp.validar({ ...base, selector: 0x0000 });
  assert.equal(t.ok, false);
  assert.equal(t.origen, "tabla");
});

test("validar con descriptor ingresado sigue aplicando RPL, DPL y CPL", () => {
  // código kernel (DPL 0) con CPL 3 en CS → #GP
  const r = mp.validar({ ...base, selector: 0x0003, cpl: 3, descriptor: CODIGO_KERNEL });
  assert.equal(r.ok, false);
  assert.match(r.excepcion, /#GP/);
  // código de usuario (DPL 3), CPL 3, RPL 3 → ok
  assert.equal(mp.validar({ ...base, selector: 0x001B, cpl: 3, descriptor: "00CFFA000000FFFF" }).ok, true);
});

test("validar con descriptor ingresado respeta tipo de segmento, operación y límite", () => {
  // descriptor de código cargado en SS → #GP
  assert.equal(mp.validar({ ...base, selector: 0, tipoSegmento: "SS", operacion: "write", descriptor: CODIGO_KERNEL }).ok, false);
  // datos de solo lectura, escritura → #GP(0)
  const ro = mp.validar({ ...base, selector: 0, tipoSegmento: "DS", operacion: "write", descriptor: "0040903000000FFF" });
  assert.equal(ro.ok, false);
  assert.equal(ro.excepcion, "#GP(0)");
  // límite excedido (límite 0xFFF, G=0)
  const fuera = mp.validar({ ...base, selector: 0, tipoSegmento: "DS", operacion: "read", offset: 0x2000, descriptor: "0040920000000FFF" });
  assert.equal(fuera.ok, false);
  // no presente → #NP
  const np = mp.validar({ ...base, selector: 0x0008, descriptor: "00401A4000000FFF" });
  assert.match(np.excepcion, /#NP/);
});

test("validar acepta el descriptor en binario y en minúsculas", () => {
  assert.equal(mp.validar({ ...base, selector: 0, descriptor: CODIGO_KERNEL_BIN }).ok, true);
  assert.equal(mp.validar({ ...base, selector: 0, descriptor: CODIGO_KERNEL.toLowerCase() }).ok, true);
});

test("validar lanza RangeError con un descriptor ingresado inválido", () => {
  for (const malo of ["", "xyz", "00CF9A", "1".repeat(63)]) {
    assert.throws(() => mp.validar({ ...base, selector: 8, descriptor: malo }), RangeError);
  }
});

test("validar sin descriptor se comporta como antes (lee la GDT/LDT)", () => {
  const r = mp.validar({ ...base, selector: 0x0008 });
  assert.equal(r.ok, true);
  assert.equal(r.origen, "tabla");
  assert.equal(r.tabla, "GDT");
});
