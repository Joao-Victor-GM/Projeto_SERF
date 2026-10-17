/* ==========================================================
   S.E.R.F. — DADOS / MENSAGENS.REPOSITORIO.JS
   Chat dos pedidos (mensagens_pedidos) e tempo real dos
   pagamentos e notas fiscais exibidos no modal do pedido.
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro, assinar } = window.SERFDados.base;
    const COLUNAS = "id, id_pedido, texto, id_remetente, lida, data_envio";

    // Mais recentes de todos os pedidos da empresa (o RLS filtra no servidor)
    async function listarRecentes(limite) {
        return dadosOuErro(await cliente()
            .from("mensagens_pedidos")
            .select(COLUNAS)
            .order("data_envio", { ascending: false })
            .limit(limite)) || [];
    }

    // Histórico de um pedido; "desde" busca só a partir dessa data (inclusive)
    async function listarDoPedido(idPedido, desde = null) {
        let consulta = cliente()
            .from("mensagens_pedidos")
            .select(COLUNAS)
            .eq("id_pedido", idPedido);

        if (desde) consulta = consulta.gte("data_envio", desde);

        return dadosOuErro(await consulta.order("data_envio", { ascending: true })) || [];
    }

    async function enviar(idPedido, idRemetente, texto) {
        return dadosOuErro(await cliente()
            .from("mensagens_pedidos")
            .insert({ id_pedido: idPedido, texto, id_remetente: idRemetente })
            .select(COLUNAS)
            .single());
    }

    // Leitura confirmada só das mensagens RECEBIDAS (UPDATE só em "lida")
    async function marcarComoLidas(idPedido, idLeitor) {
        dadosOuErro(await cliente()
            .from("mensagens_pedidos")
            .update({ lida: true })
            .eq("id_pedido", idPedido)
            .eq("lida", false)
            .neq("id_remetente", idLeitor));
    }

    function assinarNovas(aoReceber) {
        return assinar({ canal: "mensagens-painel", tabela: "mensagens_pedidos", evento: "INSERT", aoReceber });
    }

    function assinarDoPedido(idPedido, aoReceber, aoMudarStatus) {
        return assinar({
            canal: `chat-pedido-${idPedido}`,
            tabela: "mensagens_pedidos",
            evento: "INSERT",
            filtro: `id_pedido=eq.${idPedido}`,
            aoReceber,
            aoMudarStatus
        });
    }

    function assinarPagamentos(aoReceber) {
        return assinar({ canal: "pagamentos-painel", tabela: "pagamentos", aoReceber });
    }

    function assinarNotas(aoReceber) {
        return assinar({ canal: "notas-painel", tabela: "notas_fiscais", aoReceber });
    }

    window.SERFDados.mensagens = Object.freeze({
        listarRecentes,
        listarDoPedido,
        enviar,
        marcarComoLidas,
        assinarNovas,
        assinarDoPedido
    });

    // Pagamento e NF-e: só o tempo real é usado pela Home
    // (leitura e comandos ficam em pagamentos.js / notas.js).
    window.SERFDados.financeiro = Object.freeze({ assinarPagamentos, assinarNotas });
})();
