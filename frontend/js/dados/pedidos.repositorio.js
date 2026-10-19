/* ==========================================================
   S.E.R.F. — DADOS / PEDIDOS.REPOSITORIO.JS
   Pedidos: leitura pela view pedidos_painel (via SERFPedidos),
   mudança de status, cancelamento pelo comprador e Realtime.
   Devolve linhas do banco; normalizar é papel de quem consome.
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro, assinar } = window.SERFDados.base;

    // Painel: movimentados desde "desde" + todos ainda em andamento.
    async function consultarPainel({ desde, limite }) {
        const emAberto = window.SERFPedidos.STATUS_EM_ABERTO.join(",");

        return dadosOuErro(await window.SERFPedidos.consultar(cliente())
            .or(`data_atualizacao.gte."${desde}",status_pedido.in.(${emAberto})`)
            .order("data_atualizacao", { ascending: false })
            .limit(limite)) || [];
    }

    async function buscarPorId(idPedido) {
        return dadosOuErro(await window.SERFPedidos.consultar(cliente())
            .eq("id_pedido", idPedido)
            .maybeSingle());
    }

    // UPDATE do status (o RLS só permite ao fornecedor do produto).
    async function atualizarStatus(idPedido, novoStatus) {
        const data = dadosOuErro(await cliente()
            .from("pedidos")
            .update({ status_pedido: novoStatus })
            .eq("id_pedido", idPedido)
            .select("id_pedido, status_pedido, data_atualizacao, data_entrega")
            .maybeSingle());

        // Com RLS, um UPDATE sem permissão não gera erro: apenas não altera linhas.
        if (!data) throw new Error("Você não tem permissão para alterar este pedido.");
        return data;
    }

    // RPC da migration 013 (o comprador não tem UPDATE direto)
    async function cancelarComoComprador(idPedido, motivo) {
        const data = dadosOuErro(await cliente().rpc("cancelar_pedido_comprador", {
            p_id_pedido: idPedido,
            p_motivo: motivo || null
        }));
        return Array.isArray(data) ? data[0] : data;
    }

    // Carrinho (migration 018): um pedido por item, tudo numa transação.
    // itens: [{ id_produto, quantidade }]
    async function criarCompra(itens, observacao) {
        return dadosOuErro(await cliente().rpc("criar_compra", {
            p_itens: itens,
            p_observacao: observacao || null
        })) || [];
    }

    // Qualquer mudança nos pedidos da empresa (o RLS filtra no servidor)
    function assinarMudancas(aoReceber) {
        return assinar({ canal: "pedidos-painel", tabela: "pedidos", aoReceber });
    }

    window.SERFDados.pedidos = Object.freeze({
        consultarPainel,
        buscarPorId,
        atualizarStatus,
        cancelarComoComprador,
        criarCompra,
        assinarMudancas
    });
})();
