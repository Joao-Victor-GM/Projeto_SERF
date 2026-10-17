/* ==========================================================
   S.E.R.F. — HOME / TEMPO-REAL.JS
   Assinaturas Realtime do painel: pedidos, pagamentos e NF-e.

   A Home é dividida em scripts clássicos que compartilham o escopo
   global, carregados nesta ordem (todos com defer):
     estado.js → dashboard.js → eventos.js → chat.js →
     pedido-modal.js → tempo-real.js → inicializacao.js
   Só inicializacao.js executa algo ao carregar (iniciarHome()).
   ========================================================== */

"use strict";


// Pedidos em tempo real (tabela pedidos na publicação supabase_realtime).
// O RLS garante que cada empresa só recebe os próprios pedidos.
let canalPedidos = null;
let recargaPedidosAgendada = null;

// Pagamentos em tempo real: o fornecedor vê o "Pago" sem recarregar
// (e o comprador vê a aprovação do prazo). RLS: só os pedidos da empresa.
let canalPagamentos = null;

function assinarPagamentosTempoReal() {

    const client = obterSupabase();

    if (!client || canalPagamentos || !window.SERFPagamentos) return;

    canalPagamentos = client
        .channel("pagamentos-painel")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "pagamentos" },
            payload => {
                const registro = payload.new;
                if (!registro?.id_pedido) return;

                const pedido = pedidosCache.find(item => item.id === registro.id_pedido);
                if (!pedido) return;

                pedido.pagamento = registro;

                if (chat.pedido?.id === pedido.id) {
                    renderizarPagamento(pedido);
                    renderizarGestaoStatus(pedido);
                    renderizarNota(pedido);
                }
            }
        )
        .subscribe();
}

// NF-e em tempo real: o comprador vê a nota assim que é emitida.
let canalNotas = null;

function assinarNotasTempoReal() {

    const client = obterSupabase();

    if (!client || canalNotas || !window.SERFNotas) return;

    canalNotas = client
        .channel("notas-painel")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "notas_fiscais" },
            payload => {
                const registro = payload.new;
                if (!registro?.id_pedido) return;

                const pedido = pedidosCache.find(item => item.id === registro.id_pedido);
                if (!pedido) return;

                // Mantém a nota mais recente do pedido
                if (!pedido.nota || new Date(registro.data_emissao) >= new Date(pedido.nota.data_emissao)) {
                    pedido.nota = registro;
                }

                if (chat.pedido?.id === pedido.id) {
                    renderizarNota(pedido);
                    renderizarGestaoStatus(pedido);
                }
            }
        )
        .subscribe();
}

function assinarPedidosTempoReal() {

    const client = obterSupabase();

    if (!client || canalPedidos) return;

    canalPedidos = client
        .channel("pedidos-painel")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "pedidos" },
            payload => {
                const pedido = pedidosCache.find(
                    item => item.id === payload.new?.id_pedido
                );

                // Mudança de status de um pedido já carregado: atualiza no lugar.
                if (payload.eventType === "UPDATE" && pedido) {
                    aplicarStatusPedido(pedido, payload.new);
                    atualizarDashboard();

                    if (chat.pedido?.id === pedido.id) {
                        renderizarResumoPedido(pedido);
                        renderizarGestaoStatus(pedido);
                        renderizarPagamento(pedido);
                        renderizarNota(pedido);
                    }
                    return;
                }

                // Pedido novo (ou desconhecido): recarrega com os JOINs.
                // Agrupa eventos em sequência numa única consulta.
                clearTimeout(recargaPedidosAgendada);
                recargaPedidosAgendada = setTimeout(recarregarPedidos, 400);
            }
        )
        .subscribe();
}
