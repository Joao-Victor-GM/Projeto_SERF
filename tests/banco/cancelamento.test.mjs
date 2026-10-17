// Cancelamento do pedido pelo comprador (migration 013).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
    criarBanco, como, erroDe, criarEmpresa, criarProduto,
    criarPedido, mudarStatus, lerComoAdmin
} from "./banco.mjs";

let db, comprador, fornecedor, intruso;

before(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador");
    fornecedor = await criarEmpresa(db, "Fornecedor");
    intruso = await criarEmpresa(db, "Comprador");
});

const cancelar = (empresa, idPedido, motivo = null) =>
    erroDe(db, empresa, "SELECT public.cancelar_pedido_comprador($1, $2)", [idPedido, motivo]);

const pedidoAdmin = async idPedido =>
    (await lerComoAdmin(db, "SELECT * FROM pedidos WHERE id_pedido = $1", [idPedido]))[0];

test("comprador cancela pedido pendente sem motivo", async () => {
    const idPedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);

    assert.equal(await cancelar(comprador, idPedido), null);

    const pedido = await pedidoAdmin(idPedido);
    assert.equal(pedido.status_pedido, "CANCELADO");
    assert.ok(pedido.data_cancelamento, "data preenchida pelo trigger");

    const [historico] = await lerComoAdmin(db,
        "SELECT alterado_por FROM pedidos_historico_status WHERE id_pedido = $1 AND status_novo = 'CANCELADO'",
        [idPedido]);
    assert.equal(historico.alterado_por, comprador.uid, "histórico registra o comprador");
});

test("só o comprador do pedido pode cancelar", async () => {
    const idPedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);

    assert.match(await cancelar(intruso, idPedido), /não encontrado/);
    assert.match(await cancelar(fornecedor, idPedido), /não encontrado/);
    assert.equal((await pedidoAdmin(idPedido)).status_pedido, "PENDENTE");
});

test("pedido confirmado: exige motivo e devolve o estoque", async () => {
    const idProduto = await criarProduto(db, fornecedor, { estoque: 50 });
    const idPedido = await criarPedido(db, comprador, idProduto, 10);
    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");

    assert.match(await cancelar(comprador, idPedido), /motivo/);
    assert.match(await cancelar(comprador, idPedido, "curto"), /mínimo de 10/);
    assert.equal(await cancelar(comprador, idPedido, "Compramos de outro fornecedor"), null);

    const pedido = await pedidoAdmin(idPedido);
    assert.equal(pedido.status_pedido, "CANCELADO");
    assert.equal(pedido.motivo_cancelamento, "Compramos de outro fornecedor");

    const [produto] = await lerComoAdmin(db, "SELECT quantidade_estoque FROM produtos WHERE id_produto = $1", [idProduto]);
    assert.equal(produto.quantidade_estoque, 50);
});

test("pedido pago ou enviado não pode ser cancelado pelo comprador", async () => {
    const idPedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);
    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");
    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PIX')", [idPedido]);
    await como(db, comprador, "SELECT public.confirmar_pagamento_simulado($1, NULL, NULL)", [idPedido]);

    assert.match(await cancelar(comprador, idPedido, "Motivo bem explicado"), /já foi pago/);

    await como(db, fornecedor, "SELECT public.emitir_nota_fiscal($1)", [idPedido]);
    await mudarStatus(db, fornecedor, idPedido, "ENVIADO");
    assert.match(await cancelar(comprador, idPedido, "Motivo bem explicado"), /não pode mais ser cancelado/);
});

test("pedido confirmado com pagamento pendente: cancela e encerra a cobrança", async () => {
    const idPedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);
    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");
    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'BOLETO')", [idPedido]);

    assert.equal(await cancelar(comprador, idPedido, "Prazo de entrega não atende"), null);

    const [pagamento] = await lerComoAdmin(db, "SELECT status FROM pagamentos WHERE id_pedido = $1", [idPedido]);
    assert.equal(pagamento.status, "CANCELADO");
});

test("comprador continua sem UPDATE direto em pedidos", async () => {
    const idPedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);
    await mudarStatus(db, comprador, idPedido, "CANCELADO"); // RLS: 0 linhas
    assert.equal((await pedidoAdmin(idPedido)).status_pedido, "PENDENTE");

    const erro = await erroDe(db, comprador,
        "UPDATE pedidos SET motivo_cancelamento = 'x' WHERE id_pedido = $1", [idPedido]);
    assert.match(erro, /permission denied/);
});
