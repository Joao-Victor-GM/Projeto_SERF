// Ataques reais contra o front-end: um usuário mal-intencionado grava HTML
// em campos que OUTRAS empresas vão ver. Nada pode executar.

import { test, expect } from "@playwright/test";
import { simularSupabase } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const ATAQUE = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';

test("catálogo: nome de produto com HTML (de outro fornecedor) não executa no detalhe", async ({ page }) => {
    const tabelas = criarTabelas();
    const produto = tabelas.produtos.find(p => p.id_produto === 20);
    produto.nome_produto = ATAQUE;
    produto.descricao = ATAQUE;
    produto.marca = ATAQUE;

    await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/catalogo.html");

    await page.locator('.btn-ver-detalhes[data-id="20"]').click();
    await expect(page.locator(".swal2-popup")).toBeVisible();
    await expect(page.locator(".swal2-title")).toHaveText(ATAQUE);       // aparece como texto
    await expect(page.locator(".swal2-html-container img")).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test("cotações: nome do fornecedor com HTML no 'Aceitar a proposta de …?'", async ({ page }) => {
    const tabelas = criarTabelas();
    tabelas.cotacoes = [{
        id_cotacao: 10, id_usuario: 1, comprador_nome: "Eu", titulo: ATAQUE, descricao: ATAQUE, categoria: "Outros",
        quantidade: 5, unidade: "un.", preco_alvo: null, valida_ate: new Date(Date.now() + 86400000).toISOString(),
        status: "ABERTA", criada_em: new Date().toISOString(),
        propostas: [{ id_proposta: 1, id_cotacao: 10, id_fornecedor: 9, id_produto: 9, fornecedor_nome: ATAQUE,
            produto_nome: ATAQUE, preco_unitario: 10, prazo_entrega_dias: 2, observacao: ATAQUE, status: "ENVIADA" }]
    }];

    await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/cotacoes.html");
    await page.locator("#cot-10").getByRole("button", { name: "Aceitar" }).click();

    await expect(page.locator(".swal2-title")).toContainText(ATAQUE);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test("sino: notificação com nome de empresa em HTML aparece como texto", async ({ page }) => {
    const tabelas = criarTabelas();
    tabelas.notificacoes = [{ id: 1, tipo: "PEDIDO_CANCELADO", quantidade: 1, lida_em: null,
        criada_em: new Date().toISOString(), atualizada_em: new Date().toISOString(),
        dados: { id_pedido: 201, comprador: ATAQUE, motivo: ATAQUE } }];

    await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/home.html");
    await page.locator("#notifSino").click();

    await expect(page.locator("#notifPainel")).toContainText(ATAQUE);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
