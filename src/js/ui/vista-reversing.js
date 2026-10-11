/**
 * vista-reversing.js
 * Interfaz del simulador 03 (Descriptor Reversing): recibe 64 bits, valida el ingreso y muestra
 * qué descriptor es (mapa de bits por campos, campos decodificados y observaciones).
 * La decodificación la hace ModoProtegido (js/modo-protegido.js).
 */
class VistaReversing {
  /** Ejemplos rápidos: nombre → descriptor en hexadecimal (se convierten a binario al cargarlos). */
  static EJEMPLOS = [
    ["Código kernel", "00CF9A000000FFFF"],
    ["Datos usuario", "00CFF2000000FFFF"],
    ["Pila expansión abajo", "0040961000000FFF"],
    ["TSS", "0040895000000067"],
    ["No presente", "00401A4000000FFF"]
  ];

  /**
   * @param {ModoProtegido} modelo
   * @param {{alUsarEnProtegido?: (hex:string) => void}} opciones
   */
  constructor(modelo = new ModoProtegido(), { alUsarEnProtegido = () => {} } = {}) {
    this.modelo = modelo;
    this.alUsarEnProtegido = alUsarEnProtegido;
    this.hexActual = null;
    const byId = (id) => document.getElementById(id);
    this.el = {
      entrada: byId("rvInput"),
      contador: byId("rvCount"),
      analizar: byId("rvAnalyze"),
      limpiar: byId("rvClear"),
      ejemplos: byId("rvExamples"),
      error: byId("rvError"),
      resultado: byId("rvResult"),
      resumen: byId("rvSummary"),
      mapa: byId("rvBitmap"),
      hex: byId("rvHex"),
      tipo: byId("rvTipo"),
      campos: byId("rvFields"),
      observaciones: byId("rvWarnings"),
      usar: byId("rvUse")
    };

    this.crearEjemplos();
    this.el.analizar.addEventListener("click", () => this.analizar());
    this.el.limpiar.addEventListener("click", () => this.limpiar());
    this.el.usar.addEventListener("click", () => { if (this.hexActual) this.alUsarEnProtegido(this.hexActual); });
    this.el.entrada.addEventListener("input", () => this.alEscribir());
    this.el.entrada.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.analizar(); }
    });
    this.actualizarContador();
  }

  crearEjemplos() {
    VistaReversing.EJEMPLOS.forEach(([nombre, hex]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip-btn";
      b.textContent = nombre;
      b.title = hex + "h";
      b.addEventListener("click", () => this.cargar(ModoProtegido.hexABinario(hex)));
      this.el.ejemplos.appendChild(b);
    });
  }

  /** Coloca un valor binario en la caja (agrupado de a 8 bits) y lo analiza. */
  cargar(bits) {
    this.el.entrada.value = bits.match(/.{1,8}/g).join(" ");
    this.actualizarContador();
    this.analizar();
  }

  limpiar() {
    this.el.entrada.value = "";
    this.el.error.textContent = "";
    this.el.resultado.hidden = true;
    this.hexActual = null;
    this.el.entrada.removeAttribute("aria-invalid");
    this.actualizarContador();
    this.el.entrada.focus();
  }

  /** Cuenta los bits mientras se escribe y avisa de inmediato si hay caracteres no válidos. */
  alEscribir() {
    this.actualizarContador();
    const v = ModoProtegido.validarBinario64(this.el.entrada.value);
    if (v.ok) { this.analizar(); return; }
    this.el.resultado.hidden = true;
    this.hexActual = null;
    const soloFaltan = v.cantidad < 64 && !/[^01]/.test(v.bits);
    this.el.error.textContent = soloFaltan || v.cantidad === 0 ? "" : v.error;
    this.marcarInvalido(!!this.el.error.textContent);
  }

  actualizarContador() {
    const v = ModoProtegido.validarBinario64(this.el.entrada.value);
    this.el.contador.textContent = `${v.cantidad} / 64 bits`;
    this.el.contador.className = "rv-counter" + (v.ok ? " ok" : v.cantidad > 64 || /[^01]/.test(v.bits) ? " fail" : "");
  }

  marcarInvalido(invalido) {
    if (invalido) this.el.entrada.setAttribute("aria-invalid", "true");
    else this.el.entrada.removeAttribute("aria-invalid");
  }

  analizar() {
    const v = ModoProtegido.validarBinario64(this.el.entrada.value);
    if (!v.ok) {
      this.el.error.textContent = v.error;
      this.marcarInvalido(true);
      this.el.resultado.hidden = true;
      this.hexActual = null;
      return;
    }
    this.el.error.textContent = "";
    this.marcarInvalido(false);
    const d = ModoProtegido.parseDescriptor(v.hex);
    this.hexActual = v.hex;
    this.el.resultado.hidden = false;
    this.el.resumen.textContent = d.resumen;
    this.el.hex.textContent = d.raw + "h";
    this.el.tipo.textContent = d.typeName;
    this.renderMapa(d);
    this.renderCampos(d);
    this.renderObservaciones(d);
  }

  /** Dibuja los 64 bits agrupados por campo y coloreados (base, límite, acceso, flags). */
  renderMapa(d) {
    const etiquetasFlags = ["G", "D/B", "L", "AVL"];
    const etiquetasAcceso = d.S === 1
      ? ["P", "DPL", "DPL", "S", d.isCode ? "Cód" : "Dat", d.isCode ? "C" : "E", d.isCode ? "R" : "W", "A"]
      : ["P", "DPL", "DPL", "S", "T3", "T2", "T1", "T0"];
    const porCampo = { flags: etiquetasFlags, acceso: etiquetasAcceso };
    const hijos = ModoProtegido.CAMPOS_BITS.map((c) => {
      const seg = document.createElement("div");
      seg.className = `seg ${c.grupo}`;
      const fila = document.createElement("div");
      fila.className = "seg-bits";
      [...d.bits.slice(c.desde, c.hasta)].forEach((bit, i) => {
        const cel = document.createElement("span");
        cel.className = "bitcell";
        cel.title = `bit ${63 - (c.desde + i)}`;
        const b = document.createElement("b");
        b.textContent = bit;
        const l = document.createElement("i");
        l.textContent = porCampo[c.id]?.[i] ?? "";
        cel.append(b, l);
        fila.appendChild(cel);
      });
      const nombre = document.createElement("div");
      nombre.className = "seg-label";
      nombre.textContent = c.etiqueta;
      seg.append(fila, nombre);
      return seg;
    });
    this.el.mapa.replaceChildren(...hijos);
  }

  renderCampos(d) {
    const hex = ModoProtegido.hex;
    const si = (v) => (v ? "1" : "0");
    const campos = [
      ["BASE", `${hex(d.base, 8)}h (${d.base.toLocaleString("es-CO")})`],
      ["LÍMITE (20 BITS)", `${hex(d.limitRaw, 5)}h`],
      ["LÍMITE EFECTIVO", `${hex(d.limit, 8)}h · ${ModoProtegido.tamanoLegible(d.limit)}`],
      ["G (GRANULARIDAD)", d.G ? "1 · páginas de 4 KB" : "0 · bytes"],
      ["D/B", d.isCode ? (d.DB ? "1 · 32 bits" : "0 · 16 bits") : (d.DB ? "1 · pila/límite de 32 bits" : "0 · pila/límite de 16 bits")],
      ["L (64 BITS)", d.L ? "1 · código de 64 bits" : "0"],
      ["AVL", si(d.AVL) + " · disponible para el sistema"],
      ["P (PRESENTE)", d.P ? "1 · presente" : "0 · no presente"],
      ["DPL", `${d.DPL} · ${d.DPL === 0 ? "máximo privilegio (kernel)" : d.DPL === 3 ? "usuario" : "nivel intermedio"}`],
      ["S", d.S ? "1 · código/datos" : "0 · sistema"],
      ["TIPO", `${hex(d.type)}h (${d.type.toString(2).padStart(4, "0")}b) · ${d.typeName}`],
      ["BYTE DE ACCESO", `${hex(d.access, 2)}h`]
    ];
    if (d.S === 1) {
      if (d.isCode) {
        campos.push(["CONFORME (C)", d.conforming ? "Sí" : "No"], ["LEGIBLE (R)", d.readable ? "Sí" : "No · solo ejecución"]);
      } else {
        campos.push(["EXPANSIÓN ABAJO (E)", d.expandDown ? "Sí" : "No"], ["ESCRIBIBLE (W)", d.writable ? "Sí" : "No · solo lectura"]);
      }
      campos.push(["ACCEDIDO (A)", d.accessed ? "Sí" : "No"]);
    }

    const filas = campos.map(([k, v]) => {
      const wrap = document.createElement("div");
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      wrap.append(dt, dd);
      return wrap;
    });
    this.el.campos.replaceChildren(...filas);
  }

  renderObservaciones(d) {
    const items = d.advertencias.length ? d.advertencias : ["Sin observaciones: el descriptor es coherente."];
    this.el.observaciones.replaceChildren(...items.map((texto) => {
      const li = document.createElement("li");
      li.textContent = texto;
      return li;
    }));
  }
}
