# Validación modo real y modo protegido — Arquitectura de Computadores · x86

🚀 **[Ver Demo en Vivo (GitHub Pages)](https://camilobautist.github.io/Pagina_Arquitectura/)**

Laboratorio interactivo para calcular direcciones de memoria en **modo real** y **modo protegido**
y analizar descriptores binarios de 64 bits (**Descriptor Reversing**). No tiene dependencias: solo necesita **Node.js 18 o superior**.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Servidor local en http://localhost:5173 |
| `npm test` | Ejecuta las pruebas de las clases (`node --test`) |
| `npm run build` | Valida sintaxis y referencias, y genera `dist/` listo para publicar |
| `npm run preview` | Sirve `dist/` para revisar el build |

> No hace falta `npm install`. Para publicar, sube el contenido de `dist/` a cualquier hosting estático (GitHub Pages, Netlify…).
> También funciona abriendo `index.html` directamente en el navegador.

## Estructura

```
index.html
src/
  css/styles.css
  js/
    modo-real.js        ← clase ModoReal        (lógica pura, sin DOM)
    modo-protegido.js   ← clase ModoProtegido   (lógica pura, sin DOM)
    ui/
      navegacion.js           ← clase Navegacion          (muestra solo la vista del menú: #inicio, #modo-real…)
      vista-modo-real.js      ← clase VistaModoReal       (formulario del simulador 01)
      vista-modo-protegido.js ← clase VistaModoProtegido  (formulario, descriptor y tablas GDT/LDT del simulador 02)
      vista-reversing.js      ← clase VistaReversing      (simulador 03: 64 bits → campos del descriptor)
    app.js              ← punto de entrada: crea la navegación y las vistas
test/                   ← pruebas automáticas de cada clase
build.js                ← validación + copia a dist/
serve.js                ← servidor estático
```

## Uso de las clases

```js
// Modo real:  física = segmento × 16 + offset
new ModoReal().calcular({ segmento: 0x1234, offset: 0x0010 }).fisica;   // 0x12350

// Modo protegido con descriptor ingresado (hex de 16 dígitos o 64 bits en binario):
// lineal = base del descriptor + offset. Del selector solo se usan TI y RPL.
new ModoProtegido().validar({
  selector: 0x0008, tipoSegmento: "CS", offset: 0x1000, operacion: "execute", cpl: 0,
  descriptor: "00CF9A000000FFFF"
});  // { ok, excepcion, lineal, verificaciones, pasos, descriptor, origen: "manual", ... }

// Sin `descriptor`, se busca en la GDT/LDT según el índice y TI del selector (origen: "tabla").

// Reversing: validar 64 bits y decodificar
const v = ModoProtegido.validarBinario64("00000000 11001111 10011010 00000000 00000000 00000000 11111111 11111111");
v.ok;                                     // true   (si no: v.error explica qué falla)
const d = ModoProtegido.parseDescriptor(v.hex);
d.resumen;       // "Segmento de código no conforme, ejecutable y legible, DPL 0, 32 bits. Base 00000000h, tamaño 4 GB…"
d.advertencias;  // observaciones: no presente, L=1 con D/B=1, tipo de sistema reservado, etc.
```

## Los tres módulos

1. **Modo real**: segmento y offset en hexadecimal → dirección física, con el procedimiento paso a paso.
2. **Modo protegido**: descriptor (16 dígitos hexadecimales o 64 bits), selector, tipo de segmento (CS/DS/SS), offset, operación y CPL →
   validaciones, excepción (`#GP`, `#NP`, `#SS`) o dirección lineal. El origen del descriptor puede ser *manual* o *leído de la GDT/LDT*.
3. **Descriptor Reversing**: 64 bits en binario (bit 63 a la izquierda; admite espacios y guiones) → se valida el ingreso
   (solo 0/1, exactamente 64) y se muestra el mapa de bits por campos (base, límite, acceso, flags), los campos decodificados,
   un resumen en lenguaje natural y observaciones. Tiene ejemplos rápidos y un botón para llevar el descriptor al simulador de modo protegido.

`ModoProtegido` valida: selector nulo, límite de la tabla (en modo tabla), S, P, tipo y privilegios (CS/DS/SS con CPL, RPL y DPL),
permisos de la operación (ejecutar/leer/escribir) y límite del segmento (incluida expansión hacia abajo).
Las tablas de ejemplo están en `ModoProtegido.GDT_EJEMPLO` y `LDT_EJEMPLO`, o se pasan propias con `new ModoProtegido({ gdt, ldt })`.

## Pendiente

- Laboratorio de retos.
