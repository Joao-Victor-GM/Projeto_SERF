/* ==========================================================
   S.E.R.F. — DOMÍNIO / ALERTAS.JS
   Como cada alerta (view "alertas", migration 015) é apresentado:
   título, descrição, ação e destino, e a ordem de prioridade.
   Usado pela central (alertas.js) e pelo bloco "Precisa da sua
   ação" da Home. As REGRAS de quando um alerta existe ficam no banco.
   ========================================================== */

"use strict";

(function () {

    const { formatarMoeda, formatarData, dataLocalISO, tempoRelativo } = window.SERFUtils;

    const METODOS = { PIX: "Pix", BOLETO: "boleto", CARTAO: "pagamento no cartão" };

    const linkPedido = a => `home.html?pedido=${encodeURIComponent(a.id_pedido)}`;
    const pedidoN = a => `pedido #${a.id_pedido}`;
    const valor = a => formatarMoeda(a.valor);
    const quando = data => (data ? formatarData(dataLocalISO(data)) : "—");
    const unidades = n => `${n} un.`;

    // codigo → { titulo, descricao, acao, link }
    const TIPOS = {
        RESPONDER_PEDIDO: {
            icone: "✉",
            titulo: a => `Responda o ${pedidoN(a)}`,
            descricao: a => `${a.parceiro_nome} pediu ${unidades(a.quantidade)} de ${a.produto_nome} (${valor(a)}) ${tempoRelativo(a.referencia)}. Confirme ou recuse.`,
            acao: "Responder pedido",
            link: linkPedido
        },
        APROVAR_PRAZO: {
            icone: "📅",
            titulo: a => `Analise o pagamento a prazo do ${pedidoN(a)}`,
            descricao: a => `${a.parceiro_nome} pediu faturamento a prazo de ${valor(a)}. Aprove ou recuse a análise de crédito.`,
            acao: "Analisar prazo",
            link: linkPedido
        },
        EMITIR_NFE: {
            icone: "🧾",
            titulo: a => `Emita a NF-e do ${pedidoN(a)}`,
            descricao: a => `Pagamento de ${a.parceiro_nome} liberado. A nota fiscal é obrigatória para enviar a mercadoria.`,
            acao: "Emitir NF-e",
            link: linkPedido
        },
        PRONTO_PARA_ENVIO: {
            icone: "📦",
            titulo: a => `${pedidoN(a).replace(/^p/, "P")} pronto para envio`,
            descricao: a => `NF-e autorizada. Marque como enviado quando ${unidades(a.quantidade)} de ${a.produto_nome} saírem para ${a.parceiro_nome}.`,
            acao: "Atualizar status",
            link: linkPedido
        },
        CONFIRMAR_ENTREGA: {
            icone: "🚚",
            titulo: a => `Confirme a entrega do ${pedidoN(a)}`,
            descricao: a => `Enviado ${tempoRelativo(a.referencia)}. Marque como entregue quando ${a.parceiro_nome} receber.`,
            acao: "Atualizar status",
            link: linkPedido
        },
        SEM_ESTOQUE: {
            icone: "⛔",
            titulo: a => `Sem estoque: ${a.produto_nome}`,
            descricao: a => `Restam ${unidades(a.quantidade)}, abaixo do pedido mínimo (${unidades(a.detalhe)}): ninguém consegue comprar este produto.`,
            acao: "Ver meus produtos",
            link: () => "catalogo.html?modo=vender"
        },
        ESTOQUE_BAIXO: {
            icone: "📉",
            titulo: a => `Estoque baixo: ${a.produto_nome}`,
            descricao: a => `Restam ${unidades(a.quantidade)} (pedido mínimo: ${unidades(a.detalhe)}). Reponha antes de travar as vendas.`,
            acao: "Ver meus produtos",
            link: () => "catalogo.html?modo=vender"
        },
        CANCELADO_COMPRADOR: {
            icone: "✕",
            titulo: a => `${pedidoN(a).replace(/^p/, "P")} cancelado pelo comprador`,
            descricao: a => `${a.parceiro_nome} cancelou ${tempoRelativo(a.referencia)}. Motivo: “${a.detalhe}”.`,
            acao: "Ver pedido",
            link: linkPedido
        },
        PAGAR_PEDIDO: {
            icone: "💳",
            titulo: a => `Pague o ${pedidoN(a)}`,
            descricao: a => {
                if (a.detalhe === "prazo recusado") {
                    return `${a.parceiro_nome} recusou o pagamento a prazo. Escolha outra forma para pagar ${valor(a)}.`;
                }
                if (a.vencimento) {
                    return `Cobrança de ${valor(a)} gerada. Vence em ${quando(a.vencimento)}.`;
                }
                return `${a.parceiro_nome} confirmou o pedido. Escolha a forma de pagamento (${valor(a)}) para liberar o envio.`;
            },
            acao: "Pagar",
            link: linkPedido
        },
        COBRANCA_VENCIDA: {
            icone: "⏰",
            titulo: a => `Cobrança vencida no ${pedidoN(a)}`,
            descricao: a => `O ${METODOS[a.detalhe] || "pagamento"} de ${valor(a)} venceu em ${quando(a.vencimento)}. Gere uma nova cobrança para não perder o pedido.`,
            acao: "Gerar nova cobrança",
            link: linkPedido
        },
        FATURA_A_PRAZO: {
            icone: "📅",
            titulo: a => `Fatura a prazo do ${pedidoN(a)}`,
            descricao: a => `${valor(a)} para ${a.parceiro_nome}, vencimento em ${quando(a.vencimento)}.`,
            acao: "Ver fatura",
            link: linkPedido
        },
        MENSAGENS: {
            icone: "💬",
            titulo: a => {
                const n = Number(a.detalhe) || 1;
                return `${n} mensage${n === 1 ? "m não lida" : "ns não lidas"} no ${pedidoN(a)}`;
            },
            descricao: a => `${a.parceiro_nome} escreveu ${tempoRelativo(a.referencia)} sobre ${a.produto_nome}.`,
            acao: "Abrir conversa",
            link: linkPedido
        }
    };

    // Tipo novo no banco e ainda não descrito aqui: aparece de forma genérica.
    const TIPO_GENERICO = {
        icone: "•",
        titulo: a => a.id_pedido ? `Pendência no ${pedidoN(a)}` : "Pendência",
        descricao: a => a.produto_nome || "",
        acao: "Ver",
        link: a => (a.id_pedido ? linkPedido(a) : "home.html")
    };

    const descrever = alerta => TIPOS[alerta.codigo] || TIPO_GENERICO;

    const ORDEM_SEVERIDADE = { urgente: 0, atencao: 1, info: 2 };

    function ordenar(a, b) {
        const severidade = ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade];
        if (severidade !== 0) return severidade;

        // Pendências: a mais antiga primeiro. Informativos: o mais recente primeiro.
        const ta = new Date(a.referencia || 0).getTime();
        const tb = new Date(b.referencia || 0).getTime();
        return a.severidade === "info" ? tb - ta : ta - tb;
    }

    window.SERFAlertasRegras = Object.freeze({ descrever, ordenar, ORDEM_SEVERIDADE, quando });
})();
