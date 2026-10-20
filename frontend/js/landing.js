/* =========================================================
   SERF - LANDING.JS
   Interações da página pública: menu do celular, cabeçalho
   ao rolar e revelação dos blocos.
   ========================================================= */

"use strict";

(function () {

    // A revelação só esconde blocos se este script rodou (sem JS, tudo aparece)
    document.body.classList.add("lp-js");

    /* ---------------- MENU DO CELULAR ---------------- */

    const botao = document.getElementById("lpMenuBotao");
    const menu = document.getElementById("lpMenu");

    function definirMenu(aberto) {
        menu.classList.toggle("aberto", aberto);
        botao.setAttribute("aria-expanded", String(aberto));
        botao.setAttribute("aria-label", aberto ? "Fechar menu" : "Abrir menu");
    }

    if (botao && menu) {
        botao.addEventListener("click", () => definirMenu(!menu.classList.contains("aberto")));

        // Escolher um destino fecha o menu
        menu.addEventListener("click", evento => {
            if (evento.target.closest("a")) definirMenu(false);
        });

        document.addEventListener("keydown", evento => {
            if (evento.key === "Escape" && menu.classList.contains("aberto")) {
                definirMenu(false);
                botao.focus();
            }
        });

        document.addEventListener("click", evento => {
            if (menu.classList.contains("aberto") && !evento.target.closest("#topo")) definirMenu(false);
        });
    }

    /* ---------------- CABEÇALHO AO ROLAR ---------------- */

    const topo = document.getElementById("topo");
    const atualizarTopo = () => topo?.classList.toggle("rolado", window.scrollY > 8);
    window.addEventListener("scroll", atualizarTopo, { passive: true });
    atualizarTopo();

    /* ---------------- REVELAÇÃO AO ROLAR ---------------- */

    const blocos = document.querySelectorAll(".reveal");

    if (!("IntersectionObserver" in window)) {
        blocos.forEach(bloco => bloco.classList.add("reveal-ativo"));
        return;
    }

    const observador = new IntersectionObserver(entradas => {
        entradas.forEach(entrada => {
            if (!entrada.isIntersecting) return;
            entrada.target.classList.add("reveal-ativo");
            observador.unobserve(entrada.target);   // revela uma vez só
        });
    }, { threshold: 0.15 });

    blocos.forEach(bloco => observador.observe(bloco));
})();
