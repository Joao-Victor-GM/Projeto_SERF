/* ==========================================================
   S.E.R.F. — HOME / TEMPO-REAL.JS
   Assinaturas Realtime do painel: pedidos, pagamentos e NF-e.

   A Home é um conjunto de MÓDULOS ES (sem build): cada arquivo importa
   o que usa dos outros e exporta o que oferece. A entrada é
   inicializacao.js (<script type="module"> na home.html), a única que
   executa algo ao carregar (iniciarHome()). O que outros scripts da
   página usam fica em window.SERFHome.
   ========================================================== */

import { aplicarStatusPedido, obterPedido } from "./estado.js";
import { atualizarDashboard } from "./dashboard.js";
import { chat } from "./chat.js";
import { renderizarGestaoStatus, renderizarNota, renderizarPagamento, renderizarResumoPedido } from "./pedido-modal.js";


// Pedidos em tempo real (tabela pedidos na publicação supabase_realtime).
// O RLS garante que cada empresa só recebe os próprios pedidos.
let canalPedidos = null;
let recargaPedidosAgendada = null;

// Pagamentos em tempo real: o fornecedor vê o "Pago" sem recarregar
// (e o comprador vê a aprovação do prazo). RLS: só os pedidos da empresa.
let canalPagamentos = null;

export function assinarPagamentosTempoReal() {

    if (canalPagamentos || !window.SERFPagamentos) return;

    canalPagamentos = SERFDados.financeiro.assinarPagamentos(
            payload => {
                window.dispatchEvent(new CustomEvent("serf:dados-alterados"));
                const registro = payload.new;
                if (!registro?.id_pedido) return;

                const pedido = obterPedido(registro.id_pedido);
                if (!pedido) return;

                pedido.pagamento = registro;

                if (chat.pedido?.id === pedido.id) {
                    renderizarPagamento(pedido);
                    renderizarGestaoStatus(pedido);
                    renderizarNota(pedido);
                }
            }
    );
}

// NF-e em tempo real: o comprador vê a nota assim que é emitida.
let canalNotas = null;

export function assinarNotasTempoReal() {

    if (canalNotas || !window.SERFNotas) return;

    canalNotas = SERFDados.financeiro.assinarNotas(
            payload => {
                window.dispatchEvent(new CustomEvent("serf:dados-alterados"));
                const registro = payload.new;
                if (!registro?.id_pedido) return;

                const pedido = obterPedido(registro.id_pedido);
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
    );
}

export function assinarPedidosTempoReal(aoRecarregar) {

    if (canalPedidos) return;

    canalPedidos = SERFDados.pedidos.assinarMudancas(
            payload => {
                window.dispatchEvent(new CustomEvent("serf:dados-alterados"));
                const pedido = obterPedido(payload.new?.id_pedido);

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
                if (typeof aoRecarregar === "function") {
                    clearTimeout(recargaPedidosAgendada);
                    recargaPedidosAgendada = setTimeout(aoRecarregar, 400);
                }
            }
    );
}
