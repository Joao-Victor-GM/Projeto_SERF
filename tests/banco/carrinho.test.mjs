// Carrinho (migration 018): vários produtos numa transação só.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, lerComoAdmin } from "./banco.mjs";

let db, comprador, fornecedorA, fornecedorB, soFornecedor;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedorA = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
    fornecedorB = await criarEmpresa(db, "Fornecedor", "Atacado Norte");
    soFornecedor = fornecedorA;
});

const comprar = (empresa, itens, observacao = null) =>
    como(db, empresa, "SELECT * FROM public.criar_compra($1::jsonb, $2)", [JSON.stringify(itens), observacao]);

const totalPedidos = async () => Number((await lerComoAdmin(db, "SELECT COUNT(*) AS n FROM pedidos"))[0].n);

test("cria um pedido por produto, de fornecedores diferentes, com o mesmo id_compra", async () => {
    const arroz = await criarProduto(db, fornecedorA, { nome: "Arroz", preco: 10 });
    const cafe = await criarProduto(db, fornecedorB, { nome: "Café", preco: 25 });

    const linhas = await comprar(comprador, [{ id_produto: arroz, quantidade: 5 }, { id_produto: cafe, quantidade: 2 }], "Entregar pela manhã");

    assert.equal(linhas.length, 2);
    assert.equal(new Set(linhas.map(l => l.id_compra)).size, 1, "mesma compra");
    assert.deepEqual(linhas.map(l => Number(l.valor_total)), [50, 50]);

    const pedidos = await lerComoAdmin(db, "SELECT status_pedido, observacao, valor_unitario FROM pedidos ORDER BY id_pedido");
    assert.ok(pedidos.every(p => p.status_pedido === "PENDENTE" && p.observacao === "Entregar pela manhã"));
    assert.deepEqual(pedidos.map(p => Number(p.valor_unitario)), [10, 25], "preço do cadastro, não do navegador");

    // Cada fornecedor vê só o seu pedido; o comprador vê os dois, com o id_compra
    assert.equal((await como(db, fornecedorA, "SELECT id_pedido FROM pedidos_painel")).length, 1);
    const painel = await como(db, comprador, "SELECT id_compra FROM pedidos_painel");
    assert.equal(painel.length, 2);
    assert.equal(painel[0].id_compra, linhas[0].id_compra);
});

test("tudo ou nada: um item inválido desfaz a compra e diz qual produto falhou", async () => {
    const arroz = await criarProduto(db, fornecedorA, { nome: "Arroz", estoque: 100 });
    const cafe = await criarProduto(db, fornecedorB, { nome: "Café 500g", estoque: 3 });

    const erro = await erroDe(db, comprador, "SELECT * FROM public.criar_compra($1::jsonb)",
        [JSON.stringify([{ id_produto: arroz, quantidade: 5 }, { id_produto: cafe, quantidade: 10 }])]);

    assert.match(erro, /^Café 500g: Estoque insuficiente/);
    assert.equal(await totalPedidos(), 0, "o arroz também não foi pedido");
});

test("regras de sempre valem para cada item (mínimo, autocompra)", async () => {
    const arroz = await criarProduto(db, fornecedorA, { nome: "Arroz", minimo: 10 });
    assert.match(await erroDe(db, comprador, "SELECT * FROM public.criar_compra($1::jsonb)",
        [JSON.stringify([{ id_produto: arroz, quantidade: 2 }])]), /Arroz: A quantidade mínima/);

    const ambos = await criarEmpresa(db, "Ambos", "Atacadão Ambos");
    const proprio = await criarProduto(db, ambos, { nome: "Meu feijão" });
    assert.match(await erroDe(db, ambos, "SELECT * FROM public.criar_compra($1::jsonb)",
        [JSON.stringify([{ id_produto: proprio, quantidade: 1 }])]), /Meu feijão: .*próprio catálogo/);
});

test("validações do carrinho", async () => {
    const arroz = await criarProduto(db, fornecedorA, { nome: "Arroz" });
    const erro = itens => erroDe(db, comprador, "SELECT * FROM public.criar_compra($1::jsonb)", [JSON.stringify(itens)]);

    assert.match(await erro([]), /vazio/);
    assert.match(await erro([{ id_produto: arroz, quantidade: 1 }, { id_produto: arroz, quantidade: 2 }]), /duas vezes/);
    assert.match(await erro(Array.from({ length: 51 }, (_, i) => ({ id_produto: i + 1, quantidade: 1 }))), /no máximo 50/);
    assert.match(await erroDe(db, soFornecedor, "SELECT * FROM public.criar_compra($1::jsonb)",
        [JSON.stringify([{ id_produto: arroz, quantidade: 1 }])]), /Só empresas compradoras/);
});

test("a função não dá poder extra: id_usuario é sempre o de quem chama", async () => {
    const outro = await criarEmpresa(db, "Comprador", "Outro Mercado");
    const arroz = await criarProduto(db, fornecedorA);

    await comprar(outro, [{ id_produto: arroz, quantidade: 1 }]);
    const [pedido] = await lerComoAdmin(db, "SELECT id_usuario FROM pedidos");
    assert.equal(pedido.id_usuario, outro.idUsuario);
});
