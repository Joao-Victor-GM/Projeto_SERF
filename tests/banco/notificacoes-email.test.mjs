// Notificações por e-mail (migration 020): o que entra na fila, para quem,
// sem duplicar, respeitando a preferência e sem quebrar o negócio.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

let db, comprador, fornecedor, outroFornecedor;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
    outroFornecedor = await criarEmpresa(db, "Fornecedor", "Atacado Norte");
});

const fila = () => lerComoAdmin(db, "SELECT tipo, auth_user_id, email, dados, chave FROM notificacoes_email ORDER BY id");
const daEmpresa = async (empresa, tipo) => (await fila()).filter(n => n.auth_user_id === empresa.uid && (!tipo || n.tipo === tipo));

test("pedido novo avisa o fornecedor dono do produto, no e-mail do cadastro", async () => {
    const produto = await criarProduto(db, fornecedor, { nome: "Arroz" });
    const pedido = await criarPedido(db, comprador, produto, 5);

    const [email] = await daEmpresa(fornecedor, "PEDIDO_RECEBIDO");
    assert.equal(email.email, `${fornecedor.uid}@teste.com`);
    assert.equal(email.dados.comprador, "Mercado Bom Preço");
    assert.deepEqual(email.dados.itens.map(i => [i.id_pedido, i.produto, i.quantidade]), [[pedido, "Arroz", 5]]);
    assert.equal((await daEmpresa(comprador)).length, 0, "quem comprou não recebe e-mail do próprio pedido");
});

test("carrinho: um e-mail por fornecedor, com todos os itens dele", async () => {
    const arroz = await criarProduto(db, fornecedor, { nome: "Arroz" });
    const feijao = await criarProduto(db, fornecedor, { nome: "Feijão" });
    const cafe = await criarProduto(db, outroFornecedor, { nome: "Café" });

    await como(db, comprador, "SELECT * FROM public.criar_compra($1::jsonb)", [JSON.stringify([
        { id_produto: arroz, quantidade: 1 }, { id_produto: feijao, quantidade: 2 }, { id_produto: cafe, quantidade: 3 }])]);

    const doSul = await daEmpresa(fornecedor, "PEDIDO_RECEBIDO");
    assert.equal(doSul.length, 1);
    assert.deepEqual(doSul[0].dados.itens.map(i => i.produto), ["Arroz", "Feijão"]);
    assert.deepEqual((await daEmpresa(outroFornecedor, "PEDIDO_RECEBIDO"))[0].dados.itens.map(i => i.produto), ["Café"]);
});

test("mudança de status avisa o comprador; cancelamento pelo comprador avisa o fornecedor", async () => {
    const produto = await criarProduto(db, fornecedor);
    const pedido = await criarPedido(db, comprador, produto, 5);

    await mudarStatus(db, fornecedor, pedido, "CONFIRMADO");
    const [status] = await daEmpresa(comprador, "STATUS_PEDIDO");
    assert.equal(status.dados.status, "CONFIRMADO");

    await como(db, comprador, "SELECT public.cancelar_pedido_comprador($1, 'Achamos outro fornecedor')", [pedido]);
    const [cancelado] = await daEmpresa(fornecedor, "PEDIDO_CANCELADO");
    assert.equal(cancelado.dados.motivo, "Achamos outro fornecedor");
    assert.equal((await daEmpresa(comprador, "STATUS_PEDIDO")).length, 1, "o comprador não recebe aviso do próprio cancelamento");
});

test("chat: avisa o outro lado, no máximo 1 e-mail a cada 30 min por conversa", async () => {
    const produto = await criarProduto(db, fornecedor);
    const pedido = await criarPedido(db, comprador, produto, 5);

    for (const texto of ["Olá!", "Conseguem entregar sexta?", "Aguardo retorno"]) {
        await como(db, comprador, "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, $3)",
            [pedido, comprador.uid, texto]);
    }

    const avisos = await daEmpresa(fornecedor, "MENSAGEM_NOVA");
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].dados.remetente, "Mercado Bom Preço");
    assert.equal(avisos[0].dados.trecho, "Olá!");

    await como(db, fornecedor, "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'Sim!')",
        [pedido, fornecedor.uid]);
    assert.equal((await daEmpresa(comprador, "MENSAGEM_NOVA")).length, 1, "resposta avisa o comprador");
});

test("pagamento confirmado e pedido de prazo avisam o fornecedor", async () => {
    const produto = await criarProduto(db, fornecedor);
    const pedidoPix = await criarPedido(db, comprador, produto, 5);
    const pedidoPrazo = await criarPedido(db, comprador, produto, 5);
    for (const p of [pedidoPix, pedidoPrazo]) await mudarStatus(db, fornecedor, p, "CONFIRMADO");

    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PIX')", [pedidoPix]);
    assert.equal((await daEmpresa(fornecedor, "PAGAMENTO_CONFIRMADO")).length, 0, "cobrança gerada ainda não é pagamento");
    await como(db, comprador, "SELECT public.confirmar_pagamento_simulado($1, NULL, NULL)", [pedidoPix]);
    assert.equal((await daEmpresa(fornecedor, "PAGAMENTO_CONFIRMADO")).length, 1);

    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PRAZO', 1, 30)", [pedidoPrazo]);
    const [prazo] = await daEmpresa(fornecedor, "PRAZO_SOLICITADO");
    assert.equal(prazo.dados.prazo_dias, 30);
});

test("quem desliga os e-mails não recebe", async () => {
    await como(db, fornecedor, "INSERT INTO preferencias_notificacao (receber_email) VALUES (false)");
    await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);
    assert.equal((await daEmpresa(fornecedor)).length, 0);
});

test("privacidade: ninguém lê a fila nem a preferência dos outros", async () => {
    await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);

    assert.match(await erroDe(db, fornecedor, "SELECT * FROM notificacoes_email"), /permission denied/);
    assert.match(await erroDe(db, comprador, "SELECT * FROM public.reservar_emails(10)"), /permission denied/);
    assert.match(await erroDe(db, comprador, "SELECT public.enfileirar_email($1, 'MENSAGEM_NOVA', '{}', 'x')", [comprador.uid]),
        /permission denied/);

    await como(db, fornecedor, "INSERT INTO preferencias_notificacao (receber_email) VALUES (false)");
    assert.equal((await como(db, comprador, "SELECT * FROM preferencias_notificacao")).length, 0);
});

test("reserva para envio: a mesma mensagem nunca é pega duas vezes", async () => {
    await criarPedido(db, comprador, await criarProduto(db, fornecedor), 5);
    await criarPedido(db, comprador, await criarProduto(db, outroFornecedor), 5);

    const primeira = await lerComoAdmin(db, "SELECT id FROM public.reservar_emails(10)");
    const segunda = await lerComoAdmin(db, "SELECT id FROM public.reservar_emails(10)");

    assert.equal(primeira.length, 2);
    assert.equal(segunda.length, 0, "reservados não voltam enquanto a reserva vale");
});

test("falha ao enfileirar não desfaz o pedido", async () => {
    const produto = await criarProduto(db, fornecedor);
    // Simula a fila quebrada (ex.: tabela travada/alterada em produção)
    await lerComoAdmin(db, "ALTER TABLE notificacoes_email ADD CONSTRAINT ck_quebra CHECK (false) NOT VALID");

    const pedido = await criarPedido(db, comprador, produto, 5);
    assert.ok(pedido, "o pedido foi criado mesmo sem conseguir enfileirar o e-mail");
    assert.equal((await fila()).length, 0);
});
