// A Home em módulos ES (js/home/): nada vaza para o escopo global; o que
// os outros scripts usam é a API explícita window.SERFHome.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

test("Home: sem globais soltas; só a API SERFHome", async ({ page }) => {
    const { errosDaPagina } = await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

    const globais = await page.evaluate(() => ["abrirDetalhesPedido", "atualizarDashboard", "pedidosCache", "elementos",
        "chat", "iniciarHome", "abrirPedidoPorId", "alterarModo"].filter(nome => {
        try { return typeof (0, eval)(nome) !== "undefined"; } catch { return false; }
    }));
    expect(globais).toEqual([]);

    expect(await page.evaluate(() => Object.keys(window.SERFHome).sort()))
        .toEqual(["abrirPedidoPorId", "adicionarMensagens", "alterarModo"]);
    expect(await page.evaluate(() => Object.isFrozen(window.SERFHome))).toBe(true);
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("ações de outros scripts continuam abrindo o pedido pela API", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

    // "Precisa da sua ação" (acoes-pendentes.js, script clássico) → SERFHome.abrirPedidoPorId
    await page.locator('#acoesLista [data-pedido="201"]').click();
    await expect(page.locator("#modalPedido")).toBeVisible();
    await expect(page.locator("#modalPedido")).toContainText("#201");
});
