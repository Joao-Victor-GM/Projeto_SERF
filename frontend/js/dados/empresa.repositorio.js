// @ts-check
/* ==========================================================
   S.E.R.F. — DADOS / EMPRESA.REPOSITORIO.JS
   Verificação do CNPJ na Receita (Edge Function), preferências
   de notificação e LGPD (exportar dados / excluir conta, 025).
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro } = window.SERFDados.base;

    // Edge Functions devolvem o motivo no corpo; o supabase-js só diz "non-2xx"
    async function chamarFuncao(nome, corpo) {
        const { data, error } = await cliente().functions.invoke(nome, { method: "POST", ...(corpo && { body: corpo }) });
        if (!error) return data;

        let resposta = null;
        try { resposta = await error.context?.json?.(); } catch { /* corpo não é JSON */ }
        throw new Error(resposta?.erro || "Este serviço não está disponível agora. Tente novamente em alguns minutos.");
    }

    // → { status: "APROVADO" | "PENDENTE" | "REPROVADO", motivo }
    const verificarCnpj = () => chamarFuncao("homologar-fornecedor");

    // Preferências de e-mail (migration 020). Sem linha = padrão (recebe).
    async function preferencias(authUserId) {
        const linha = dadosOuErro(await cliente()
            .from("preferencias_notificacao")
            .select("receber_email")
            .eq("auth_user_id", authUserId)
            .maybeSingle());
        return { receberEmail: linha ? linha.receber_email : true };
    }

    async function salvarPreferencias(authUserId, { receberEmail }) {
        dadosOuErro(await cliente()
            .from("preferencias_notificacao")
            .upsert({ auth_user_id: authUserId, receber_email: receberEmail }, { onConflict: "auth_user_id" }));
    }

    // LGPD: tudo da conta em JSON (RPC exportar_meus_dados)
    async function exportarDados() {
        return dadosOuErro(await cliente().rpc("exportar_meus_dados"));
    }

    // Pedidos que impedem excluir a conta (não entregues nem cancelados)
    async function pedidosEmAndamento() {
        return dadosOuErro(await cliente().rpc("meus_pedidos_em_andamento")) || [];
    }

    const excluirConta = confirmacao => chamarFuncao("excluir-conta", { confirmacao });

    window.SERFDados.empresa = Object.freeze({
        verificarCnpj, preferencias, salvarPreferencias, exportarDados, pedidosEmAndamento, excluirConta
    });
})();
