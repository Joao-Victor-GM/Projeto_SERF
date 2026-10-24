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

    // aoMudar() a cada notificação nova ou agrupada (o RLS filtra o usuário)
    function assinarMudancas(aoMudar) {
        return assinar({ canal: "serf-notificacoes", tabela: "notificacoes", aoReceber: aoMudar });
    }

    window.SERFDados.notificacoes = Object.freeze({ listar, marcarLida, marcarTodasLidas, assinarMudancas, cancelarAssinatura });
})();
