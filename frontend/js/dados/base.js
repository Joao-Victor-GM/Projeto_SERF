/* ==========================================================
   S.E.R.F. — DADOS / BASE.JS
   Camada de dados: a ÚNICA parte do front-end da Home, Alertas e
   Radar que conversa com o Supabase. As telas chamam os
   repositórios (window.SERFDados.*) e recebem dados ou um erro;
   não sabem se a fonte é PostgREST, Realtime ou um mock de teste.

   Ordem: supabase-client.js → utils.js → dados/base.js → dados/*.js
   ========================================================== */

"use strict";

(function () {

    // Cliente do Supabase ou erro claro (antes cada tela repetia esse teste)
    function cliente() {
        const client = window.obterSupabase ? window.obterSupabase() : null;
        if (!client) throw new Error("Conexão com o banco de dados não estabelecida.");
        return client;
    }

    // Resultado do PostgREST → dados, ou lança o erro do Supabase
    function dadosOuErro({ data, error }) {
        if (error) throw error;
        return data;
    }

    // Assinatura Realtime de uma tabela. Devolve o canal (para cancelar).
    // aoMudarStatus recebe "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED".
    function assinar({ canal, tabela, evento = "*", filtro, aoReceber, aoMudarStatus }) {
        const client = window.obterSupabase ? window.obterSupabase() : null;
        if (!client) return null;

        const config = { event: evento, schema: "public", table: tabela };
        if (filtro) config.filter = filtro;

        return client
            .channel(canal)
            .on("postgres_changes", config, payload => aoReceber(payload))
            .subscribe(status => aoMudarStatus?.(status));
    }

    function cancelarAssinatura(canal) {
        if (canal) window.obterSupabase?.()?.removeChannel(canal);
    }

    window.SERFDados = window.SERFDados || {};
    window.SERFDados.base = Object.freeze({ cliente, dadosOuErro, assinar, cancelarAssinatura });
})();
