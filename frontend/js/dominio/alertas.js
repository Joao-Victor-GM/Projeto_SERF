// @ts-check
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

    const svg = caminhos =>
        `<svg class="serf-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminhos}</svg>`;

    const ICONES = {
        pedido: svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
        calendario: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
        nota: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
        pacote: svg('<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>'),
        caminhao: svg('<rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
        bloqueio: svg('<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'),
        queda: svg('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'),
        cancelado: svg('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
        cartao: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'),
        relogio: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
        mensagem: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
        ponto: svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>')
    };

    // codigo → { titulo, descricao, acao, link }
    const TIPOS = {
        RESPONDER_PEDIDO: {
            icone: ICONES.pedido,
            titulo: a => `Responda o ${pedidoN(a)}`,
            descricao: a => `${a.parceiro_nome} pediu ${unidades(a.quantidade)} de ${a.produto_nome} (${valor(a)}) ${tempoRelativo(a.referencia)}. Confirme ou recuse.`,
            acao: "Responder pedido",
            link: linkPedido
        },
        APROVAR_PRAZO: {
            icone: ICONES.calendario,
            titulo: a => `Analise o pagamento a prazo do ${pedidoN(a)}`,
            descricao: a => `${a.parceiro_nome} pediu faturamento a prazo de ${valor(a)}. Aprove ou recuse a análise de crédito.`,
            acao: "Analisar prazo",
            link: linkPedido
        },
        EMITIR_NFE: {
            icone: ICONES.nota,
            titulo: a => `Emita a NF-e do ${pedidoN(a)}`,
            descricao: a => `Pagamento de ${a.parceiro_nome} liberado. A nota fiscal é obrigatória para enviar a mercadoria.`,
            acao: "Emitir NF-e",
            link: linkPedido
        },
        PRONTO_PARA_ENVIO: {
            icone: ICONES.pacote,
            titulo: a => `${pedidoN(a).replace(/^p/, "P")} pronto para envio`,
            descricao: a => `NF-e autorizada. Marque como enviado quando ${unidades(a.quantidade)} de ${a.produto_nome} saírem para ${a.parceiro_nome}.`,
            acao: "Atualizar status",
            link: linkPedido
        },
        CONFIRMAR_ENTREGA: {
            icone: ICONES.caminhao,
            titulo: a => `Confirme a entrega do ${pedidoN(a)}`,
            descricao: a => `Enviado ${tempoRelativo(a.referencia)}. Marque como entregue quando ${a.parceiro_nome} receber.`,
            acao: "Atualizar status",
            link: linkPedido
        },
        SEM_ESTOQUE: {
            icone: ICONES.bloqueio,
            titulo: a => `Sem estoque: ${a.produto_nome}`,
            descricao: a => `Restam ${unidades(a.quantidade)}, abaixo do pedido mínimo (${unidades(a.detalhe)}): ninguém consegue comprar este produto.`,
            acao: "Ver meus produtos",
            link: () => "catalogo.html?modo=vender"
        },
        ESTOQUE_BAIXO: {
            icone: ICONES.queda,
            titulo: a => `Estoque baixo: ${a.produto_nome}`,
            descricao: a => `Restam ${unidades(a.quantidade)} (pedido mínimo: ${unidades(a.detalhe)}). Reponha antes de travar as vendas.`,
            acao: "Ver meus produtos",
            link: () => "catalogo.html?modo=vender"
        },
        CANCELADO_COMPRADOR: {
            icone: ICONES.cancelado,
            titulo: a => `${pedidoN(a).replace(/^p/, "P")} cancelado pelo comprador`,
            descricao: a => `${a.parceiro_nome} cancelou ${tempoRelativo(a.referencia)}. Motivo: “${a.detalhe}”.`,
            acao: "Ver pedido",
            link: linkPedido
        },
        PAGAR_PEDIDO: {
            icone: ICONES.cartao,
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
            icone: ICONES.relogio,
            titulo: a => `Cobrança vencida no ${pedidoN(a)}`,
            descricao: a => `O ${METODOS[a.detalhe] || "pagamento"} de ${valor(a)} venceu em ${quando(a.vencimento)}. Gere uma nova cobrança para não perder o pedido.`,
            acao: "Gerar nova cobrança",
            link: linkPedido
        },
        FATURA_A_PRAZO: {
            icone: ICONES.calendario,
            titulo: a => `Fatura a prazo do ${pedidoN(a)}`,
            descricao: a => `${valor(a)} para ${a.parceiro_nome}, vencimento em ${quando(a.vencimento)}.`,
            acao: "Ver fatura",
            link: linkPedido
        },
        MENSAGENS: {
            icone: ICONES.mensagem,
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
        icone: ICONES.ponto,
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
