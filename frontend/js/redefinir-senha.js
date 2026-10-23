// Redefinição de senha (link do e-mail "Esqueceu a senha?").
// O Supabase Auth lê o token do link na URL e autoriza só esta troca.

"use strict";

(function () {
    const form = document.getElementById("formRedefinir");
    const erro = document.getElementById("erroRedefinir");
    if (!form) return;

    function mostrarErro(texto, campo) {
        erro.textContent = texto;
        erro.hidden = false;
        document.getElementById(campo)?.focus();
    }

    form.addEventListener("submit", async evento => {
        evento.preventDefault();
        erro.hidden = true;

        const novaSenha = document.getElementById("novaSenha").value;
        const confirmacao = document.getElementById("confirmaNovaSenha").value;

        if (novaSenha.length < 8) return mostrarErro("Use uma senha com 8 ou mais caracteres.", "novaSenha");
        if (novaSenha !== confirmacao) return mostrarErro("As senhas digitadas não coincidem.", "confirmaNovaSenha");

        const botao = form.querySelector("button");
        botao.textContent = "Salvando...";
        botao.disabled = true;

        try {
            const { error } = await window.supabaseClient.auth.updateUser({ password: novaSenha });
            if (error) throw error;

            // Encerra a sessão aberta pelo link: o acesso volta pelo login normal
            await window.supabaseClient.auth.signOut().catch(() => {});
            form.innerHTML = "";
            const ok = document.createElement("p");
            ok.setAttribute("role", "status");
            ok.textContent = "Senha alterada! Você será levado ao login.";
            form.appendChild(ok);
            setTimeout(() => window.location.replace("login-cadastro.html"), 1800);
        } catch (falha) {
            console.error("[SERF] Redefinição de senha:", falha);
            const texto = /session|token|expired|missing/i.test(falha?.message || "")
                ? "O link expirou ou já foi usado. Peça um novo em \"Esqueceu a senha?\"."
                : window.SERFUtils?.mensagemDeErro(falha) || "Não foi possível alterar a senha. Tente novamente.";
            mostrarErro(texto, "novaSenha");
            botao.textContent = "Atualizar Senha";
            botao.disabled = false;
        }
    });
})();
