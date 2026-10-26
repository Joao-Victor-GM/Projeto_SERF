/* ==========================================================
   S.E.R.F. — UI / ESTILOS-DINAMICOS.JS
   A CSP não permite o atributo de estilo inline (sem 'unsafe-inline'
   em style-src): o navegador ignoraria o estilo de um HTML injetado.
   Estilo calculado no JS (altura de barra, cor de status) vai em
   data-css="..."; este script aplica pelo CSSOM (element.style),
   que a CSP permite. Estilo fixo vai em classe, no .css.

   Carregado no <head> de todas as páginas, antes dos outros
   scripts: o MutationObserver aplica em qualquer HTML novo antes
   da pintura (innerHTML, SweetAlert, etc.).
   ========================================================== */

"use strict";

(function () {
    function aplicar(elemento) {
        const css = elemento.getAttribute("data-css");
        if (css === null) return;
        elemento.style.cssText += ";" + css;
        elemento.removeAttribute("data-css");
    }

    function varrer(no) {
        if (no.nodeType !== Node.ELEMENT_NODE) return;
        aplicar(no);
        no.querySelectorAll("[data-css]").forEach(aplicar);
    }

    new MutationObserver(mudancas => {
        for (const mudanca of mudancas) {
            if (mudanca.type === "attributes") aplicar(mudanca.target);
            else mudanca.addedNodes.forEach(varrer);
        }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-css"] });

    varrer(document.documentElement);
})();
