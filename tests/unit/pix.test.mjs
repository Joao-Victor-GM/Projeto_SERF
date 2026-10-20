// Pix real: Mercado Pago (supabase/functions/_shared/mercadopago.ts) e as
// regras das Edge Functions pix-criar e pix-webhook. Sem rede.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { montarCobrancaPix, lerCobranca, assinaturaValida, dataComFuso, chaveDeIdempotencia }
    from "../../supabase/functions/_shared/mercadopago.ts";
import { tratarCriarPix, ErroDeRegra as ErroCriar } from "../../supabase/functions/pix-criar/regras.ts";
import { tratarWebhook, ErroDeRegra as ErroWebhook } from "../../supabase/functions/pix-webhook/regras.ts";

const PEDIDO = { id_pedido: 42, valor: "510.00", descricao: "S.E.R.F. pedido #42: 20 un. de Arroz", email: "compras@mercado.com",
    cnpj: "12.345.678/0001-90", nome: "Mercado Bom Preço" };
const AGORA = new Date("2026-10-20T15:00:00Z");
const RESPOSTA_MP = {
    id: 123456789, status: "pending", transaction_amount: 510, date_of_expiration: "2026-10-20T12:30:00.000-03:00",
    external_reference: "serf-pedido-42",
    point_of_interaction: { transaction_data: { qr_code: "00020101021226...6304ABCD", qr_code_base64: "iVBORw0KGgo=" } }
};

const silenciar = async tarefa => {
    const original = console.error;
    console.error = () => {};
    try { return await tarefa(); } finally { console.error = original; }
};

/* ---------------- Mercado Pago (puro) ---------------- */

test("cobrança Pix: valor numérico, CNPJ só dígitos, expira em 30 min com fuso, referência do pedido", () => {
    const corpo = montarCobrancaPix(PEDIDO, { urlWebhook: "https://x.supabase.co/functions/v1/pix-webhook", agora: AGORA });

    assert.equal(corpo.transaction_amount, 510);
    assert.equal(corpo.payment_method_id, "pix");
    assert.equal(corpo.external_reference, "serf-pedido-42");
    assert.deepEqual(corpo.payer.identification, { type: "CNPJ", number: "12345678000190" });
    assert.equal(corpo.date_of_expiration, "2026-10-20T12:30:00.000-03:00");
    assert.equal(dataComFuso(AGORA), "2026-10-20T12:00:00.000-03:00");
});

test("idempotência: cliques no mesmo minuto usam a mesma chave", () => {
    assert.equal(chaveDeIdempotencia(42, AGORA), chaveDeIdempotencia(42, new Date(AGORA.getTime() + 30000)));
    assert.notEqual(chaveDeIdempotencia(42, AGORA), chaveDeIdempotencia(42, new Date(AGORA.getTime() + 61000)));
});

test("lê o QR Code da resposta; sem QR Code é erro", () => {
    assert.deepEqual(lerCobranca(RESPOSTA_MP), {
        id: "123456789", codigo: "00020101021226...6304ABCD", qrBase64: "iVBORw0KGgo=",
        expiraEm: "2026-10-20T12:30:00.000-03:00", valor: 510
    });
    assert.throws(() => lerCobranca({ id: 1 }), /sem QR Code/);
});

// Assinatura como o Mercado Pago gera
function assinar(segredo, idDado, idRequisicao, ts = "1760972400") {
    const v1 = crypto.createHmac("sha256", segredo).update(`id:${idDado};request-id:${idRequisicao};ts:${ts};`).digest("hex");
    return `ts=${ts},v1=${v1}`;
}

test("assinatura do webhook: válida só com o segredo, o id e a requisição certos", async () => {
    const assinatura = assinar("segredo", "123456789", "req-1");
    const base = { assinatura, idRequisicao: "req-1", idDado: "123456789", segredo: "segredo" };

    assert.equal(await assinaturaValida(base), true);
    assert.equal(await assinaturaValida({ ...base, segredo: "outro" }), false);
    assert.equal(await assinaturaValida({ ...base, idDado: "999" }), false);
    assert.equal(await assinaturaValida({ ...base, idRequisicao: "req-2" }), false);
    assert.equal(await assinaturaValida({ ...base, assinatura: null }), false);
    assert.equal(await assinaturaValida({ ...base, segredo: "" }), false, "sem segredo configurado, nada passa");
});

/* ---------------- pix-criar ---------------- */

function criarPix({ preparar, criarNoProvedor, registrar } = {}) {
    const chamadas = [];
    const deps = {
        urlWebhook: "https://x.supabase.co/functions/v1/pix-webhook",
        agora: () => AGORA,
        preparar: preparar || (async (token, id) => { chamadas.push(["preparar", token, id]); return { ...PEDIDO, vigente: null }; }),
        criarNoProvedor: criarNoProvedor || (async (corpo, chave) => { chamadas.push(["provedor", corpo.transaction_amount, chave]); return RESPOSTA_MP; }),
        registrar: registrar || (async dados => { chamadas.push(["registrar", dados]); return { id_pedido: dados.idPedido, provedor: "MERCADO_PAGO" }; })
    };
    const pedir = (corpo, token = "jwt-do-comprador") => tratarCriarPix(new Request("https://x/functions/v1/pix-criar", {
        method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify(corpo)
    }), deps);
    return { pedir, chamadas };
}

test("pix-criar: confere com a sessão do comprador, cria no provedor e registra", async () => {
    const { pedir, chamadas } = criarPix();
    const resposta = await pedir({ id_pedido: 42 });

    assert.equal(resposta.status, 200);
    assert.deepEqual((await resposta.json()).pagamento, { id_pedido: 42, provedor: "MERCADO_PAGO" });
    assert.deepEqual(chamadas.map(c => c[0]), ["preparar", "provedor", "registrar"]);
    assert.equal(chamadas[0][1], "jwt-do-comprador");
    assert.equal(chamadas[1][2], chaveDeIdempotencia(42, AGORA));
    assert.equal(chamadas[2][1].id, "123456789");
});

test("pix-criar: cobrança vigente é reaproveitada (nada novo no provedor)", async () => {
    const vigente = { id_pedido: 42, provedor_pagamento_id: "111" };
    const { pedir, chamadas } = criarPix({ preparar: async () => ({ ...PEDIDO, vigente }) });

    const corpo = await (await pedir({ id_pedido: 42 })).json();
    assert.deepEqual(corpo, { pagamento: vigente, reaproveitado: true });
    assert.deepEqual(chamadas, []);
});

test("pix-criar: erros — sem sessão 401, pedido inválido 400, regra 409, provedor fora 502", async () => {
    assert.equal((await criarPix().pedir({ id_pedido: 42 }, null)).status, 401);
    assert.equal((await criarPix().pedir({ id_pedido: "abc" })).status, 400);

    const regra = criarPix({ preparar: async () => { throw new ErroCriar("Este pedido já está pago."); } });
    const r409 = await regra.pedir({ id_pedido: 42 });
    assert.equal(r409.status, 409);
    assert.equal((await r409.json()).erro, "Este pedido já está pago.");

    await silenciar(async () => {
        const fora = criarPix({ criarNoProvedor: async () => { throw new Error("ECONNRESET"); } });
        const r502 = await fora.pedir({ id_pedido: 42 });
        assert.equal(r502.status, 502);
        assert.doesNotMatch(await r502.text(), /ECONNRESET/);
        assert.equal(fora.chamadas.filter(c => c[0] === "registrar").length, 0);
    });
});

/* ---------------- pix-webhook ---------------- */

function webhook({ consultar, confirmar } = {}) {
    const chamadas = [];
    const deps = {
        segredo: "segredo",
        consultarPagamento: consultar || (async id => { chamadas.push(["consultar", id]); return { ...RESPOSTA_MP, id: Number(id), status: "approved" }; }),
        confirmar: confirmar || (async (id, status, valor) => { chamadas.push(["confirmar", id, status, valor]); return "pago"; })
    };
    const notificar = ({ id = "123456789", tipo = "payment", assinatura = assinar("segredo", id, "req-1") } = {}) =>
        tratarWebhook(new Request(`https://x/functions/v1/pix-webhook?data.id=${id}&type=${tipo}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-signature": assinatura, "x-request-id": "req-1" },
            body: JSON.stringify({ action: "payment.updated", type: tipo, data: { id } })
        }), deps);
    return { notificar, chamadas };
}

test("webhook: assinatura válida → consulta na API e confirma com o status e valor CONSULTADOS", async () => {
    const { notificar, chamadas } = webhook();
    const resposta = await notificar();

    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { resultado: "pago" });
    assert.deepEqual(chamadas, [["consultar", "123456789"], ["confirmar", "123456789", "approved", 510]]);
});

test("webhook: assinatura inválida → 401 e nada é consultado", async () => {
    const { notificar, chamadas } = webhook();
    assert.equal((await notificar({ assinatura: assinar("segredo-falso", "123456789", "req-1") })).status, 401);
    assert.deepEqual(chamadas, []);
});

test("webhook: outros eventos e pagamentos de outra origem são ignorados com 200", async () => {
    const outroTipo = webhook();
    assert.equal((await outroTipo.notificar({ tipo: "merchant_order" })).status, 200);
    assert.deepEqual(outroTipo.chamadas, []);

    const outraOrigem = webhook({ consultar: async () => ({ ...RESPOSTA_MP, external_reference: "loja-x-1" }) });
    assert.deepEqual(await (await outraOrigem.notificar()).json(), { ignorado: "outra origem" });
    assert.deepEqual(outraOrigem.chamadas, []);
});

test("webhook: falha temporária → 5xx (o provedor tenta de novo); regra do banco → 200 (repetir não resolve)", async () => {
    await silenciar(async () => {
        assert.equal((await webhook({ consultar: async () => { throw new Error("timeout"); } }).notificar()).status, 502);
        assert.equal((await webhook({ confirmar: async () => { throw new Error("db down"); } }).notificar()).status, 500);

        const divergente = webhook({ confirmar: async () => { throw new ErroWebhook("Valor pago (1) diferente do cobrado (510)"); } });
        const resposta = await divergente.notificar();
        assert.equal(resposta.status, 200);
        assert.equal((await resposta.json()).resultado, "recusado");
    });
});
