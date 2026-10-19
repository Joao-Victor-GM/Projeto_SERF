// Sugestões de fornecedores na busca da Home (auto-complete).

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

function tabelasComFornecedores() {
    const tabelas = criarTabelas();
    tabelas.fornecedores_publicos.push(
        { id_fornecedor: 7, razao_social: "Distribuidora Sudeste S.A.", nome_fantasia: null, cidade: "Santos", estado: "SP", nicho: "Alimentos" },
        { id_fornecedor: 8, razao_social: "Ind. Laticínios Serra Ltda", nome_fantasia: "Laticínios Serra", cidade: "Ponta Grossa", estado: "PR", nicho: "Alimentos" }
    );
    return tabelas;
}

async function abrirHome(page, tabelas = tabelasComFornecedores()) {
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");
    return mock;
}

const campo = page => page.locator("#buscaGlobal");
const lista = page => page.locator("#resultadoBusca");

test("sugere fornecedores pelo nome fantasia ou razão social", async ({ page }) => {
    const { errosDaPagina } = await abrirHome(page);

    await campo(page).pressSequentially("distr", { delay: 20 });

    await expect(lista(page)).toBeVisible();
    await expect(lista(page).locator('[role="option"]')).toHaveText(["Distribuidora Sudeste S.A.", "Distribuidora Sul"]);
    await expect(campo(page)).toHaveAttribute("aria-expanded", "true");

    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("termo com ponto e pontuação de razão social funciona (\"S.A.\", \"Ind.\")", async ({ page }) => {
    const { chamadas } = await abrirHome(page);

    await campo(page).fill("S.A.");
    await expect(lista(page).locator('[role="option"]')).toHaveText(["Distribuidora Sudeste S.A."]);

    await campo(page).fill("ind. lat");
    await expect(lista(page).locator('[role="option"]')).toHaveText(["Laticínios Serra"]);

    // Só a view leve; a vitrine (agrega todos os pedidos) nunca é consultada
    expect(chamadas.some(c => c.tabela === "fornecedores_vitrine")).toBe(false);
});

test("curingas e aspas digitados viram texto comum", async ({ page }) => {
    const { chamadas } = await abrirHome(page);

    await campo(page).fill('%"_*');
    await page.waitForTimeout(500);

    // Sobra só espaço: menos de 2 letras, nenhuma consulta
    expect(chamadas.filter(c => c.tabela === "fornecedores_publicos" && c.parametros.some(([k]) => k === "or"))).toHaveLength(0);
    await expect(lista(page)).toBeHidden();
});

test("teclado: setas escolhem, Enter abre Empresas já filtrada", async ({ page }) => {
    await abrirHome(page);

    await campo(page).pressSequentially("distr", { delay: 20 });
    await expect(lista(page).locator('[role="option"]')).toHaveCount(2);

    await campo(page).press("ArrowDown");
    await campo(page).press("ArrowDown");
    await expect(lista(page).locator('[aria-selected="true"]')).toHaveText("Distribuidora Sul");
    await expect(campo(page)).toHaveAttribute("aria-activedescendant", "sugestao-fornecedor-1");

    await campo(page).press("ArrowDown");                          // volta ao primeiro
    await expect(lista(page).locator('[aria-selected="true"]')).toHaveText("Distribuidora Sudeste S.A.");

    await campo(page).press("Enter");

    await expect(page).toHaveURL(/empresas\.html\?busca=Distribuidora%20Sudeste%20S\.A\./);
    await expect(page.locator("#filtroBuscaEmp")).toHaveValue("Distribuidora Sudeste S.A.");
});

test("clique na sugestão abre Empresas com o filtro aplicado", async ({ page }) => {
    await abrirHome(page);

    await campo(page).pressSequentially("serra", { delay: 20 });
    await lista(page).getByText("Laticínios Serra").click();

    await expect(page).toHaveURL(/empresas\.html\?busca=/);
    await expect(page.locator("#filtroBuscaEmp")).toHaveValue("Laticínios Serra");
    await expect(page.locator("#gradeFornecedores")).not.toContainText("Distribuidora Sul");
});

test("Esc fecha; menos de 2 letras não sugere", async ({ page }) => {
    await abrirHome(page);

    await campo(page).pressSequentially("distr", { delay: 20 });
    await expect(lista(page)).toBeVisible();

    await campo(page).press("Escape");
    await expect(lista(page)).toBeHidden();
    await expect(campo(page)).toHaveAttribute("aria-expanded", "false");

    await campo(page).fill("d");
    await page.waitForTimeout(500);
    await expect(lista(page)).toBeHidden();
});

test("falha na API: sem sugestões, a busca da tabela continua", async ({ page }) => {
    await simularSupabase(page, {
        usuario: EMPRESA, tabelas: tabelasComFornecedores(), falhas: { fornecedores_publicos: "erro" }
    });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

    await campo(page).fill("café");
    await expect(page.locator("#totalPedidos")).toHaveText("1 pedido");
    await expect(lista(page)).toBeHidden();
});
