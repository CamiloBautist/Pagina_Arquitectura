/**
 * app.js
 * Punto de entrada: crea la navegación entre vistas y la interfaz de cada simulador.
 *   - Lógica pura:  ModoReal, ModoProtegido        (js/modo-real.js, js/modo-protegido.js)
 *   - Interfaz:     VistaModoReal, VistaModoProtegido, VistaReversing, Navegacion   (js/ui/)
 */
const app = {};
app.navegacion = new Navegacion();
app.modoReal = new VistaModoReal(new ModoReal());
app.modoProtegido = new VistaModoProtegido(new ModoProtegido());
app.reversing = new VistaReversing(new ModoProtegido(), {
  // Botón «Usar este descriptor en el modo protegido»: lo carga en el simulador 02 y cambia de vista
  alUsarEnProtegido: (hex) => {
    app.modoProtegido.cargarDescriptor(hex);
    location.hash = "#modo-protegido";
  }
});
