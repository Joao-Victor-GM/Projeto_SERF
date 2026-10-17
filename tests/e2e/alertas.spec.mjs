// Central de alertas e item "Alertas" no menu lateral.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

async function abrir(page, caminho, { tabelas = criarTabelas(), falhas } = {}) {
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas, falhas });
    await page.goto(caminho);
    return mock;
}

const PAGINAS_INTERNAS = ["home", "catalogo", "empresas", "relatorios", "perfil", "alertas"];

test.describe("menu lateral", () => {
    for (const pagina of PAGINAS_INTERNAS) {
        test(`${pagina}: "Alertas" no lugar de "Perfil", com contador`, async ({ page }) => {
            const { errosDaPagina } = await abrir(page, `/pages/app/${pagina}.html`);
            const menu = page.locator("#sidebar .sidebar-nav");

            await expect(menu.locator('a[data-page="alertas"]')).toHaveAttribute("href", "alertas.html");
            await expect(menu.locator('a[data-page="perfil"]')).toHaveCount(0);
            await expect(menu).not.toContainText("Perfil");

            // 2 urgentes + 1 atenção; informativos não contam
            const contador = menu.locator("[data-alertas-contagem]");
            await expect(contador).toHaveText("3");
            await expect(contador).toHaveClass(/urgente/);

            // O perfil continua acessível pelo canto superior direito
            await expect(page.locator(".topbar .profile-button, .topbar #btnPerfil").first()).toBeVisible();

            expect(errosRelevantes(errosDaPagina)).toEqual([]);
        });
    }

    test("sem pendências, o contador fica escondido", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.alertas = tabelas.alertas.filter(a => a.severidade === "info");

        await abrir(page, "/pages/app/home.html", { tabelas });
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");
        await expect(page.locator("#sidebar [data-alertas-contagem]")).toBeHidden();
    });
});

test.describe("página de alertas", () => {
    test("agrupa por severidade, com totais e ações", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/alertas.html");

        await expect(page.locator("#empresaAtiva")).toHaveText(/Atacadão Ambos/);

        const resumo = page.locator("#alertasResumo");
        await expect(resumo.locator('[data-severidade="urgente"] strong')).toHaveText("2");
        await expect(resumo.locator('[data-severidade="atencao"] strong')).toHaveText("1");
        await expect(resumo.locator('[data-severidade="info"] strong')).toHaveText("2");

        const grupos = page.locator(".alertas-grupo h2");
        await expect(grupos).toHaveText([/Urgentes/, /Atenção/, /Informativos/]);

        const responder = page.locator('.alerta[data-codigo="RESPONDER_PEDIDO"]');
        await expect(responder).toContainText("Responda o pedido #201");
        await expect(responder).toContainText("Mercado Bom Preço pediu 20 un. de Arroz Tipo 1 5kg");
        await expect(responder.locator(".alerta-acao")).toHaveAttribute("href", "home.html?pedido=201");

        const estoque = page.locator('.alerta[data-codigo="SEM_ESTOQUE"]');
        await expect(estoque).toContainText("abaixo do pedido mínimo (10 un.)");
        await expect(estoque.locator(".alerta-acao")).toHaveAttribute("href", "catalogo.html?modo=vender");

        await expect(page.locator('.alerta[data-codigo="MENSAGENS"]').first()).toContainText("1 mensagem não lida");

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("filtros: Compras/Vendas (empresa Ambos) e clique no total", async ({ page }) => {
        await abrir(page, "/pages/app/alertas.html");
        const lista = page.locator("#alertasLista");

        await expect(page.locator("#filtroPapelGrupo")).toBeVisible();

        await page.locator('#filtroPapelAlertas [data-papel="comprador"]').click();
        await expect(lista.locator(".alerta")).toHaveCount(2);
        await expect(lista).toContainText("Pague o pedido #102");
        await expect(lista).not.toContainText("Responda o pedido #201");
        await expect(page.locator('#alertasResumo [data-severidade="urgente"] strong')).toHaveText("0");

        await page.locator('#filtroPapelAlertas [data-papel="todos"]').click();
        await page.locator('#alertasResumo [data-severidade="urgente"]').click();
        await expect(lista.locator(".alerta")).toHaveCount(2);
        await expect(lista.locator(".alertas-grupo h2")).toHaveText([/Urgentes/]);

        // Clicar de novo limpa o filtro
        await page.locator('#alertasResumo [data-severidade="urgente"]').click();
        await expect(lista.locator(".alerta")).toHaveCount(5);
    });

    test("ação do alerta abre o pedido na Home, no modo certo", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/alertas.html");

        await page.locator('.alerta[data-codigo="RESPONDER_PEDIDO"] .alerta-acao').click();

        await expect(page).toHaveURL(/home\.html/);
        await expect(page.locator("#modalPedidoTitulo")).toHaveText("Pedido #201");
        await expect(page.locator('.modo-btn[data-mode="vender"]')).toHaveClass(/active/);
        await expect(page.locator("#formStatusPedido")).toBeVisible(); // pode responder ali

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("alerta de estoque abre o Catálogo em \"Meus Produtos\"", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/alertas.html");

        await page.locator('.alerta[data-codigo="SEM_ESTOQUE"] .alerta-acao').click();

        await expect(page).toHaveURL(/catalogo\.html\?modo=vender/);
        await expect(page.locator('.modo-btn[data-mode="vender"]')).toHaveClass(/active/);
        await expect(page.locator("#produtosTitulo")).toContainText("Meus Produtos");
        await expect(page.locator("#listaProdutos")).toContainText("Feijão Carioca");

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("sem alertas: estado \"Tudo em dia\"", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.alertas = [];

        await abrir(page, "/pages/app/alertas.html", { tabelas });
        await expect(page.locator(".alertas-vazio")).toContainText("Tudo em dia");
    });

    test("falha na API mostra erro e não quebra a página", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/alertas.html", {
            falhas: { alertas: 'relation "public.alertas" does not exist' }
        });

        await expect(page.locator("#alertasLista")).toContainText("Não foi possível carregar os alertas");
        await expect(page.locator("#sidebar [data-alertas-contagem]")).toBeHidden();
        expect(errosDaPagina.filter(e => e.startsWith("pageerror"))).toEqual([]);
    });

    test("texto vindo do banco é escapado (sem injeção de HTML)", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.alertas[0].parceiro_nome = '<img src=x onerror="window.__xss=1">';

        await abrir(page, "/pages/app/alertas.html", { tabelas });
        await expect(page.locator('.alerta[data-codigo="RESPONDER_PEDIDO"]')).toContainText("<img src=x");
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });
});
