// Testes de interface: cada página interna abre com o Supabase simulado,
// mostra os dados do cenário e não gera erros de JavaScript.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

async function abrir(page, caminho, opcoes = {}) {
    const tabelas = criarTabelas();
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas, ...opcoes });
    await page.goto(caminho);
    return { ...mock, tabelas };
}

test.describe("proteção de páginas", () => {
    test("sem sessão, a Home redireciona para o login", async ({ page }) => {
        await simularSupabase(page, { usuario: null });
        await page.goto("/pages/app/home.html");
        await expect(page).toHaveURL(/login-cadastro\.html/);
    });
});

test.describe("Home", () => {
    test("modo Comprar lista as compras dos últimos 30 dias", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/home.html");

        await expect(page.locator("#empresaAtiva")).toHaveText(/Atacadão Ambos/);
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

        const tabela = page.locator("#pedidosTableBody");
        await expect(tabela).toContainText("#101");
        await expect(tabela).toContainText("#103");
        await expect(tabela).not.toContainText("#104"); // 40 dias atrás
        await expect(tabela).not.toContainText("#201"); // é uma venda

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("modo Vender lista as vendas; período de 90 dias inclui pedidos mais antigos", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/home.html");
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

        await page.locator('.modo-btn[data-mode="vender"]').click();

        const tabela = page.locator("#pedidosTableBody");
        await expect(tabela).toContainText("#201");
        await expect(tabela).toContainText("#203");
        await expect(tabela).not.toContainText("#101");
        await expect(tabela).not.toContainText("#204"); // 200 dias atrás

        await page.locator('.modo-btn[data-mode="comprar"]').click();
        await page.locator("#filtroPeriodo").selectOption("90");
        await expect(tabela).toContainText("#104");
        await expect(page.locator("#totalPedidos")).toHaveText("4 pedidos");

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("abrir um pedido mostra o resumo e o histórico do chat", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/home.html");

        await page.locator('#pedidosTableBody [data-pedido="101"]').click();

        await expect(page.locator("#modalPedido")).toBeVisible();
        await expect(page.locator("#modalPedidoTitulo")).toHaveText("Pedido #101");
        await expect(page.locator("#chatMensagens")).toContainText("Recebemos seu pedido!");
        await expect(page.locator("#chatMensagens")).toContainText("aguardo a confirmação");
        await expect(page.locator("#pedidoResumo")).toContainText("Açúcar Cristal");

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("conversas recentes mostram as mensagens do modo", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/home.html");
        await expect(page.locator("#conversasRecentes")).toContainText("Distribuidora Sul");
        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("o recorte do painel é feito no servidor (90 dias + pedidos em aberto)", async ({ page }) => {
        const { chamadas, errosDaPagina } = await abrir(page, "/pages/app/home.html");
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

        const consulta = chamadas.find(c => c.tabela === "pedidos_painel" && c.metodo === "GET");
        const filtro = Object.fromEntries(consulta.parametros).or;

        expect(filtro).toMatch(/data_atualizacao\.gte\./);
        expect(filtro).toMatch(/status_pedido\.in\.\(PENDENTE,CONFIRMADO,EM_SEPARACAO,ENVIADO\)/);
        expect(chamadas.some(c => c.tabela === "pedidos")).toBe(false); // nada do SELECT antigo

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("pedido fora do recorte, aberto pela URL, é buscado sob demanda", async ({ page }) => {
        const { chamadas, errosDaPagina } = await abrir(page, "/pages/app/home.html?pedido=204");

        await expect(page.locator("#modalPedidoTitulo")).toHaveText("Pedido #204");
        expect(chamadas.some(c => c.tabela === "pedidos_painel" &&
            c.parametros.some(([k, v]) => k === "id_pedido" && v === "eq.204"))).toBe(true);

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("pedido aberto pela URL (?pedido=ID) abre o modal no modo certo", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/home.html?pedido=202");
        await expect(page.locator("#modalPedidoTitulo")).toHaveText("Pedido #202");
        await expect(page.locator('.modo-btn[data-mode="vender"]')).toHaveClass(/active/);
        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });
});

test.describe("demais páginas", () => {
    test("Catálogo lista produtos dos fornecedores", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/catalogo.html");
        await expect(page.locator("#listaProdutos")).toContainText("Café Torrado");
        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("Relatórios calculam os indicadores", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/relatorios.html");
        await expect(page.locator("#relKpis")).not.toBeEmpty();
        await expect(page.locator("#tabelaProdutos")).toContainText("Arroz Tipo 1");
        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("Perfil mostra o cadastro e o histórico", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/perfil.html");
        await expect(page.locator("#heroRazaoSocial")).toHaveText("Atacadão Ambos LTDA");
        await expect(page.locator("#listaHistoricoCompras")).toContainText("Distribuidora Sul");
        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("Empresas mostra o diretório de fornecedores", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/empresas.html");
        await expect(page.locator("#gradeFornecedores")).toContainText("Distribuidora Sul");
        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("Empresas › Meus parceiros agrupa pedidos por fornecedor e por cliente", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/empresas.html#parceiros");

        const lista = page.locator("#listaParceiros");
        await expect(lista).toContainText("Distribuidora Sul");     // de quem compro
        await expect(lista).not.toContainText("Mercado Bom Preço");

        await page.locator('#perspectivaParceiros [data-perspectiva="clientes"]').click();
        await expect(lista).toContainText("Mercado Bom Preço");     // para quem vendo

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });
});
