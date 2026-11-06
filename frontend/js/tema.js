/* ==========================================================
   S.E.R.F. — TEMA.JS
   Modo claro / escuro.

   Carregar no <head>, SEM defer, antes dos estilos aparecerem:
     <script src="../../js/tema.js"></script>

   - Aplica o tema antes da pintura (sem "piscar" branco).
   - Preferência salva por navegador (localStorage); sem escolha
     salva, segue o tema do sistema operacional.
   - Botões com data-alternar-tema (ou #btnTema / .btn-tema)
     alternam o tema em qualquer página pública ou interna.
   ========================================================== */

"use strict";

(function () {
    const CHAVE = "serf-tema";
    const SELETOR_BOTAO = "[data-alternar-tema], #btnTema, .lp-btn-tema, .auth-btn-tema, .btn-tema";
    const raiz = document.documentElement;
    const midiaEscura = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

    function lerPreferencia() {
        try {
            const salvo = localStorage.getItem(CHAVE);
            return salvo === "dark" || salvo === "light" ? salvo : null;
        } catch (e) {
            return null; // navegação privada / armazenamento bloqueado
        }
    }

    function salvarPreferencia(tema) {
        try {
            localStorage.setItem(CHAVE, tema);
        } catch (e) { /* sem armazenamento: vale só nesta página */ }
    }

    function temaDoSistema() {
        return midiaEscura && midiaEscura.matches ? "dark" : "light";
    }

    function atualizarBotoes(tema) {
        const escuro = tema === "dark";

        document.querySelectorAll(SELETOR_BOTAO).forEach(botao => {
            botao.setAttribute("aria-pressed", String(escuro));
            botao.setAttribute("aria-label", escuro ? "Ativar modo claro" : "Ativar modo escuro");
            botao.title = escuro ? "Modo claro" : "Modo escuro";
        });
    }

    function aplicar(tema) {
        const normalizado = tema === "dark" ? "dark" : "light";
        raiz.setAttribute("data-theme", normalizado);
        raiz.style.colorScheme = normalizado;
        atualizarBotoes(normalizado);
        try {
            window.dispatchEvent(new CustomEvent("serf:tema", { detail: { tema: normalizado } }));
        } catch (e) { /* ambientes sem CustomEvent */ }
    }

    function alternar() {
        const novo = raiz.getAttribute("data-theme") === "dark" ? "light" : "dark";

        // Transição suave só na troca manual (a carga inicial não anima)
        raiz.classList.add("tema-transicao");
        aplicar(novo);
        salvarPreferencia(novo);
        setTimeout(() => raiz.classList.remove("tema-transicao"), 300);
        return novo;
    }

    // 1. Antes da pintura
    aplicar(lerPreferencia() || temaDoSistema());

    // 2. Sem escolha salva, acompanha mudanças do sistema
    midiaEscura?.addEventListener?.("change", () => {
        if (!lerPreferencia()) aplicar(temaDoSistema());
    });

    // 3. Botões (delegação segura mesmo quando o clique atinge SVG ou nó de texto interno)
    document.addEventListener("click", evento => {
        const alvo = evento.target instanceof Element ? evento.target : evento.target?.parentElement;
        if (alvo?.closest(SELETOR_BOTAO)) {
            alternar();
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        atualizarBotoes(raiz.getAttribute("data-theme"));
    });

    // Outra aba mudou o tema → acompanha
    window.addEventListener("storage", evento => {
        if (evento.key === CHAVE && (evento.newValue === "dark" || evento.newValue === "light")) {
            aplicar(evento.newValue);
        }
    });

    window.serfTema = { alternar, aplicar };
})();
