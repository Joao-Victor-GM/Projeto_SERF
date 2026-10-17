// View pedidos_painel (migration 014): RLS preservado e papéis corretos.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, criarEmpresa, criarProduto, criarPedido } from "./banco.mjs";

let db, comprador, fornecedor, ambos, intruso, pedidoCompra, pedidoVendaAmbos;

before(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
    ambos = await criarEmpresa(db, "Ambos", "Atacadão Ambos");
    intruso = await criarEmpresa(db, "Comprador", "Empresa Curiosa");

    const produtoFornecedor = await criarProduto(db, fornecedor, { nome: "Arroz" });
    const produtoAmbos = await criarProduto(db, ambos, { nome: "Feijão" });

    pedidoCompra = await criarPedido(db, ambos, produtoFornecedor, 5);       // Ambos compra
    pedidoVendaAmbos = await criarPedido(db, comprador, produtoAmbos, 5);    // Ambos vende
});

const painel = empresa => como(db, empresa,
    "SELECT id_pedido, sou_comprador, sou_fornecedor, nome_produto, comprador_nome, fornecedor_razao_social FROM pedidos_painel ORDER BY id_pedido");

test("a view respeita o RLS: terceiros não veem nada", async () => {
    assert.deepEqual(await painel(intruso), []);
});

test("empresa Ambos vê compras e vendas com os papéis certos", async () => {
    const linhas = await painel(ambos);
    const porId = Object.fromEntries(linhas.map(l => [l.id_pedido, l]));

    assert.equal(linhas.length, 2);
    assert.deepEqual([porId[pedidoCompra].sou_comprador, porId[pedidoCompra].sou_fornecedor], [true, false]);
    assert.deepEqual([porId[pedidoVendaAmbos].sou_comprador, porId[pedidoVendaAmbos].sou_fornecedor], [false, true]);
});

test("nomes vêm prontos: produto, comprador e fornecedor", async () => {
    const [venda] = await como(db, fornecedor,
        "SELECT nome_produto, comprador_nome, fornecedor_razao_social, sou_fornecedor FROM pedidos_painel");

    assert.equal(venda.nome_produto, "Arroz");
    assert.equal(venda.comprador_nome, "Atacadão Ambos");
    assert.equal(venda.fornecedor_razao_social, "Distribuidora Sul");
    assert.equal(venda.sou_fornecedor, true);
});

test("filtro por papel no servidor", async () => {
    const vendas = await como(db, ambos, "SELECT id_pedido FROM pedidos_painel WHERE sou_fornecedor");
    assert.deepEqual(vendas.map(l => l.id_pedido), [pedidoVendaAmbos]);
});

test("a view não expõe CNPJ nem e-mail do fornecedor", async () => {
    const colunas = await como(db, ambos,
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'pedidos_painel'");
    const nomes = colunas.map(c => c.column_name);

    assert.ok(!nomes.some(n => /cnpj|email|telefone/.test(n)), nomes.join(", "));
});
