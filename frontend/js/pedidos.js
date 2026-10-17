/* ==========================================================
   S.E.R.F. — PEDIDOS.JS
   Leitura e normalização de pedidos, compartilhada por Home,
   Relatórios e Perfil. Fonte: view pedidos_painel (migration 014),
   uma linha por pedido com nomes prontos e os papéis da empresa
   logada (sou_comprador / sou_fornecedor). O RLS continua valendo.

   Carregar depois de utils.js:
     <script src="../../js/pedidos.js"></script>

   Uso:
     const { data } = await SERFPedidos.consultar(client).eq("sou_fornecedor", true);
     const pedidos = data.map(SERFPedidos.normalizar);
   ========================================================== */

"use strict";

(function () {

    const { statusDoPedido, dataLocalISO } = window.SERFUtils;

    const COLUNAS = [
        "id_pedido", "id_usuario", "id_produto", "id_fornecedor",
        "quantidade", "valor_unitario", "valor_total",
        "status_pedido", "observacao", "motivo_cancelamento",
        "data_pedido", "data_atualizacao", "data_resposta",
        "data_envio", "data_entrega", "data_cancelamento",
        "nome_produto", "categoria",
        "fornecedor_razao_social", "fornecedor_nome_fantasia",
        "fornecedor_cidade", "fornecedor_estado",
        "comprador_nome", "sou_comprador", "sou_fornecedor"
    ].join(", ");

    // Status em que o pedido ainda está em andamento (não finalizado).
    const STATUS_EM_ABERTO = Object.freeze(["PENDENTE", "CONFIRMADO", "EM_SEPARACAO", "ENVIADO"]);

    function consultar(client) {
        return client.from("pedidos_painel").select(COLUNAS);
    }

    const comoData = valor => (valor ? new Date(valor) : null);

    // Linha de pedidos_painel → pedido da interface (formato canônico).
    function normalizar(linha) {
        const status = statusDoPedido(linha.status_pedido);
        const concluido = status.categoria === "concluido";

        return {
            id: linha.id_pedido,
            idUsuario: linha.id_usuario,
            idProduto: linha.id_produto,
            idFornecedor: linha.id_fornecedor ?? null,

            souComprador: Boolean(linha.sou_comprador),
            souFornecedor: Boolean(linha.sou_fornecedor),

            produto: linha.nome_produto || `Produto #${linha.id_produto}`,
            categoria: linha.categoria || "",
            quantidade: Number(linha.quantidade) || 0,
            valorUnitario: Number(linha.valor_unitario) || 0,
            valorTotal: Number(linha.valor_total) || 0,
            observacao: linha.observacao || null,
            motivoCancelamento: linha.motivo_cancelamento || null,

            statusBanco: linha.status_pedido,
            status: status.categoria,
            statusRotulo: status.rotulo,
            aguardandoResposta: linha.status_pedido === "PENDENTE",

            fornecedorNome: linha.fornecedor_nome_fantasia || linha.fornecedor_razao_social || "Fornecedor",
            fornecedorCidade: linha.fornecedor_cidade || null,
            fornecedorEstado: linha.fornecedor_estado || null,
            compradorNome: linha.comprador_nome || "Comprador",

            // Datas como Date (cálculos) ...
            dataPedido: comoData(linha.data_pedido),
            dataAtualizacao: comoData(linha.data_atualizacao),
            dataResposta: comoData(linha.data_resposta),
            dataEnvio: comoData(linha.data_envio),
            dataEntrega: comoData(linha.data_entrega),
            dataCancelamento: comoData(linha.data_cancelamento),

            // ... e como "AAAA-MM-DD" no fuso local (filtros e exibição)
            criadoEm: dataLocalISO(linha.data_pedido),
            atualizadoEm: dataLocalISO(linha.data_atualizacao || linha.data_pedido),
            concluidoEm: concluido
                ? dataLocalISO(linha.data_entrega || linha.data_atualizacao || linha.data_pedido)
                : null
        };
    }

    window.SERFPedidos = Object.freeze({
        COLUNAS,
        STATUS_EM_ABERTO,
        consultar,
        normalizar
    });
})();
