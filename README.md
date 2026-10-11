# Validación modo real y modo protegido — Arquitectura de Computadores · x86

🚀 **[Ver Demo en Vivo (GitHub Pages)](https://camilobautist.github.io/Pagina_Arquitectura/)**

Laboratorio interactivo para calcular direcciones de memoria en **modo real** y **modo protegido**
y (próximamente) analizar descriptores binarios de 64 bits. No tiene dependencias: solo necesita **Node.js 18 o superior**.

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
    app.js              ← punto de entrada: crea la navegación y las vistas
test/                   ← pruebas automáticas de cada clase
build.js                ← validación + copia a dist/
serve.js                ← servidor estático
```

## Uso de las clases

```js
// Modo real:  física = segmento × 16 + offset
new ModoReal().calcular({ segmento: 0x1234, offset: 0x0010 }).fisica;   // 0x12350

// Modo protegido: selector → GDT/LDT → descriptor → lineal = base + offset
new ModoProtegido().validar({
  selector: 0x0008, tipoSegmento: "CS", offset: 0x1000, operacion: "execute", cpl: 0
});  // { ok, excepcion, lineal, verificaciones, pasos, descriptor, ... }
```

`ModoProtegido` valida: selector nulo, límite de la tabla, S, P, tipo y privilegios (CS/DS/SS con CPL, RPL y DPL),
permisos de la operación (ejecutar/leer/escribir) y límite del segmento (incluida expansión hacia abajo).
Las excepciones posibles son `#GP`, `#NP` y `#SS`. Las tablas de ejemplo están en `ModoProtegido.GDT_EJEMPLO` y `LDT_EJEMPLO`,
o se pasan propias con `new ModoProtegido({ gdt, ldt })`.

## Pendiente

- Módulo 03 **Descriptor Reversing**: reutilizar `ModoProtegido.parseDescriptor(hex)` para la decodificación.
- Laboratorio de retos.
