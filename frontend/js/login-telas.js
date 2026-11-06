/* ==========================================================
   S.E.R.F. — LOGIN-TELAS.JS
   Troca entre "Entrar" e "Criar conta" (painel deslizante no
   desktop, abas no celular), mostrar/ocultar senha com ícone
   vetorial e o diálogo de recuperação de senha.
   Sem acesso a dados: isso é o app-v2.js.
   ========================================================== */

"use strict";

(function () {
    const container = document.getElementById("container");
    if (!container) return;

    const abas = {
        entrar: document.getElementById("abaEntrar"),
        cadastrar: document.getElementById("abaCadastrar")
    };

    const ICONE_VER = '<svg class="auth-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
    const ICONE_OCULTAR = '<svg class="auth-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

    // cadastro = true → tela de cadastro
    function mostrar(cadastro, { focar = false } = {}) {
        container.classList.toggle("right-panel-active", cadastro);

        abas.entrar?.classList.toggle("ativa", !cadastro);
        abas.cadastrar?.classList.toggle("ativa", cadastro);
        abas.entrar?.setAttribute("aria-selected", String(!cadastro));
        abas.cadastrar?.setAttribute("aria-selected", String(cadastro));
        if (abas.entrar) abas.entrar.tabIndex = cadastro ? -1 : 0;
        if (abas.cadastrar) abas.cadastrar.tabIndex = cadastro ? 0 : -1;

        // O formulário escondido sai da ordem de tabulação e dos leitores de tela
        document.getElementById("painelEntrar")?.toggleAttribute("inert", cadastro);
        document.getElementById("painelCadastrar")?.toggleAttribute("inert", !cadastro);

        // #cadastro na URL: o link "Criar conta" da página inicial e o voltar funcionam
        const hash = cadastro ? "#cadastro" : "";
        if (location.hash !== hash) {
            try {
                history.replaceState(null, "", hash || location.pathname + location.search);
            } catch { /* file:// restrito em alguns navegadores */ }
        }

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
        botao.innerHTML = ICONE_VER;

        botao.addEventListener("click", () => {
            const campo = document.getElementById(botao.getAttribute("aria-controls") || "");
            if (!campo) return;

            const visivel = campo.type === "password";
            campo.type = visivel ? "text" : "password";
            botao.innerHTML = visivel ? ICONE_OCULTAR : ICONE_VER;
            botao.setAttribute("aria-pressed", String(visivel));
            const rotulo = visivel ? "Ocultar senha" : "Mostrar senha";
            botao.setAttribute("aria-label", rotulo);
            botao.setAttribute("title", rotulo);
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
