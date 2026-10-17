// Comportamentos introduzidos pelas otimizações da Home: tabela paginada,
// busca com debounce, radar de pedidos limitado e chat incremental.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const DIA = 86400000;

// 250 compras recentes, todas em aberto e paradas há 5 dias
function muitosPedidos() {
    const tabelas = criarTabelas();
    const modelo = tabelas.pedidos_painel.find(p => p.id_pedido === 102);
    const data = new Date(Date.now() - 5 * DIA).toISOString();

    tabelas.pedidos_painel = Array.from({ length: 250 }, (_, i) => ({
        ...modelo,
        id_pedido: 5000 + i,
        status_pedido: "CONFIRMADO",
        nome_produto: i === 7 ? "Farinha Especial" : `Produto ${i}`,
        data_pedido: data,
        data_atualizacao: data
    }));
    return tabelas;
}

test("tabela mostra 100 linhas por vez, com 'Mostrar mais'", async ({ page }) => {
    const { errosDaPagina } = await (async () => {
        const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas: muitosPedidos() });
        await page.goto("/pages/app/home.html");
        return mock;
    })();

    const linhas = page.locator("#pedidosTableBody tr");
    const botao = page.locator("#btnMaisPedidos");

    await expect(page.locator("#totalPedidos")).toHaveText("250 pedidos");   // total real
    await expect(linhas).toHaveCount(100);
    await expect(botao).toHaveText("Mostrar mais 100 de 150 restantes");

    await botao.click();
    await expect(linhas).toHaveCount(200);
    await expect(botao).toHaveText("Mostrar mais 50 de 50 restantes");

    await botao.click();
    await expect(linhas).toHaveCount(250);
    await expect(botao).toBeHidden();

    // Mudar um filtro volta para a primeira página
    await page.locator("#filtroPeriodo").selectOption("90");
    await expect(linhas).toHaveCount(100);

    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("busca filtra tabela e KPIs (com debounce)", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: muitosPedidos() });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("250 pedidos");

    await page.locator("#buscaGlobal").pressSequentially("farinha", { delay: 20 });

    await expect(page.locator("#totalPedidos")).toHaveText("1 pedido");
    await expect(page.locator("#pedidosTableBody")).toContainText("#5007");
    await expect(page.locator("#btnMaisPedidos")).toBeHidden();
    await expect(page.locator("#kpiAbertos")).toHaveText("0");          // CONFIRMADO = em negociação

    await page.locator("#buscaGlobal").fill("");
    await expect(page.locator("#totalPedidos")).toHaveText("250 pedidos");
});

test("busca não redesenha gráfico, radar nem conversas", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

    // Marca os blocos; se forem recriados, a marca some
    await page.evaluate(() => {
        for (const id of ["graficoProducao", "radarLista", "conversasRecentes"]) {
            document.getElementById(id).firstElementChild.dataset.marca = "original";
        }
    });

    await page.locator("#buscaGlobal").fill("café");
    await expect(page.locator("#totalPedidos")).toHaveText("1 pedido");

    for (const id of ["graficoProducao", "radarLista", "conversasRecentes"]) {
        await expect(page.locator(`#${id} > [data-marca="original"]`)).toHaveCount(1);
    }
});

test("radar de pedidos mostra 8 pendências e leva às demais", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: muitosPedidos() });
    await page.goto("/pages/app/home.html");

    const radar = page.locator("#radarLista");
    await expect(radar.locator(".radar-alert")).toHaveCount(8);
    await expect(radar).toContainText("+ 242 pedidos com pendência.");
    await expect(radar.locator('a[href="alertas.html"]')).toBeVisible();
});

test("chat: mensagens novas são anexadas; fora de ordem, a conversa é reordenada", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/home.html");
    await page.locator('#pedidosTableBody [data-pedido="101"]').click();

    const baloes = page.locator("#chatMensagens .chat-balao p");
    await expect(baloes).toHaveText(["Recebemos seu pedido!", "Obrigado, aguardo a confirmação."]);

    // Marca o 1º balão: anexar não pode recriá-lo
    await page.evaluate(() => { document.querySelector("#chatMensagens .chat-balao").dataset.marca = "1"; });

    await page.evaluate(() => adicionarMensagens([
        { id: "n1", id_pedido: 101, id_remetente: "x", texto: "Nova A", lida: false, data_envio: new Date(Date.now() + 1000).toISOString() },
        { id: "n2", id_pedido: 101, id_remetente: "x", texto: "Nova B", lida: false, data_envio: new Date(Date.now() + 2000).toISOString() }
    ]));

    await expect(baloes).toHaveText(["Recebemos seu pedido!", "Obrigado, aguardo a confirmação.", "Nova A", "Nova B"]);
    await expect(page.locator('#chatMensagens .chat-balao[data-marca="1"]')).toHaveCount(1);

    // Repetida: ignorada
    await page.evaluate(() => adicionarMensagens([{ id: "n1", id_pedido: 101, id_remetente: "x", texto: "Nova A", lida: false, data_envio: new Date().toISOString() }]));
    await expect(baloes).toHaveCount(4);

    // Atrasada (mais antiga que a última): entra na posição certa
    await page.evaluate(() => adicionarMensagens([
        { id: "velha", id_pedido: 101, id_remetente: "x", texto: "Atrasada", lida: false, data_envio: new Date(Date.now() - 30 * 86400000).toISOString() }
    ]));
    await expect(baloes.first()).toHaveText("Atrasada");
    await expect(baloes).toHaveCount(5);
});
