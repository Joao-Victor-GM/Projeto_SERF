// Regras de apresentação do sino (frontend/js/dominio/notificacoes.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarScripts, simples } from "./carregar-script.mjs";

const { SERFNotificacoesRegras: regras } = carregarScripts(["dominio/notificacoes.js"]);
const descrever = n => simples(regras.descrever(n));

test("pedido recebido: um item leva ao pedido; vários, aos alertas", () => {
    const um = descrever({ tipo: "PEDIDO_RECEBIDO", dados: { comprador: "Mercado", itens: [{ id_pedido: 7, produto: "Arroz", quantidade: 5 }] } });
    assert.equal(um.titulo, "Novo pedido de Mercado");
    assert.equal(um.texto, "5 un. de Arroz");
    assert.equal(um.link, "home.html?pedido=7");

    const varios = descrever({ tipo: "PEDIDO_RECEBIDO", dados: { comprador: "Mercado", itens: [
        { id_pedido: 7, produto: "Arroz", quantidade: 5 }, { id_pedido: 8, produto: "Feijão", quantidade: 2 }] } });
    assert.equal(varios.titulo, "2 pedidos de Mercado");
    assert.equal(varios.link, "alertas.html");
});

test("mensagens agrupadas mostram a quantidade", () => {
    const n = descrever({ tipo: "MENSAGEM_NOVA", quantidade: 3, dados: { id_pedido: 4, remetente: "Distribuidora Sul", trecho: "Oi" } });
    assert.equal(n.titulo, "3 mensagens de Distribuidora Sul");
    assert.equal(n.link, "home.html?pedido=4");
});

test("segmento, cotação e propostas", () => {
    assert.equal(descrever({ tipo: "NOVO_PRODUTO_SEGMENTO", dados: { categoria: "Alimentos & Bebidas",
        itens: [{ produto: "Arroz", fornecedor: "Sul", preco: 10 }] } }).titulo, "Novo em Alimentos & Bebidas: Arroz");

    const cotacao = descrever({ tipo: "COTACAO_NOVA", dados: { categoria: "Metalurgia & Usinagem",
        itens: [{ id_cotacao: 3, comprador: "Oficina X", quantidade: 200, unidade: "kg", titulo: "Chapa de aço" }] } });
    assert.equal(cotacao.texto, "Oficina X quer 200 kg de Chapa de aço");
    assert.equal(cotacao.link, "cotacoes.html?cotacao=3");

    assert.equal(descrever({ tipo: "PROPOSTA_RECEBIDA", quantidade: 2, dados: { id_cotacao: 3, titulo: "Chapa" } }).titulo,
        "2 propostas para “Chapa”");
    assert.equal(descrever({ tipo: "PROPOSTA_ACEITA", dados: { id_pedido: 9, comprador: "Oficina X", titulo: "Chapa" } }).link,
        "home.html?pedido=9");
});

test("tipo desconhecido não quebra o sino", () => {
    assert.equal(descrever({ tipo: "NOVO_TIPO_FUTURO", dados: {} }).titulo, "Atualização no S.E.R.F.");
    assert.equal(descrever(null).link, "home.html");
});
