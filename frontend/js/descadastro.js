// Página pública de descadastro de e-mails (link "Parar de receber").

"use strict";

(function () {
    const token = new URLSearchParams(location.search).get("t");
    const confirmar = document.getElementById("confirmar");
    const feito = document.getElementById("feito");
    const erro = document.getElementById("erro");
    const botao = document.getElementById("botaoConfirmar");

    function mostrarErro(texto) {
        erro.textContent = texto;
        erro.hidden = false;
    }

    if (!token) {
        confirmar.hidden = true;
        mostrarErro("Link incompleto. Use o link “Parar de receber” do próprio e-mail, ou desative em Perfil → Avisos por e-mail.");
        return;
    }

    // Só descadastra com o clique: pré-visualizações de link não fazem isso
    botao.addEventListener("click", async () => {
        const cliente = window.obterSupabase?.();
        if (!cliente) return mostrarErro("Não foi possível conectar. Tente novamente em instantes.");

        botao.disabled = true;
        erro.hidden = true;

        const { error } = await cliente.functions.invoke("descadastrar", { body: { t: token } });

        if (error) {
            botao.disabled = false;
            const status = error.context?.status;
            mostrarErro(status === 400
                ? "Este link de descadastro é inválido. Desative em Perfil → Avisos por e-mail."
                : "Não foi possível concluir agora. Tente novamente em instantes.");
            return;
        }

        confirmar.hidden = true;
        feito.hidden = false;
        feito.querySelector("h1").focus?.();
    });
})();
