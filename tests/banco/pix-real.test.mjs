// Pix real (migration 026): modo REAL, cobrança do provedor e confirmação
// só pelo webhook.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

let db, comprador, fornecedor, pedido;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
    const produto = await criarProduto(db, fornecedor, { preco: 10, minimo: 1 });
    pedido = await criarPedido(db, comprador, produto, 5);         // R$ 50,00
    await mudarStatus(db, fornecedor, pedido, "CONFIRMADO");
});

const modoReal = () => lerComoAdmin(db, "UPDATE configuracao_pagamentos SET modo = 'REAL'");
const pagamento = async () => (await lerComoAdmin(db, "SELECT * FROM pagamentos WHERE id_pedido = $1", [pedido]))[0];
const registrar = (id = "123", valor = 50) => lerComoAdmin(db,
    "SELECT * FROM registrar_cobranca_pix($1, $2, '000201PIXREAL', 'iVBORw0KGgo=', NOW() + INTERVAL '30 minutes', $3)",
    [pedido, id, valor]);
const webhook = (id, status, valor = 50) => lerComoAdmin(db,
    "SELECT confirmar_pagamento_provedor($1, $2, $3) AS r", [id, status, valor]).then(l => l[0].r);

test("modo padrão é SIMULADO: o fluxo da 009 segue igual; preparar_pix recusa", async () => {
    const [{ modo }] = await como(db, comprador, "SELECT modo FROM configuracao_pagamentos");
    assert.equal(modo, "SIMULADO");

    await como(db, comprador, "SELECT iniciar_pagamento($1, 'PIX')", [pedido]);
    await como(db, comprador, "SELECT confirmar_pagamento_simulado($1)", [pedido]);
    assert.equal((await pagamento()).status, "PAGO");

    assert.match(await erroDe(db, comprador, "SELECT preparar_pix($1)", [pedido]), /não está ativo/);
});

test("modo REAL: simulação bloqueada (Pix/boleto/cartão e confirmação manual)", async () => {
    await modoReal();

    for (const metodo of ["PIX", "BOLETO", "CARTAO"]) {
        assert.match(await erroDe(db, comprador, "SELECT iniciar_pagamento($1, $2, 1)", [pedido, metodo]), /pague pelo Pix \(Mercado Pago\)/, metodo);
    }

    await registrar();
    assert.match(await erroDe(db, comprador, "SELECT confirmar_pagamento_simulado($1)", [pedido]), /confirmação vem do banco/);
    // Nem trocando de forma por cima da cobrança real
    assert.match(await erroDe(db, comprador, "SELECT iniciar_pagamento($1, 'BOLETO')", [pedido]), /pague pelo Pix/);
    assert.equal((await pagamento()).provedor, "MERCADO_PAGO");
});

test("preparar_pix: só o comprador do pedido; devolve o que cobrar e reaproveita a cobrança vigente", async () => {
    await modoReal();

    const [{ preparar_pix: dados }] = await como(db, comprador, "SELECT preparar_pix($1)", [pedido]);
    assert.equal(Number(dados.valor), 50);
    assert.match(dados.descricao, /pedido #\d+: 5 un\./);
    assert.equal(dados.nome, "Mercado Bom Preço");
    assert.equal(dados.vigente, null);

    assert.match(await erroDe(db, fornecedor, "SELECT preparar_pix($1)", [pedido]), /não encontrado/);

    await registrar("123");
    const [{ preparar_pix: depois }] = await como(db, comprador, "SELECT preparar_pix($1)", [pedido]);
    assert.equal(depois.vigente.provedor_pagamento_id, "123");
});

test("webhook aprovado → PAGO (idempotente); valor divergente é recusado", async () => {
    await modoReal();
    await registrar("123");

    assert.equal(await webhook("999", "approved"), "desconhecido");
    assert.equal(await webhook("123", "pending"), "sem_mudanca");
    await assert.rejects(webhook("123", "approved", 1), /diferente do cobrado/);
    assert.equal((await pagamento()).status, "AGUARDANDO_PAGAMENTO");

    assert.equal(await webhook("123", "approved"), "pago");
    const pago = await pagamento();
    assert.equal(pago.status, "PAGO");
    assert.equal(pago.transacao_id, "MP-123");
    assert.equal(await webhook("123", "approved"), "ja_pago");

    // Notificação do e-mail/app de pagamento confirmado para o fornecedor
    const avisos = await lerComoAdmin(db, "SELECT 1 FROM notificacoes WHERE tipo = 'PAGAMENTO_CONFIRMADO' AND auth_user_id = $1", [fornecedor.uid]);
    assert.equal(avisos.length, 1);

    // O envio fica liberado como no simulado
    await como(db, fornecedor, "SELECT emitir_nota_fiscal($1)", [pedido]);
    await mudarStatus(db, fornecedor, pedido, "ENVIADO");
});

test("registrar recusa valor diferente do pedido e só o servidor registra/confirma", async () => {
    await modoReal();
    await assert.rejects(registrar("123", 49.99), /diferente do pedido/);

    assert.match(await erroDe(db, comprador,
        "SELECT registrar_cobranca_pix($1, '1', 'x', 'y', NOW(), 50)", [pedido]), /permission denied/);
    assert.match(await erroDe(db, comprador, "SELECT confirmar_pagamento_provedor('1', 'approved', 50)"), /permission denied/);
    assert.match(await erroDe(db, comprador, "UPDATE configuracao_pagamentos SET modo = 'SIMULADO'"), /permission denied/);
});

test("Pix expirado/cancelado: cobrança morre e o comprador pode gerar outra", async () => {
    await modoReal();
    await registrar("123");
    assert.equal(await webhook("123", "expired"), "encerrado");

    const morto = await pagamento();
    assert.ok(new Date(morto.vencimento) <= new Date());
    const [{ preparar_pix: dados }] = await como(db, comprador, "SELECT preparar_pix($1)", [pedido]);
    assert.equal(dados.vigente, null, "não reaproveita a cobrança morta");

    await registrar("456");
    assert.equal(await webhook("123", "approved"), "desconhecido", "a cobrança antiga não confirma mais nada");
    assert.equal(await webhook("456", "approved"), "pago");
});

test("fatura a prazo: aprovada pelo fornecedor, paga pelo Pix real e continua 'a prazo'", async () => {
    await como(db, comprador, "SELECT iniciar_pagamento($1, 'PRAZO', 1, 30)", [pedido]);
    await modoReal();
    await como(db, fornecedor, "SELECT responder_pagamento_prazo($1, true)", [pedido]);

    // Envio liberado pelo prazo; a fatura é paga depois
    await como(db, fornecedor, "SELECT emitir_nota_fiscal($1)", [pedido]);
    await mudarStatus(db, fornecedor, pedido, "ENVIADO");

    const vencimentoAntes = (await pagamento()).vencimento;
    await registrar("789");
    const comPix = await pagamento();
    assert.equal(comPix.metodo, "PRAZO");
    assert.deepEqual(comPix.vencimento, vencimentoAntes, "o vencimento da fatura não muda");

    // O QR Code da fatura expira (30 min) sem mexer no vencimento da fatura
    await lerComoAdmin(db, "UPDATE pagamentos SET pix_expira_em = NOW() - INTERVAL '1 minute' WHERE id_pedido = $1", [pedido]);
    const [{ preparar_pix: depois }] = await como(db, comprador, "SELECT preparar_pix($1)", [pedido]);
    assert.equal(depois.vigente, null, "QR Code expirado não é reaproveitado, mesmo com a fatura em dia");

    assert.equal(await webhook("789", "approved"), "pago");
    assert.equal((await pagamento()).status, "PAGO");
});

test("Pix aprovado depois do cancelamento: não vira PAGO, fica marcado para estorno", async () => {
    await modoReal();
    await registrar("123");
    await mudarStatus(db, fornecedor, pedido, "CANCELADO");

    assert.equal(await webhook("123", "approved"), "aprovado_apos_cancelamento");
    const linha = await pagamento();
    assert.equal(linha.status, "CANCELADO");
    assert.match(linha.motivo_recusa, /estornar/);
});
