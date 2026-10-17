// Radar de Oportunidades (migration 016): só oportunidades reais, visíveis
// para quem pode agir, nunca da própria empresa.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

let db, comprador, fornecedor, outroFornecedor, ambos;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
    outroFornecedor = await criarEmpresa(db, "Fornecedor", "Atacado Norte");
    ambos = await criarEmpresa(db, "Ambos", "Atacadão Ambos");
});

const oportunidades = empresa => como(db, empresa, "SELECT * FROM oportunidades ORDER BY relevancia DESC, tipo");
const tipos = async (empresa, filtro = () => true) => (await oportunidades(empresa)).filter(filtro).map(o => o.tipo);

async function semTriggers(sql, parametros) {
    await lerComoAdmin(db, "SET session_replication_role = replica");
    try { return await lerComoAdmin(db, sql, parametros); }
    finally { await lerComoAdmin(db, "SET session_replication_role = origin"); }
}

test("produto novo aparece para compradores; nunca para o próprio fornecedor", async () => {
    const idProduto = await criarProduto(db, fornecedor, { nome: "Arroz" });

    const novos = (await oportunidades(comprador)).filter(o => o.id_produto === idProduto);
    assert.deepEqual(novos.map(o => o.tipo), ["NOVO_PRODUTO"]);
    assert.equal(novos[0].fornecedor_nome, "Distribuidora Sul");
    assert.equal(Number(novos[0].preco), 10);

    assert.deepEqual(await tipos(fornecedor), [], "fornecedor puro não recebe oportunidades de compra");
});

test("produto novo do mesmo nicho tem relevância maior", async () => {
    await lerComoAdmin(db, "UPDATE fornecedores SET nicho = 'Bebidas' WHERE auth_user_id = $1", [outroFornecedor.uid]);
    const doNicho = await criarProduto(db, fornecedor, { nome: "Arroz" });          // nicho Alimentos
    const outroNicho = await criarProduto(db, outroFornecedor, { nome: "Suco" });   // nicho Bebidas

    const lista = await oportunidades(comprador);
    const relevancia = id => lista.find(o => o.id_produto === id && o.tipo === "NOVO_PRODUTO").relevancia;

    assert.equal(relevancia(doNicho), 3);
    assert.equal(relevancia(outroNicho), 2);
});

test("sem estoque para o pedido mínimo ou inativo: fora do radar", async () => {
    const semEstoque = await criarProduto(db, fornecedor, { minimo: 50, estoque: 10 });
    const inativo = await criarProduto(db, fornecedor);
    await como(db, fornecedor, "UPDATE produtos SET ativo = false WHERE id_produto = $1", [inativo]);

    const ids = (await oportunidades(comprador)).map(o => o.id_produto);
    assert.ok(!ids.includes(semEstoque));
    assert.ok(!ids.includes(inativo));
});

test("menor preço só quando há concorrência na categoria", async () => {
    const caro = await criarProduto(db, fornecedor, { nome: "Arroz A", preco: 30 });
    assert.ok(!(await tipos(comprador)).includes("MENOR_PRECO"), "uma oferta só: não é 'menor preço'");

    const barato = await criarProduto(db, outroFornecedor, { nome: "Arroz B", preco: 20 });
    const menor = (await oportunidades(comprador)).filter(o => o.tipo === "MENOR_PRECO");

    assert.equal(menor.length, 1);
    assert.equal(menor[0].id_produto, barato);
    assert.equal(menor[0].detalhe, "2", "detalhe = ofertas comparadas");
    assert.notEqual(menor[0].id_produto, caro);
});

test("recompra: produto recebido há mais de 15 dias", async () => {
    const idProduto = await criarProduto(db, fornecedor, { estoque: 100 });
    const idPedido = await criarPedido(db, comprador, idProduto, 5);
    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");
    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PIX')", [idPedido]);
    await como(db, comprador, "SELECT public.confirmar_pagamento_simulado($1, NULL, NULL)", [idPedido]);
    await como(db, fornecedor, "SELECT public.emitir_nota_fiscal($1)", [idPedido]);
    await mudarStatus(db, fornecedor, idPedido, "ENVIADO");
    await mudarStatus(db, fornecedor, idPedido, "ENTREGUE");

    assert.ok(!(await tipos(comprador)).includes("RECOMPRA"), "compra recente: ainda não");

    await semTriggers("UPDATE pedidos SET data_pedido = NOW() - INTERVAL '20 days' WHERE id_pedido = $1", [idPedido]);
    const recompra = (await oportunidades(comprador)).find(o => o.tipo === "RECOMPRA");

    assert.equal(recompra.id_produto, idProduto);
    assert.equal(recompra.relevancia, 3);
    assert.equal(recompra.detalhe, "1");
});

test("nova demanda: pedido pendente para o fornecedor, não para terceiros", async () => {
    const idProduto = await criarProduto(db, fornecedor);
    const idPedido = await criarPedido(db, comprador, idProduto, 7);

    const [demanda] = (await oportunidades(fornecedor)).filter(o => o.tipo === "NOVA_DEMANDA");
    assert.equal(demanda.id_pedido, idPedido);
    assert.equal(demanda.parceiro_nome, "Mercado Bom Preço");
    assert.equal(demanda.quantidade, 7);
    assert.equal(demanda.relevancia, 4);

    assert.deepEqual(await tipos(outroFornecedor, o => o.tipo === "NOVA_DEMANDA"), []);

    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");
    assert.deepEqual(await tipos(fornecedor, o => o.tipo === "NOVA_DEMANDA"), [], "respondido: sai do radar");
});

test("fornecedor do nicho: some depois da primeira compra", async () => {
    const idProduto = await criarProduto(db, fornecedor);

    // Atacado Norte e Atacadão Ambos são do mesmo nicho, mas não têm catálogo ativo
    const antes = (await oportunidades(comprador)).filter(o => o.tipo === "FORNECEDOR_NICHO");
    assert.deepEqual(antes.map(o => o.fornecedor_nome), ["Distribuidora Sul"]);

    await criarPedido(db, comprador, idProduto, 5);
    assert.deepEqual(await tipos(comprador, o => o.tipo === "FORNECEDOR_NICHO"), []);
});

test("empresa Ambos não vê o próprio produto nem a si mesma como fornecedora", async () => {
    const proprio = await criarProduto(db, ambos, { nome: "Meu produto" });
    await criarProduto(db, fornecedor, { nome: "Produto de terceiro" });

    const lista = await oportunidades(ambos);
    assert.ok(!lista.some(o => o.id_produto === proprio));
    assert.ok(!lista.some(o => o.tipo === "FORNECEDOR_NICHO" && o.fornecedor_nome === "Atacadão Ambos"));
    assert.ok(lista.some(o => o.produto_nome === "Produto de terceiro"));
});
