// Ciclo completo do pedido: status, estoque, pagamento, NF-e e histórico.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
    criarBanco, como, erroDe, criarEmpresa, criarProduto,
    criarPedido, mudarStatus, lerComoAdmin
} from "./banco.mjs";

let db, comprador, fornecedor;

before(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador");
    fornecedor = await criarEmpresa(db, "Fornecedor");
});

const estoque = async idProduto =>
    (await lerComoAdmin(db, "SELECT quantidade_estoque FROM produtos WHERE id_produto = $1", [idProduto]))[0]
        .quantidade_estoque;

const statusDe = async idPedido =>
    (await lerComoAdmin(db, "SELECT status_pedido FROM pedidos WHERE id_pedido = $1", [idPedido]))[0]
        .status_pedido;

test("quantidade mínima e estoque são validados na criação", async () => {
    const idProduto = await criarProduto(db, fornecedor, { minimo: 5, estoque: 20 });

    const abaixo = await erroDe(db, comprador,
        "INSERT INTO pedidos (id_usuario, id_produto, quantidade, valor_unitario) VALUES ($1, $2, 2, 1)",
        [comprador.idUsuario, idProduto]);
    assert.match(abaixo, /quantidade mínima/);

    const acima = await erroDe(db, comprador,
        "INSERT INTO pedidos (id_usuario, id_produto, quantidade, valor_unitario) VALUES ($1, $2, 50, 1)",
        [comprador.idUsuario, idProduto]);
    assert.match(acima, /Estoque insuficiente/);
});

test("fluxo feliz: confirmar → pagar → NF-e → enviar → entregar", async () => {
    const idProduto = await criarProduto(db, fornecedor, { estoque: 100 });
    const idPedido = await criarPedido(db, comprador, idProduto, 10);

    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");
    assert.equal(await estoque(idProduto), 90, "estoque reservado ao confirmar");

    // Sem pagamento e sem nota, o envio é bloqueado
    assert.match(await erroDe(db, fornecedor,
        "UPDATE pedidos SET status_pedido = 'ENVIADO' WHERE id_pedido = $1", [idPedido]),
        /nota fiscal|pagamento/i);

    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PIX')", [idPedido]);
    await como(db, comprador, "SELECT public.confirmar_pagamento_simulado($1, NULL, NULL)", [idPedido]);

    const [pagamento] = await lerComoAdmin(db, "SELECT status FROM pagamentos WHERE id_pedido = $1", [idPedido]);
    assert.equal(pagamento.status, "PAGO");

    // Só o fornecedor emite a nota
    assert.match(await erroDe(db, comprador, "SELECT public.emitir_nota_fiscal($1)", [idPedido]),
        /não encontrado/);
    await como(db, fornecedor, "SELECT public.emitir_nota_fiscal($1)", [idPedido]);

    await mudarStatus(db, fornecedor, idPedido, "ENVIADO");
    await mudarStatus(db, fornecedor, idPedido, "ENTREGUE");
    assert.equal(await statusDe(idPedido), "ENTREGUE");

    const [datas] = await lerComoAdmin(db,
        "SELECT data_resposta, data_envio, data_entrega FROM pedidos WHERE id_pedido = $1", [idPedido]);
    assert.ok(datas.data_resposta && datas.data_envio && datas.data_entrega, "datas preenchidas pelo banco");

    const historico = await como(db, comprador,
        "SELECT status_novo FROM pedidos_historico_status WHERE id_pedido = $1 ORDER BY id_historico", [idPedido]);
    assert.deepEqual(historico.map(h => h.status_novo),
        ["PENDENTE", "CONFIRMADO", "ENVIADO", "ENTREGUE"]);
});

test("transição inválida é recusada", async () => {
    const idProduto = await criarProduto(db, fornecedor);
    const idPedido = await criarPedido(db, comprador, idProduto, 1);

    assert.match(await erroDe(db, fornecedor,
        "UPDATE pedidos SET status_pedido = 'ENTREGUE' WHERE id_pedido = $1", [idPedido]),
        /Transição de status inválida/);
});

test("fornecedor cancela pedido confirmado e pago: estoque volta, pagamento estornado", async () => {
    const idProduto = await criarProduto(db, fornecedor, { estoque: 30 });
    const idPedido = await criarPedido(db, comprador, idProduto, 10);

    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");
    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PIX')", [idPedido]);
    await como(db, comprador, "SELECT public.confirmar_pagamento_simulado($1, NULL, NULL)", [idPedido]);

    await mudarStatus(db, fornecedor, idPedido, "CANCELADO");

    assert.equal(await estoque(idProduto), 30);
    const [pagamento] = await lerComoAdmin(db, "SELECT status FROM pagamentos WHERE id_pedido = $1", [idPedido]);
    assert.equal(pagamento.status, "ESTORNADO");
});
