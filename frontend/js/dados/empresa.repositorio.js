/* ==========================================================
   S.E.R.F. — DADOS / EMPRESA.REPOSITORIO.JS
   Verificação do CNPJ na Receita (Edge Function) e preferências
   de notificação da empresa logada.
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro } = window.SERFDados.base;

    // Edge Functions devolvem o motivo no corpo; o supabase-js só diz "non-2xx"
    async function chamarFuncao(nome) {
        const { data, error } = await cliente().functions.invoke(nome, { method: "POST" });
        if (!error) return data;

        let corpo = null;
        try { corpo = await error.context?.json?.(); } catch { /* corpo não é JSON */ }
        throw new Error(corpo?.erro || "Este serviço não está disponível agora. Tente novamente em alguns minutos.");
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

    window.SERFDados.empresa = Object.freeze({ verificarCnpj, preferencias, salvarPreferencias });
})();
