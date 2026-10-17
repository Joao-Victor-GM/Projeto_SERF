// Menu lateral único (js/ui/layout.js): os destinos de cada item, em cada
// página, são os mesmos dos 6 menus escritos à mão que ele substituiu.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const DE_FORA = ["home.html#visao-geral", "empresas.html", "catalogo.html", "home.html#pedidos",
    "home.html#mensagens", "relatorios.html", "alertas.html", "home.html#radar-oportunidades"];

const ESPERADO = {
    home: {
        hrefs: ["#visao-geral", "empresas.html", "#produtos", "#pedidos", "#mensagens", "relatorios.html", "alertas.html", "#radar-oportunidades"],
        ativo: "home", rotuloProdutos: "Produtos", contadorMensagens: true
    },
    catalogo: {
        hrefs: ["home.html#visao-geral", "empresas.html", "#produtos", "home.html#pedidos", "home.html#mensagens", "relatorios.html", "alertas.html", "home.html#radar-oportunidades"],
        ativo: "produtos", rotuloProdutos: "Catálogo", contadorMensagens: true
    },
    empresas: { hrefs: DE_FORA, ativo: "empresas", rotuloProdutos: "Catálogo", contadorMensagens: false },
    relatorios: { hrefs: DE_FORA, ativo: "relatorios", rotuloProdutos: "Catálogo", contadorMensagens: false },
    perfil: { hrefs: DE_FORA, ativo: null, rotuloProdutos: "Catálogo", contadorMensagens: false },
    alertas: { hrefs: DE_FORA, ativo: "alertas", rotuloProdutos: "Catálogo", contadorMensagens: false }
};

for (const [pagina, esperado] of Object.entries(ESPERADO)) {
    test(`${pagina}: menu igual ao original, item ativo e botão ☰`, async ({ page }) => {
        const { errosDaPagina } = await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
        await page.setViewportSize({ width: 390, height: 800 }); // celular: menu recolhido
        await page.goto(`/pages/app/${pagina}.html`);

        const itens = page.locator("#sidebar .sidebar-nav .nav-item");
        expect(await itens.evaluateAll(links => links.map(a => a.getAttribute("href")))).toEqual(esperado.hrefs);
        expect(await itens.evaluateAll(links => links.map(a => a.dataset.page)))
            .toEqual(["home", "empresas", "produtos", "pedidos", "mensagens", "relatorios", "alertas", "oportunidades"]);

        const ativos = page.locator("#sidebar .nav-item.active");
        if (esperado.ativo) {
            await expect(ativos).toHaveCount(1);
            await expect(ativos).toHaveAttribute("data-page", esperado.ativo);
            await expect(ativos).toHaveAttribute("aria-current", "page");
        } else {
            await expect(ativos).toHaveCount(0);
        }

        await expect(page.locator('#sidebar [data-page="produtos"] span:not(.nav-icon)')).toHaveText(esperado.rotuloProdutos);
        await expect(page.locator("#mensagensCount")).toHaveCount(esperado.contadorMensagens ? 1 : 0);

        // ☰ abre e informa o estado para leitores de tela. No celular o menu
        // aberto cobre o ☰: fecha com toque fora dele ou Esc.
        const botao = page.locator("#menuToggle");
        const sidebar = page.locator("#sidebar");

        await botao.click();
        await expect(sidebar).toHaveClass(/open/);
        await expect(botao).toHaveAttribute("aria-expanded", "true");

        await page.mouse.click(380, 400);                       // fora do menu
        await expect(sidebar).not.toHaveClass(/open/);
        await expect(botao).toHaveAttribute("aria-expanded", "false");

        await botao.click();
        await expect(sidebar).toHaveClass(/open/);
        await page.keyboard.press("Escape");
        await expect(sidebar).not.toHaveClass(/open/);
        await expect(botao).toBeFocused();

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });
}

test("Home: o menu do modo Vender continua trocando o rótulo de Produtos", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

    await page.locator('.modo-btn[data-mode="vender"]').click();
    await expect(page.locator("#menuProdutosLabel")).toHaveText("Meus produtos");
});
