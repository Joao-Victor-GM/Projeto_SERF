/* =========================================================
   SERF - LANDING.JS
   Controla interações gerais da Landing Page.
   ========================================================= */

// Seleciona os elementos que terão animação ao entrar na tela
const elementosReveal = document.querySelectorAll(".reveal");


// Observa quando os elementos aparecem na área visível da página
const observer = new IntersectionObserver((entradas) => {

    entradas.forEach((entrada) => {

        // Quando o elemento entra na tela, adiciona a classe de animação
        if (entrada.isIntersecting) {
            entrada.target.classList.add("reveal-ativo");
        }

    });

}, {
    threshold: 0.20
});


// Inicia a observação dos elementos
elementosReveal.forEach((elemento) => {
    observer.observe(elemento);
});