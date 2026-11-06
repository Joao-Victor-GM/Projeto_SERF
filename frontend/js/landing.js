/* =========================================================
   SERF - LANDING.JS
   Interações da página pública: menu do celular, cabeçalho
   ao rolar e revelação resiliente dos blocos por rolagem,
   clique em âncora ou acesso direto com #hash na URL.
   ========================================================= */

"use strict";

(function () {
    const SELETOR_REVEAL = ".reveal, .lp-revelar";

    /* ---------------- MENU DO CELULAR ---------------- */

    const botao = document.getElementById("lpMenuBotao");
    const menu = document.getElementById("lpMenu");

    function definirMenu(aberto) {
        if (!menu || !botao) return;
        menu.classList.toggle("aberto", aberto);
        botao.setAttribute("aria-expanded", String(aberto));
        botao.setAttribute("aria-label", aberto ? "Fechar menu" : "Abrir menu");
    }

    if (botao && menu) {
        botao.addEventListener("click", () => definirMenu(!menu.classList.contains("aberto")));

        // Escolher um destino fecha o menu
        menu.addEventListener("click", evento => {
            const alvo = evento.target instanceof Element ? evento.target : evento.target?.parentElement;
            if (alvo?.closest("a")) definirMenu(false);
        });

        document.addEventListener("keydown", evento => {
            if (evento.key === "Escape" && menu.classList.contains("aberto")) {
                definirMenu(false);
                botao.focus();
            }
        });

        document.addEventListener("click", evento => {
            const alvo = evento.target instanceof Element ? evento.target : evento.target?.parentElement;
            if (menu.classList.contains("aberto") && !alvo?.closest("#topo")) definirMenu(false);
        });
    }

    /* ---------------- CABEÇALHO AO ROLAR ---------------- */

    const topo = document.getElementById("topo");
    const atualizarTopo = () => topo?.classList.toggle("rolado", window.scrollY > 8);
    window.addEventListener("scroll", atualizarTopo, { passive: true });
    atualizarTopo();

    /* ---------------- REVELAÇÃO RESILIENTE ---------------- */

    const blocos = Array.from(document.querySelectorAll(SELETOR_REVEAL));
    if (blocos.length === 0) return;

    let observador = null;

    function ativarBloco(bloco) {
        if (!bloco || bloco.classList.contains("reveal-ativo")) return;
        bloco.classList.add("reveal-ativo");
        observador?.unobserve(bloco);
    }

    // Revela qualquer bloco que já esteja na janela (ou próximo dela)
    function revelarVisiveis() {
        const alturaJanela = window.innerHeight || document.documentElement.clientHeight || 800;
        const margem = Math.max(120, Math.round(alturaJanela * 0.15));

        for (const bloco of blocos) {
            if (bloco.classList.contains("reveal-ativo")) continue;
            const ret = bloco.getBoundingClientRect();
            if (ret.top <= alturaJanela + margem && ret.bottom >= -margem) {
                ativarBloco(bloco);
            }
        }
    }

    // Revela imediatamente todos os blocos da seção apontada por #hash
    function revelarPorHash(hash) {
        const id = String(hash || "").replace(/^#/, "");
        if (!id) return;
        const destino = document.getElementById(id);
        if (!destino) return;

        if (destino.matches(SELETOR_REVEAL)) ativarBloco(destino);
        destino.querySelectorAll(SELETOR_REVEAL).forEach(ativarBloco);
    }

    // Sem suporte a IntersectionObserver ou preferência por movimento reduzido: tudo visível de imediato
    if (!("IntersectionObserver" in window) || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        blocos.forEach(ativarBloco);
        return;
    }

    observador = new IntersectionObserver(entradas => {
        entradas.forEach(entrada => {
            if (entrada.isIntersecting || entrada.intersectionRatio > 0) {
                ativarBloco(entrada.target);
            }
        });
    }, { threshold: 0.01, rootMargin: "100px 0px 100px 0px" });

    // Só ativa o estado oculto inicial depois que os observadores e garantias estão prontos
    document.body.classList.add("lp-js");
    blocos.forEach(bloco => observador.observe(bloco));

    // 1. Revela o que já está visível no carregamento e qualquer #hash inicial (ex.: F5 em #como-funciona)
    revelarPorHash(window.location.hash);
    revelarVisiveis();

    // 2. Garantia contínua durante rolagem/redimensionamento/mudança de hash
    window.addEventListener("scroll", revelarVisiveis, { passive: true });
    window.addEventListener("resize", revelarVisiveis, { passive: true });
    window.addEventListener("hashchange", () => {
        revelarPorHash(window.location.hash);
        revelarVisiveis();
    });

    // 3. Ao clicar em qualquer âncora (#como-funciona, #para-quem, #recursos, #duvidas),
    // revela na hora o destino e revalida durante/após a rolagem suave.
    document.addEventListener("click", evento => {
        const alvo = evento.target instanceof Element ? evento.target : evento.target?.parentElement;
        const link = alvo?.closest('a[href^="#"]');
        if (!link) return;

        const href = link.getAttribute("href");
        revelarPorHash(href);
        requestAnimationFrame(revelarVisiveis);
        setTimeout(revelarVisiveis, 350);
    });
})();
