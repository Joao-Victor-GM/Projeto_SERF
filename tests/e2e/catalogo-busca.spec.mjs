// Catálogo: busca, segmento, ordenação e "Carregar mais" — tudo no servidor
// (a API corta respostas em 1.000 linhas; antes o catálogo baixava tudo).

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

// 4 + 28 = 32 produtos: mais que uma página (24)
function muitosProdutos(tabelas) {
    const base = tabelas.produtos.find(p => p.id_produto === 20);
    const extras = Array.from({ length: 28 }, (_, i) => ({
        ...base,
        id_produto: 100 + i,
        nome_produto: `Item de teste ${i + 1}`,
        categoria: i % 2 ? "Embalagens & Logística" : base.categoria,
        preco_atacado: 10 + i
    }));
    tabelas.produtos = [...tabelas.produtos, ...extras];
    return tabelas;
}

async function abrir(page, tabelas = criarTabelas()) {
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/catalogo.html?modo=comprar");
    return mock;
}

const buscasDeProdutos = chamadas => chamadas.filter(c => c.tipo === "rest" && c.tabela === "produtos" && c.metodo === "GET");
const parametro = (chamada, nome) => chamada.parametros.filter(([k]) => k === nome).map(([, v]) => v);

test("primeira página tem 24 itens, total e 'Carregar mais' traz o resto", async ({ page }) => {
    const { chamadas, errosDaPagina } = await abrir(page, muitosProdutos(criarTabelas()));

    await expect(page.locator(".produto-card")).toHaveCount(24);
    await expect(page.locator("#catalogoResumo")).toHaveText(/Mostrando 24 de 32 produtos/);

    const primeira = buscasDeProdutos(chamadas).at(-1);
    expect(parametro(primeira, "limit")).toEqual(["24"]);

    await page.locator("#catalogoMais").click();
    await expect(page.locator(".produto-card")).toHaveCount(32);
    await expect(page.locator("#catalogoResumo")).toHaveText(/Mostrando 32 de 32 produtos/);
    await expect(page.locator("#catalogoMais")).toBeHidden();
    expect(parametro(buscasDeProdutos(chamadas).at(-1), "offset")).toEqual(["24"]);
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("busca por nome filtra no servidor e escapa curingas", async ({ page }) => {
    const { chamadas } = await abrir(page);
    await expect(page.locator(".produto-card").first()).toBeVisible();

    await page.locator("#catalogoBusca").fill("café");
    await expect(page.locator(".produto-card")).toHaveCount(1);
    await expect(page.locator(".produto-card")).toContainText("Café Torrado");
    expect(parametro(buscasDeProdutos(chamadas).at(-1), "nome_produto")).toEqual(["ilike.%café%"]);

    // % e _ viram espaço: não dá para "listar tudo" nem quebrar a consulta
    await page.locator("#catalogoBusca").fill("100%_(x),");
    await expect.poll(() => parametro(buscasDeProdutos(chamadas).at(-1), "nome_produto")).toEqual(["ilike.%100 x%"]);
});

test("sem resultado: mensagem própria com caminho para a cotação", async ({ page }) => {
    await abrir(page);
    await expect(page.locator(".produto-card").first()).toBeVisible();

    await page.locator("#catalogoBusca").fill("parafuso inexistente");
    await expect(page.locator("#listaProdutos")).toContainText("Nenhum produto encontrado com esses filtros");
    await expect(page.locator('#listaProdutos a[href="cotacoes.html"]')).toBeVisible();
    await expect(page.locator("#catalogoMais")).toBeHidden();
});

test("segmento e ordenação vão para a consulta", async ({ page }) => {
    const { chamadas } = await abrir(page, muitosProdutos(criarTabelas()));
    await expect(page.locator(".produto-card").first()).toBeVisible();

    await page.locator("#catalogoCategoria").selectOption("Embalagens & Logística");
    await expect(page.locator("#catalogoResumo")).toHaveText(/de 14 produtos/);
    expect(parametro(buscasDeProdutos(chamadas).at(-1), "categoria")).toEqual(["eq.Embalagens & Logística"]);

    await page.locator("#catalogoOrdem").selectOption("menor_preco");
    await expect.poll(() => parametro(buscasDeProdutos(chamadas).at(-1), "order")[0]).toMatch(/^preco_atacado\.asc/);
    await expect(page.locator(".produto-card").first()).toContainText("Item de teste 2");
});
