// Menu lateral único (js/ui/layout.js): os destinos de cada item, em cada
// página, são os mesmos dos 6 menus escritos à mão que ele substituiu.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const DE_FORA = ["home.html#visao-geral", "empresas.html", "catalogo.html", "home.html#pedidos",
    "home.html#mensagens", "cotacoes.html", "relatorios.html", "alertas.html", "home.html#radar-oportunidades"];

const ESPERADO = {
    home: {
        hrefs: ["#visao-geral", "empresas.html", "catalogo.html", "#pedidos", "#mensagens", "cotacoes.html", "relatorios.html", "alertas.html", "#radar-oportunidades"],
        ativo: "home", rotuloProdutos: "Catálogo", contadorMensagens: true
    },
    catalogo: {
        hrefs: ["home.html#visao-geral", "empresas.html", "#produtos", "home.html#pedidos", "home.html#mensagens", "cotacoes.html", "relatorios.html", "alertas.html", "home.html#radar-oportunidades"],
        ativo: "produtos", rotuloProdutos: "Catálogo", contadorMensagens: true
    },
    empresas: { hrefs: DE_FORA, ativo: "empresas", rotuloProdutos: "Catálogo", contadorMensagens: false },
    relatorios: { hrefs: DE_FORA, ativo: "relatorios", rotuloProdutos: "Catálogo", contadorMensagens: false },
    perfil: { hrefs: DE_FORA, ativo: null, rotuloProdutos: "Catálogo", contadorMensagens: false },
    alertas: { hrefs: DE_FORA, ativo: "alertas", rotuloProdutos: "Catálogo", contadorMensagens: false },
    cotacoes: { hrefs: DE_FORA, ativo: "cotacoes", rotuloProdutos: "Catálogo", contadorMensagens: false }
};

for (const [pagina, esperado] of Object.entries(ESPERADO)) {
    test(`${pagina}: menu único em todas as páginas, item ativo e botão ☰`, async ({ page }) => {
        const { errosDaPagina } = await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
        await page.setViewportSize({ width: 390, height: 800 }); // celular: menu recolhido
        await page.goto(`/pages/app/${pagina}.html`);

        const itens = page.locator("#sidebar .sidebar-nav .nav-item");
        expect(await itens.evaluateAll(links => links.map(a => a.getAttribute("href")))).toEqual(esperado.hrefs);
        expect(await itens.evaluateAll(links => links.map(a => a.dataset.page)))
            .toEqual(["home", "empresas", "produtos", "pedidos", "mensagens", "cotacoes", "relatorios", "alertas", "oportunidades"]);

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

// Decisão de produto (branch auto-complete-home): o item é sempre "Catálogo",
// em qualquer página e modo; só a ação principal muda com o modo.
test("Home: o menu mostra sempre \"Catálogo\"; o modo troca só a ação principal", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

    const rotulo = page.locator('#sidebar [data-page="produtos"] span:not(.nav-icon)');

    await page.locator('.modo-btn[data-mode="vender"]').click();
    await expect(rotulo).toHaveText("Catálogo");
    await expect(page.locator("#btnAcaoPrincipal")).toHaveText("+ Cadastrar produto");

    await page.locator('.modo-btn[data-mode="comprar"]').click();
    await expect(rotulo).toHaveText("Catálogo");
    await expect(page.locator("#btnAcaoPrincipal")).toHaveText("+ Novo pedido");
});
