// Central de alertas (migration 015): cada regra aparece para quem precisa
// agir e some quando a pendência é resolvida.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

let db, comprador, fornecedor, intruso;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
    intruso = await criarEmpresa(db, "Comprador", "Empresa Curiosa");
});

const alertas = async (empresa, idPedido = null) => {
    const linhas = await como(db, empresa, "SELECT * FROM alertas ORDER BY codigo");
    return idPedido === null ? linhas : linhas.filter(a => a.id_pedido === idPedido);
};
const codigos = async (empresa, idPedido) => (await alertas(empresa, idPedido)).map(a => a.codigo);

// Ajuste de datas como administrador (simula o tempo passando). Os triggers
// ficam desligados nesse ajuste: a 008 impede reescrever datas de pedido.
async function envelhecer(sql, parametros) {
    await lerComoAdmin(db, "SET session_replication_role = replica");
    try {
        return await lerComoAdmin(db, sql, parametros);
    } finally {
        await lerComoAdmin(db, "SET session_replication_role = origin");
    }
}

async function pedidoConfirmado(estoque = 100) {
    const idProduto = await criarProduto(db, fornecedor, { estoque, minimo: 1 });
    const idPedido = await criarPedido(db, comprador, idProduto, 5);
    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");
    return idPedido;
}

const pagar = async (idPedido, metodo = "PIX") => {
    await como(db, comprador, "SELECT public.iniciar_pagamento($1, $2)", [idPedido, metodo]);
    await como(db, comprador, "SELECT public.confirmar_pagamento_simulado($1, NULL, NULL)", [idPedido]);
};

test("pedido novo: fornecedor deve responder; vira urgente após 24 h", async () => {
    const idPedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);

    let [alerta] = await alertas(fornecedor, idPedido);
    assert.equal(alerta.codigo, "RESPONDER_PEDIDO");
    assert.equal(alerta.severidade, "atencao");
    assert.equal(alerta.papel, "fornecedor");
    assert.equal(alerta.parceiro_nome, "Mercado Bom Preço");

    await envelhecer("UPDATE pedidos SET data_pedido = NOW() - INTERVAL '2 days' WHERE id_pedido = $1", [idPedido]);
    [alerta] = await alertas(fornecedor, idPedido);
    assert.equal(alerta.severidade, "urgente");

    assert.deepEqual(await codigos(comprador, idPedido), [], "comprador só aguarda");
    assert.deepEqual(await alertas(intruso), [], "terceiro não vê nada");
});

test("fluxo: pagar → emitir NF-e → enviar; cada etapa troca o alerta", async () => {
    const idPedido = await pedidoConfirmado();

    assert.deepEqual(await codigos(comprador, idPedido), ["PAGAR_PEDIDO"]);
    assert.deepEqual(await codigos(fornecedor, idPedido), []);

    await pagar(idPedido);
    assert.deepEqual(await codigos(comprador, idPedido), []);
    assert.deepEqual(await codigos(fornecedor, idPedido), ["EMITIR_NFE"]);

    await como(db, fornecedor, "SELECT public.emitir_nota_fiscal($1)", [idPedido]);
    assert.deepEqual(await codigos(fornecedor, idPedido), ["PRONTO_PARA_ENVIO"]);

    await mudarStatus(db, fornecedor, idPedido, "ENVIADO");
    assert.deepEqual(await codigos(fornecedor, idPedido), [], "enviado há pouco: sem alerta");

    await envelhecer("UPDATE pedidos SET data_envio = NOW() - INTERVAL '4 days' WHERE id_pedido = $1", [idPedido]);
    assert.deepEqual(await codigos(fornecedor, idPedido), ["CONFIRMAR_ENTREGA"]);

    await mudarStatus(db, fornecedor, idPedido, "ENTREGUE");
    assert.deepEqual(await codigos(fornecedor, idPedido), []);
});

test("cobrança vencida é urgente para o comprador", async () => {
    const idPedido = await pedidoConfirmado();
    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PIX')", [idPedido]);

    assert.deepEqual(await codigos(comprador, idPedido), ["PAGAR_PEDIDO"]);

    await envelhecer("UPDATE pagamentos SET vencimento = NOW() - INTERVAL '1 hour' WHERE id_pedido = $1", [idPedido]);
    const [alerta] = await alertas(comprador, idPedido);
    assert.equal(alerta.codigo, "COBRANCA_VENCIDA");
    assert.equal(alerta.severidade, "urgente");
});

test("pagamento a prazo: fornecedor aprova; comprador acompanha a fatura", async () => {
    const idPedido = await pedidoConfirmado();
    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PRAZO', 1, 30)", [idPedido]);

    assert.deepEqual(await codigos(fornecedor, idPedido), ["APROVAR_PRAZO"]);
    assert.deepEqual(await codigos(comprador, idPedido), [], "em análise: nada a fazer");

    await como(db, fornecedor, "SELECT public.responder_pagamento_prazo($1, true, NULL)", [idPedido]);

    assert.deepEqual(await codigos(fornecedor, idPedido), ["EMITIR_NFE"], "prazo aprovado libera a NF-e");
    const [fatura] = await alertas(comprador, idPedido);
    assert.equal(fatura.codigo, "FATURA_A_PRAZO");
    assert.equal(fatura.severidade, "info");

    await envelhecer("UPDATE pagamentos SET vencimento = NOW() + INTERVAL '1 day' WHERE id_pedido = $1", [idPedido]);
    assert.equal((await alertas(comprador, idPedido))[0].severidade, "urgente");
});

test("estoque: abaixo do mínimo é urgente; abaixo de 2× o mínimo é atenção", async () => {
    const semEstoque = await criarProduto(db, fornecedor, { nome: "Acabando", minimo: 10, estoque: 4 });
    const baixo = await criarProduto(db, fornecedor, { nome: "Baixo", minimo: 10, estoque: 15 });
    await criarProduto(db, fornecedor, { nome: "Tranquilo", minimo: 10, estoque: 500 });

    const lista = (await alertas(fornecedor)).filter(a => a.id_produto && !a.id_pedido);
    const porProduto = Object.fromEntries(lista.map(a => [a.id_produto, a]));

    assert.equal(lista.length, 2);
    assert.equal(porProduto[semEstoque].codigo, "SEM_ESTOQUE");
    assert.equal(porProduto[semEstoque].severidade, "urgente");
    assert.equal(porProduto[baixo].codigo, "ESTOQUE_BAIXO");
    assert.equal(porProduto[baixo].detalhe, "10", "detalhe = pedido mínimo");

    assert.deepEqual(await alertas(comprador), [], "estoque de outro fornecedor não aparece");
});

test("cancelamento pelo comprador avisa o fornecedor por 7 dias", async () => {
    const idPedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);
    await como(db, comprador, "SELECT public.cancelar_pedido_comprador($1, 'Achei mais barato')", [idPedido]);

    const [alerta] = await alertas(fornecedor, idPedido);
    assert.equal(alerta.codigo, "CANCELADO_COMPRADOR");
    assert.equal(alerta.detalhe, "Achei mais barato");

    await envelhecer("UPDATE pedidos SET data_cancelamento = NOW() - INTERVAL '8 days' WHERE id_pedido = $1", [idPedido]);
    assert.deepEqual(await codigos(fornecedor, idPedido), []);
});

test("mensagens não lidas: só para quem recebeu, e somem ao ler", async () => {
    const idPedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);

    for (const texto of ["Oi", "Tudo certo?"]) {
        await como(db, comprador,
            "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, $3)",
            [idPedido, comprador.uid, texto]);
    }

    const mensagens = (await alertas(fornecedor, idPedido)).find(a => a.codigo === "MENSAGENS");
    assert.equal(mensagens.detalhe, "2");
    assert.equal(mensagens.papel, "fornecedor");
    assert.ok(!(await codigos(comprador, idPedido)).includes("MENSAGENS"), "remetente não é alertado");

    await como(db, fornecedor, "UPDATE mensagens_pedidos SET lida = true WHERE id_pedido = $1", [idPedido]);
    assert.ok(!(await codigos(fornecedor, idPedido)).includes("MENSAGENS"));
});
