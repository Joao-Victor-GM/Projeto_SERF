/* ==========================================================
   S.E.R.F. — DOMÍNIO / NOTIFICACOES.JS
   Como cada notificação (tabela notificacoes, migration 023) aparece no
   sino: ícone, título, texto e para onde leva. Funções puras (sem DOM,
   sem rede): testadas em tests/unit/notificacoes.test.mjs.

   Mesmos tipos dos e-mails (supabase/functions/enviar-emails/modelos.ts).
   ========================================================== */

"use strict";

(function () {

    const moeda = valor => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor) || 0);
    const plural = (n, singular, pluralTexto) => `${n} ${n === 1 ? singular : pluralTexto}`;

    const STATUS = {
        CONFIRMADO: "foi confirmado. O pagamento está liberado.",
        ENVIADO: "foi enviado.",
        ENTREGUE: "foi entregue.",
        CANCELADO: "foi cancelado pelo fornecedor."
    };

    const linkPedido = id => (id ? `home.html?pedido=${encodeURIComponent(id)}` : "home.html#pedidos");

    // tipo → (dados, quantidade) → { icone, titulo, texto, link }
    const TIPOS = {
        PEDIDO_RECEBIDO: d => {
            const itens = d.itens || [];
            return {
                icone: "☷",
                titulo: itens.length > 1 ? `${itens.length} pedidos de ${d.comprador}` : `Novo pedido de ${d.comprador}`,
                texto: itens.map(i => `${i.quantidade} un. de ${i.produto}`).join(", "),
                link: itens.length === 1 ? linkPedido(itens[0].id_pedido) : "alertas.html"
            };
        },
        STATUS_PEDIDO: d => ({
            icone: "✓",
            titulo: `Pedido #${d.id_pedido} atualizado`,
            texto: `${d.produto ?? "O pedido"} ${STATUS[d.status] ?? "mudou de status."}`,
            link: linkPedido(d.id_pedido)
        }),
        PEDIDO_CANCELADO: d => ({
            icone: "✕",
            titulo: `${d.comprador} cancelou o pedido #${d.id_pedido}`,
            texto: d.motivo ? `Motivo: “${d.motivo}”` : "",
            link: linkPedido(d.id_pedido)
        }),
        MENSAGEM_NOVA: (d, quantidade) => ({
            icone: "✉",
            titulo: quantidade > 1
                ? `${plural(quantidade, "mensagem", "mensagens")} de ${d.remetente}`
                : `Mensagem de ${d.remetente}`,
            texto: `Pedido #${d.id_pedido}: “${d.trecho}”`,
            link: linkPedido(d.id_pedido)
        }),
        PAGAMENTO_CONFIRMADO: d => ({
            icone: "$",
            titulo: `Pagamento recebido: pedido #${d.id_pedido}`,
            texto: `${d.comprador} pagou ${moeda(d.valor)}. Emita a NF-e e envie.`,
            link: linkPedido(d.id_pedido)
        }),
        PRAZO_SOLICITADO: d => ({
            icone: "◷",
            titulo: `${d.comprador} pediu pagamento a prazo`,
            texto: `${moeda(d.valor)} em ${d.prazo_dias} dias (pedido #${d.id_pedido}).`,
            link: linkPedido(d.id_pedido)
        }),
        NOVO_PRODUTO_SEGMENTO: d => {
            const itens = d.itens || [];
            return {
                icone: "✦",
                titulo: itens.length > 1
                    ? `${itens.length} produtos novos em ${d.categoria}`
                    : `Novo em ${d.categoria}: ${itens[0]?.produto ?? ""}`,
                texto: itens.map(i => `${i.produto} (${i.fornecedor ?? "fornecedor"}, ${moeda(i.preco)}/un.)`).join(", "),
                link: "catalogo.html"
            };
        },
        COTACAO_NOVA: d => {
            const itens = d.itens || [];
            return {
                icone: "⚡",
                titulo: itens.length > 1
                    ? `${itens.length} cotações novas em ${d.categoria}`
                    : `Cotação nova em ${d.categoria}`,
                texto: itens.map(i => `${i.comprador} quer ${i.quantidade} ${i.unidade || "un."} de ${i.titulo}`).join("; "),
                link: itens.length === 1 ? `cotacoes.html?cotacao=${encodeURIComponent(itens[0].id_cotacao)}` : "cotacoes.html"
            };
        },
        PROPOSTA_RECEBIDA: (d, quantidade) => ({
            icone: "✉",
            titulo: quantidade > 1
                ? `${plural(quantidade, "proposta", "propostas")} para “${d.titulo}”`
                : `Proposta de ${d.fornecedor} para “${d.titulo}”`,
            texto: `${moeda(d.preco_unitario)}/un. · entrega em ${plural(d.prazo_entrega_dias, "dia", "dias")}`,
            link: `cotacoes.html?cotacao=${encodeURIComponent(d.id_cotacao)}`
        }),
        PROPOSTA_ACEITA: d => ({
            icone: "★",
            titulo: `${d.comprador} aceitou sua proposta`,
            texto: `“${d.titulo}” virou o pedido #${d.id_pedido}.`,
            link: linkPedido(d.id_pedido)
        })
    };

    function descrever(notificacao) {
        const montar = TIPOS[notificacao?.tipo];
        if (!montar) return { icone: "•", titulo: "Atualização no S.E.R.F.", texto: "", link: "home.html" };
        return montar(notificacao.dados || {}, notificacao.quantidade || 1);
    }

    window.SERFNotificacoesRegras = Object.freeze({ descrever, tipos: Object.keys(TIPOS) });
})();
