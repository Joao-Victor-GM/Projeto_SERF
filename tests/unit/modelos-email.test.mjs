// Textos dos e-mails (supabase/functions/enviar-emails/modelos.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { montarEmail, escapar } from "../../supabase/functions/enviar-emails/modelos.ts";

const APP = "https://serf.exemplo.com/";

test("pedido recebido (carrinho): lista os itens, soma e leva aos alertas", () => {
    const email = montarEmail("PEDIDO_RECEBIDO", {
        comprador: "Mercado Bom Preço",
        observacao: "Entregar pela manhã",
        itens: [
            { id_pedido: 10, produto: "Arroz", quantidade: 5, valor_total: 50 },
            { id_pedido: 11, produto: "Feijão", quantidade: 2, valor_total: 30.5 }
        ]
    }, APP);

    assert.equal(email.assunto, "2 novos pedidos de Mercado Bom Preço");
    assert.match(email.texto, /5 un\. de Arroz \(pedido #10\)/);
    assert.match(email.texto, /Total: R\$\s80,50/);
    assert.match(email.texto, /Entregar pela manhã/);
    assert.match(email.texto, /https:\/\/serf\.exemplo\.com\/frontend\/pages\/app\/alertas\.html/);
});

test("pedido único leva direto ao pedido", () => {
    const email = montarEmail("PEDIDO_RECEBIDO",
        { comprador: "X", itens: [{ id_pedido: 7, produto: "Café", quantidade: 1, valor_total: 25 }] }, APP);
    assert.equal(email.assunto, "Novo pedido de X: Café");
    assert.match(email.html, /home\.html\?pedido=7/);
});

test("status, cancelamento, mensagem, pagamento e prazo", () => {
    assert.match(montarEmail("STATUS_PEDIDO", { id_pedido: 3, status: "CONFIRMADO", produto: "Arroz", quantidade: 5 }, APP).texto,
        /confirmado pelo fornecedor/);
    assert.equal(montarEmail("STATUS_PEDIDO", { id_pedido: 3, status: "CANCELADO" }, APP).assunto, "Seu pedido #3 foi cancelado");
    assert.match(montarEmail("PEDIDO_CANCELADO", { id_pedido: 3, comprador: "M", motivo: "Mudamos de plano" }, APP).texto,
        /Motivo: "Mudamos de plano"/);
    assert.equal(montarEmail("MENSAGEM_NOVA", { id_pedido: 3, remetente: "Distribuidora Sul", trecho: "Oi" }, APP).assunto,
        "Nova mensagem de Distribuidora Sul no pedido #3");
    assert.match(montarEmail("PAGAMENTO_CONFIRMADO", { id_pedido: 3, comprador: "M", valor: 100, metodo: "PIX" }, APP).texto,
        /pagou R\$\s100,00 por Pix/);
    assert.match(montarEmail("PRAZO_SOLICITADO", { id_pedido: 3, comprador: "M", valor: 100, prazo_dias: 30 }, APP).texto,
        /em 30 dias/);
});

test("dados do banco são escapados no HTML (sem injeção)", () => {
    const email = montarEmail("MENSAGEM_NOVA",
        { id_pedido: 1, remetente: "<script>alert(1)</script>", trecho: '"><img src=x onerror=alert(1)>' }, APP);

    assert.doesNotMatch(email.html, /<script>|<img/);
    assert.match(email.html, /&lt;script&gt;/);
    assert.equal(escapar(`a&b"'`), "a&amp;b&quot;&#39;");
});

test("todo e-mail explica como parar de receber", () => {
    for (const tipo of ["PEDIDO_RECEBIDO", "STATUS_PEDIDO", "MENSAGEM_NOVA", "DESCONHECIDO"]) {
        const email = montarEmail(tipo, { itens: [], id_pedido: 1 }, APP);
        assert.match(email.texto, /desative os e-mails no seu Perfil/, tipo);
    }
});

test("produto novo no segmento: um ou vários produtos, leva ao catálogo", () => {
    const item = (produto, preco) => ({ id_produto: 1, produto, fornecedor: "Distribuidora Sul", preco, quantidade_minima: 10 });

    const um = montarEmail("NOVO_PRODUTO_SEGMENTO", { categoria: "Alimentos & Bebidas", itens: [item("Arroz", 25.5)] }, APP);
    assert.equal(um.assunto, "Novo em Alimentos & Bebidas: Arroz");
    assert.match(um.texto, /Arroz — Distribuidora Sul · R\$\s25,50\/un\. · mín\. 10 un\./);
    assert.match(um.texto, /catalogo\.html/);
    assert.match(um.html, /Alimentos &amp; Bebidas/);

    const varios = montarEmail("NOVO_PRODUTO_SEGMENTO",
        { categoria: "Metalurgia & Usinagem", itens: [item("Chapa", 90), item("Barra", 40)] }, APP);
    assert.equal(varios.assunto, "2 produtos novos em Metalurgia & Usinagem");
    assert.match(varios.texto, /botão Segmentos/);
});

test("com link de descadastro, o rodapé oferece parar em um clique", () => {
    const link = "https://serf.exemplo.com/frontend/pages/public/descadastro.html?t=u.x&y";
    const email = montarEmail("MENSAGEM_NOVA", { id_pedido: 1, remetente: "A", trecho: "Oi" }, APP, link);

    assert.match(email.texto, /Parar de receber: https:\/\/serf\.exemplo\.com\/frontend\/pages\/public\/descadastro\.html\?t=u\.x&y/);
    assert.match(email.html, /href="https:\/\/serf\.exemplo\.com\/frontend\/pages\/public\/descadastro\.html\?t=u\.x&amp;y"/);
    assert.doesNotMatch(email.texto, /desative os e-mails no seu Perfil/);
});

test("cotação nova (fornecedor) e proposta recebida (comprador)", () => {
    const item = { id_cotacao: 3, comprador: "Oficina X", titulo: "Chapa de aço", quantidade: 200, unidade: "kg", preco_alvo: 40 };
    const uma = montarEmail("COTACAO_NOVA", { categoria: "Metalurgia & Usinagem", itens: [item] }, APP);
    assert.equal(uma.assunto, "Cotação nova em Metalurgia & Usinagem: Chapa de aço");
    assert.match(uma.texto, /Oficina X quer 200 kg de Chapa de aço \(preço-alvo R\$\s40,00\)/);
    assert.match(uma.texto, /cotacoes\.html\?cotacao=3/);

    const duas = montarEmail("COTACAO_NOVA", { categoria: "Metalurgia & Usinagem", itens: [item, { ...item, id_cotacao: 4 }] }, APP);
    assert.equal(duas.assunto, "2 cotações novas em Metalurgia & Usinagem");

    const proposta = montarEmail("PROPOSTA_RECEBIDA", { id_cotacao: 3, titulo: "Chapa de aço", fornecedor: "Aços Sul",
        produto: "Chapa 2mm", preco_unitario: 38.5, prazo_entrega_dias: 3 }, APP);
    assert.match(proposta.texto, /Aços Sul ofereceu Chapa 2mm por R\$\s38,50\/un\., entrega em 3 dia\(s\)/);
});
