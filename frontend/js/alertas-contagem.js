/* ==========================================================
   S.E.R.F. — ALERTAS-CONTAGEM.JS
   Contador de alertas no item "Alertas" do menu lateral, em todas
   as páginas internas. Conta só o que exige ação (urgente + atenção);
   os informativos ficam na página de alertas.

   Carregar depois do auth-check.js:
     <script src="../../js/alertas-contagem.js" defer></script>

   No menu: <span class="nav-count" data-alertas-contagem hidden></span>
   Outros scripts podem pedir atualização: SERFAlertas.atualizarContagem()
   ========================================================== */

"use strict";

(function () {

    const SEVERIDADES_DE_ACAO = ["urgente", "atencao"];

    async function atualizarContagem() {
        const contadores = document.querySelectorAll("[data-alertas-contagem]");

        if (contadores.length === 0 || !window.SERFDados?.pendencias) return;

        // Sessão validada pelo auth-check.js (o RLS filtra pela empresa).
        if (!(await window.serfSessao)) return;

        let data;
        try {
            data = await window.SERFDados.pendencias.severidadesDosAlertas(SEVERIDADES_DE_ACAO);
        } catch (erro) {
            // Sem a migration 015 o menu continua funcionando, só sem número.
            console.warn("[SERF:Alertas] Contagem indisponível:", erro.message);
            return;
        }

        const total = data.length;
        const urgente = data.some(alerta => alerta.severidade === "urgente");

        contadores.forEach(contador => {
            contador.textContent = total > 99 ? "99+" : String(total);
            contador.hidden = total === 0;
            contador.classList.toggle("urgente", urgente);
            contador.setAttribute("aria-label", `${total} alerta${total === 1 ? "" : "s"} pendente${total === 1 ? "" : "s"}`);
        });
    }

    window.SERFAlertas = Object.freeze({ atualizarContagem });

    atualizarContagem();

    // Ao voltar para a aba, a situação pode ter mudado (pagamento, resposta...).
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) atualizarContagem();
    });
})();
