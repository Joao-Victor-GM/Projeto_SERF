/* ==========================================================
   S.E.R.F. — LOGIN-TELAS.JS
   Troca entre "Entrar" e "Criar conta" (painel deslizante no
   desktop, abas no celular), mostrar/ocultar senha e o diálogo de
   recuperação de senha. Sem acesso a dados: isso é o app-v2.js.
   ========================================================== */

"use strict";

(function () {
    const container = document.getElementById("container");
    if (!container) return;

    const abas = {
        entrar: document.getElementById("abaEntrar"),
        cadastrar: document.getElementById("abaCadastrar")
    };

    // cadastro = true → tela de cadastro
    function mostrar(cadastro, { focar = false } = {}) {
        container.classList.toggle("right-panel-active", cadastro);

        abas.entrar?.setAttribute("aria-selected", String(!cadastro));
        abas.cadastrar?.setAttribute("aria-selected", String(cadastro));
        if (abas.entrar) abas.entrar.tabIndex = cadastro ? -1 : 0;
        if (abas.cadastrar) abas.cadastrar.tabIndex = cadastro ? 0 : -1;

        // O formulário escondido sai da ordem de tabulação e dos leitores de tela
        document.getElementById("painelEntrar")?.toggleAttribute("inert", cadastro);
        document.getElementById("painelCadastrar")?.toggleAttribute("inert", !cadastro);

        // #cadastro na URL: o link "Criar conta" da página inicial e o voltar funcionam
        const hash = cadastro ? "#cadastro" : "";
        if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname + location.search);

        if (focar) document.querySelector(cadastro ? "#cnpjCadastro" : "#emailLogin")?.focus();
    }

    mostrar(location.hash === "#cadastro");

    document.getElementById("signUp")?.addEventListener("click", () => mostrar(true, { focar: true }));
    document.getElementById("signIn")?.addEventListener("click", () => mostrar(false, { focar: true }));
    abas.entrar?.addEventListener("click", () => mostrar(false));
    abas.cadastrar?.addEventListener("click", () => mostrar(true));

    // Setas entre as abas (padrão ARIA)
    document.querySelector(".auth-abas")?.addEventListener("keydown", evento => {
        if (!["ArrowLeft", "ArrowRight"].includes(evento.key)) return;
        const cadastro = !container.classList.contains("right-panel-active");
        mostrar(cadastro);
        (cadastro ? abas.cadastrar : abas.entrar)?.focus();
    });

    window.addEventListener("hashchange", () => mostrar(location.hash === "#cadastro"));

    /* ---------------- MOSTRAR / OCULTAR SENHA ---------------- */

    document.querySelectorAll(".mostrar-senha").forEach(botao => {
        botao.addEventListener("click", () => {
            const campo = document.getElementById(botao.getAttribute("aria-controls") || "");
            if (!campo) return;

            const visivel = campo.type === "password";
            campo.type = visivel ? "text" : "password";
            botao.textContent = visivel ? "Ocultar" : "Ver";
            botao.setAttribute("aria-pressed", String(visivel));
            botao.setAttribute("aria-label", visivel ? "Ocultar senha" : "Mostrar senha");
            campo.focus();
        });
    });

    /* ---------------- DIÁLOGO "ESQUECEU A SENHA?" ---------------- */

    const modal = document.getElementById("modalRecuperar");
    let quemAbriu = null;

    function abrirRecuperacao(aberto) {
        if (!modal) return;
        modal.hidden = !aberto;
        if (aberto) {
            quemAbriu = document.activeElement;
            const email = document.getElementById("emailRecuperar");
            const login = document.getElementById("emailLogin");
            if (email && login && !email.value) email.value = login.value;
            email?.focus();
        } else {
            quemAbriu?.focus?.();
        }
    }

    document.getElementById("linkEsqueceuSenha")?.addEventListener("click", evento => {
        evento.preventDefault();
        abrirRecuperacao(true);
    });
    modal?.querySelector(".close-modal")?.addEventListener("click", () => abrirRecuperacao(false));
    modal?.addEventListener("click", evento => { if (evento.target === modal) abrirRecuperacao(false); });
    document.addEventListener("keydown", evento => {
        if (evento.key === "Escape" && modal && !modal.hidden) abrirRecuperacao(false);
    });

    window.SERFLogin = Object.freeze({ mostrar, fecharRecuperacao: () => abrirRecuperacao(false) });
})();
