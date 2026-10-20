// Pagamento do pedido (pagamentos.js): modo SIMULADO (padrão) e Pix REAL
// pelo Mercado Pago (migration 026, Edge Function pix-criar).

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

// Pedido 102: compra da EMPRESA, CONFIRMADO pelo fornecedor, sem pagamento
const PEDIDO = 102;

async function abrirPagamento(page, { modo, funcoes = {} } = {}) {
    const tabelas = criarTabelas();
    tabelas.pagamentos = [];
    if (modo) tabelas.configuracao_pagamentos = [{ modo }];

    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas, funcoes });
    await page.goto(`/pages/app/home.html?pedido=${PEDIDO}`);

    const secao = page.locator("#pedidoPagamento");
    await secao.getByRole("button", { name: /^Pagar R\$/ }).click();
    await expect(page.locator("#modalPagamento")).toBeVisible();
    return { ...mock, tabelas };
}

const abas = page => page.locator("#modalPagamento .pag-metodo:visible");

test("SIMULADO (padrão): 4 formas, aviso de ambiente de testes e botão de simular", async ({ page }) => {
    const { errosDaPagina } = await abrirPagamento(page);

    await expect(abas(page)).toHaveText([/Pix/, /Cartão de crédito/, /Boleto/, /Faturamento a prazo/]);
    await expect(page.locator("#pagAviso")).toContainText("Ambiente de testes");
    await expect(page.getByRole("button", { name: "Gerar QR Code Pix" })).toBeVisible();
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("REAL: só Pix e prazo; QR Code do Mercado Pago; confirma sozinho quando o banco aprova", async ({ page }) => {
    const agora = Date.now();
    const pagamentoMp = {
        id_pagamento: 1, id_pedido: PEDIDO, metodo: "PIX", status: "AGUARDANDO_PAGAMENTO", valor: 510,
        provedor: "MERCADO_PAGO", provedor_pagamento_id: "123456789", codigo_pix: "00020101021226PIXREAL6304ABCD",
        qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
        pix_expira_em: new Date(agora + 30 * 60000).toISOString(), vencimento: new Date(agora + 30 * 60000).toISOString(),
        parcelas: 1, transacao_id: null, data_pagamento: null
    };

    const { chamadas, tabelas, errosDaPagina } = await abrirPagamento(page, {
        modo: "REAL",
        funcoes: {
            "pix-criar": (corpo, tabelasDoMock) => {
                tabelasDoMock.pagamentos = [structuredClone(pagamentoMp)];
                return { pagamento: pagamentoMp, reaproveitado: false };
            }
        }
    });

    await expect(abas(page)).toHaveText([/Pix/, /Faturamento a prazo/]);
    await expect(page.locator("#pagAviso")).toContainText("Pagamento real");

    await page.getByRole("button", { name: "Gerar QR Code Pix" }).click();

    await expect(page.getByRole("img", { name: "QR Code do Pix" })).toBeVisible();
    await expect(page.locator("#pagCodigoPix")).toHaveValue("00020101021226PIXREAL6304ABCD");
    await expect(page.locator(".pag-aguardando")).toContainText("Aguardando o pagamento");
    await expect(page.getByRole("button", { name: /Simular/ })).toHaveCount(0);   // nada de simular com dinheiro real
    expect(chamadas.find(c => c.tipo === "funcao")).toEqual({ tipo: "funcao", nome: "pix-criar", corpo: { id_pedido: PEDIDO } });

    // O webhook marca PAGO no banco → a tela percebe sozinha
    tabelas.pagamentos[0].status = "PAGO";
    tabelas.pagamentos[0].transacao_id = "MP-123456789";
    tabelas.pagamentos[0].data_pagamento = new Date().toISOString();

    await expect(page.locator("#modalPagamento")).toBeHidden({ timeout: 10000 });
    await expect(page.locator(".swal2-popup")).toContainText("Pagamento confirmado!");
    await expect(page.locator("#pedidoPagamento")).toContainText("Pago");
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("REAL: erro do servidor (ex.: já pago) aparece e o botão volta", async ({ page }) => {
    await abrirPagamento(page, {
        modo: "REAL",
        funcoes: { "pix-criar": () => { throw Object.assign(new Error("Este pedido já está pago."), { status: 409 }); } }
    });

    await page.getByRole("button", { name: "Gerar QR Code Pix" }).click();
    await expect(page.locator(".swal2-popup")).toContainText("Este pedido já está pago.");
    await page.locator(".swal2-confirm").click();
    await expect(page.getByRole("button", { name: "Gerar QR Code Pix" })).toBeEnabled();
});
