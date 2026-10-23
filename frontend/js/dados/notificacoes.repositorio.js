// @ts-check
/* ==========================================================
   S.E.R.F. — DADOS / NOTIFICACOES.REPOSITORIO.JS
   Central de notificações do app (migration 023). O RLS devolve só as
   do usuário logado.
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro, assinar, cancelarAssinatura } = window.SERFDados.base;

    const COLUNAS = "id, tipo, dados, quantidade, criada_em, atualizada_em, lida_em";

    async function listar(limite = 20) {
        return dadosOuErro(await cliente()
            .from("notificacoes")
            .select(COLUNAS)
            .order("atualizada_em", { ascending: false })
            .limit(limite)) || [];
    }

    async function marcarLida(id) {
        dadosOuErro(await cliente()
            .from("notificacoes")
            .update({ lida_em: new Date().toISOString() })
            .eq("id", id));
    }

    async function marcarTodasLidas() {
        return dadosOuErro(await cliente().rpc("marcar_notificacoes_lidas")) || 0;
    }

    // aoMudar() a cada notificação nova ou agrupada. O filtro por usuário
    // faz o servidor do Realtime descartar as dos outros antes de checar o
    // RLS de cada uma (sem ele, cada INSERT era avaliado para todo conectado).
    async function assinarMudancas(aoMudar) {
        const { data } = await cliente().auth.getSession();
        const uid = data?.session?.user?.id;
        return assinar({
            canal: "serf-notificacoes",
            tabela: "notificacoes",
            filtro: uid ? `auth_user_id=eq.${uid}` : undefined,
            aoReceber: aoMudar
        });
    }

    window.SERFDados.notificacoes = Object.freeze({ listar, marcarLida, marcarTodasLidas, assinarMudancas, cancelarAssinatura });
})();
