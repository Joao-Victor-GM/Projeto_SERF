// Radar de Oportunidades (Home) e item "Oportunidades" no menu lateral.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

async function abrirHome(page, { tabelas = criarTabelas(), falhas, caminho = "/pages/app/home.html" } = {}) {
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas, falhas });
    await page.goto(caminho);
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");
    return mock;
}

const radar = page => page.locator("#radar-oportunidades");

test.describe("Radar de Oportunidades", () => {
    test("mostra oportunidades reais, sem repetir o mesmo produto", async ({ page }) => {
        const { errosDaPagina } = await abrirHome(page);

        // 5 linhas na view; o produto 20 (Recompra + Menor preço) conta uma vez
        await expect(radar(page).locator("#ropTotal")).toHaveText("4");
        await expect(radar(page).locator("#ropStatus")).toHaveText("4 oportunidades detectadas para a sua empresa.");

        const chips = radar(page).locator("#ropChips");
        await expect(chips).toContainText("Nova demanda");
        await expect(chips).toContainText("Hora de repor");
        await expect(chips).toContainText("Novo no seu nicho");
        await expect(chips).not.toContainText("Menor preço");

        const feed = radar(page).locator("#ropFeed");
        await expect(feed.locator(".rop-sinal")).toHaveCount(4);
        await expect(feed).toContainText("Mercado Bom Preço quer 20 un. de Arroz Tipo 1 5kg");
        await expect(feed).toContainText("Laticínios Serra");

        // Pontos no radar e notificação flutuante
        await expect(radar(page).locator(".rop-ponto")).toHaveCount(4);
        await expect(radar(page).locator(".rop-cartao").first()).toBeVisible();

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("sinal detectado sobe ao topo da lista, sem duplicar", async ({ page }) => {
        await abrirHome(page);
        const feed = radar(page).locator("#ropFeed .rop-sinal");

        for (let i = 0; i < 6; i++) {
            const tipo = await page.evaluate(() => window.SERFRadarOportunidades.pingar().tipo);
            await expect(feed.first()).toHaveAttribute("data-tipo", tipo);
        }

        await expect(feed).toHaveCount(4);                                // 4 oportunidades, 4 itens
        expect(await radar(page).locator(".rop-cartao:not(.saindo)").count()).toBeLessThanOrEqual(2); // no máximo 2
    });

    test("notificações flutuantes nunca saem da área do radar", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await abrirHome(page);

        const area = await radar(page).locator("#ropCartoes").boundingBox();

        for (let i = 0; i < 8; i++) {
            await page.evaluate(() => window.SERFRadarOportunidades.pingar());
            await page.waitForTimeout(500); // fim da animação de entrada

            const visiveis = await radar(page).locator(".rop-cartao:not(.saindo)").all();
            const caixas = [];

            for (const cartao of visiveis) {
                const caixa = await cartao.boundingBox();
                caixas.push(caixa);
                expect(caixa.x).toBeGreaterThanOrEqual(area.x - 1);
                expect(caixa.y).toBeGreaterThanOrEqual(area.y - 1);
                expect(caixa.x + caixa.width).toBeLessThanOrEqual(area.x + area.width + 1);
                expect(caixa.y + caixa.height).toBeLessThanOrEqual(area.y + area.height + 1);
            }

            // ... e não se sobrepõem
            if (caixas.length === 2) {
                const [a, b] = caixas;
                const colidem = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
                expect(colidem).toBe(false);
            }
        }
    });

    test("lista lateral limitada a 5 itens", async ({ page }) => {
        const tabelas = criarTabelas();
        const base = tabelas.oportunidades.find(o => o.tipo === "NOVO_PRODUTO");
        tabelas.oportunidades.push(...[1, 2, 3, 4].map(n => ({ ...base, id_produto: 900 + n, produto_nome: `Produto ${n}` })));

        await abrirHome(page, { tabelas });
        await expect(radar(page).locator("#ropTotal")).toHaveText("8");
        await expect(radar(page).locator("#ropFeed .rop-sinal")).toHaveCount(5);
    });

    test("produto abre a negociação do catálogo direto do radar", async ({ page }) => {
        const { errosDaPagina } = await abrirHome(page);

        await radar(page).locator('#ropFeed .rop-sinal[data-tipo="NOVO_PRODUTO"]').click();

        const modal = page.locator("#modalNegociacao");
        await expect(modal).toBeVisible();
        await expect(modal).toContainText("Café Torrado 500g");

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("nova demanda abre o pedido no modo Vender", async ({ page }) => {
        await abrirHome(page);

        await radar(page).locator('#ropFeed .rop-sinal[data-tipo="NOVA_DEMANDA"]').click();

        await expect(page.locator("#modalPedidoTitulo")).toHaveText("Pedido #201");
        await expect(page.locator('.modo-btn[data-mode="vender"]')).toHaveClass(/active/);
    });

    test("fornecedor do nicho leva ao diretório de empresas", async ({ page }) => {
        await abrirHome(page);
        await radar(page).locator('#ropFeed .rop-sinal[data-tipo="FORNECEDOR_NICHO"]').click();
        await expect(page).toHaveURL(/empresas\.html/);
    });

    test("botão Pausar interrompe e retoma o ciclo", async ({ page }) => {
        await abrirHome(page);
        const botao = radar(page).locator("#ropPausar");
        const emMovimento = () => page.evaluate(() => window.SERFRadarOportunidades.emMovimento());

        expect(await emMovimento()).toBe(true);

        await botao.click();
        await expect(botao).toHaveAttribute("aria-pressed", "true");
        await expect(botao).toHaveText("▶ Retomar");
        await expect(radar(page)).toHaveClass(/pausado/);
        expect(await emMovimento()).toBe(false);

        await botao.click();
        await expect(botao).toHaveAttribute("aria-pressed", "false");
        expect(await emMovimento()).toBe(true); // o foco no botão não trava o radar
    });

    test("com \"reduzir movimento\" no sistema, começa parado e sem cartões flutuantes", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await abrirHome(page);

        await expect(radar(page).locator("#ropPausar")).toHaveText("▶ Retomar");
        await expect(radar(page).locator("#ropFeed .rop-sinal")).toHaveCount(4); // conteúdo continua acessível
        await expect(radar(page).locator(".rop-cartao")).toHaveCount(0);
    });

    test("sem oportunidades: segue escaneando, sem notificações inventadas", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.oportunidades = [];

        await abrirHome(page, { tabelas });

        await expect(radar(page).locator("#ropStatus")).toHaveText("Nenhuma oportunidade agora. O radar continua escaneando.");
        await expect(radar(page).locator(".rop-cartao, .rop-ponto, .rop-sinal")).toHaveCount(0);
    });

    test("falha na API não derruba a Home", async ({ page }) => {
        const { errosDaPagina } = await abrirHome(page, { falhas: { oportunidades: "relation does not exist" } });

        await expect(radar(page).locator("#ropStatus")).toHaveText("Radar indisponível no momento.");
        await expect(page.locator("#pedidosTableBody")).toContainText("#101");
        expect(errosDaPagina.filter(e => e.startsWith("pageerror"))).toEqual([]);
    });

    test("texto do banco é exibido como texto (sem injeção de HTML)", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.oportunidades[0].parceiro_nome = '<img src=x onerror="window.__xss=1">';

        await abrirHome(page, { tabelas });
        await expect(radar(page).locator("#ropFeed")).toContainText("<img src=x");
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });
});

test.describe("menu lateral", () => {
    for (const pagina of ["home", "catalogo", "empresas", "relatorios", "perfil", "alertas"]) {
        test(`${pagina}: "Oportunidades" logo abaixo de "Alertas"`, async ({ page }) => {
            await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
            await page.goto(`/pages/app/${pagina}.html`);

            const itens = page.locator("#sidebar .sidebar-nav .nav-item");
            const paginas = await itens.evaluateAll(links => links.map(a => a.dataset.page));
            expect(paginas.indexOf("oportunidades")).toBe(paginas.indexOf("alertas") + 1);

            const destino = pagina === "home" ? "#radar-oportunidades" : "home.html#radar-oportunidades";
            await expect(page.locator('#sidebar a[data-page="oportunidades"]')).toHaveAttribute("href", destino);
        });
    }

    test("de outra página, o item leva à Home já no radar", async ({ page }) => {
        await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
        await page.goto("/pages/app/relatorios.html");

        await page.locator('#sidebar a[data-page="oportunidades"]').click();

        await expect(page).toHaveURL(/home\.html#radar-oportunidades/);
        await expect(page.locator("#radar-oportunidades")).toBeInViewport();
    });
});

test.describe("Radar: filtro por segmento", () => {
    const METAIS = "Metalurgia & Usinagem";
    const ALIMENTOS = "Alimentos & Bebidas";

    // Uma oportunidade de metais na rede; o resto é de alimentos
    function tabelasComMetais() {
        const tabelas = criarTabelas();
        tabelas.oportunidades.push({
            ...tabelas.oportunidades[1], id_produto: 99, produto_nome: "Chapa de aço 2mm",
            categoria: METAIS, fornecedor_nome: "Metalúrgica Vale", detalhe: null
        });
        return tabelas;
    }

    // RPC definir_segmentos simulada: grava na tabela como o banco faria
    const rpc = {
        definir_segmentos: ({ p_categorias }, tabelas) => {
            tabelas.segmentos_interesse = p_categorias.map(categoria => ({ categoria }));
            return p_categorias;
        }
    };

    async function abrir(page, tabelas = tabelasComMetais()) {
        const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas, rpc });
        await page.goto("/pages/app/home.html");
        await expect(radar(page).locator("#ropSegmentos")).toBeVisible();
        return mock;
    }

    test("escolher 'só metais' filtra no servidor e salva a escolha", async ({ page }) => {
        const { chamadas, errosDaPagina } = await abrir(page);
        await expect(radar(page).locator("#ropTotal")).toHaveText("5");

        const botao = radar(page).locator("#ropSegmentos");
        await botao.click();
        await expect(botao).toHaveAttribute("aria-expanded", "true");

        const painel = radar(page).locator("#ropPainelSegmentos");
        await expect(painel.getByRole("checkbox")).toHaveCount(7);   // a lista oficial
        await painel.getByLabel(METAIS).check();
        await painel.getByRole("button", { name: "Aplicar" }).click();

        await expect(painel).toBeHidden();
        await expect(botao).toHaveText("◎ Segmentos (1)");
        await expect(botao).toBeFocused();
        await expect(radar(page).locator("#ropTotal")).toHaveText("1");
        await expect(radar(page).locator("#ropStatus")).toHaveText(`1 oportunidade detectada em ${METAIS}.`);
        await expect(radar(page).locator("#ropFeed")).toContainText("Chapa de aço 2mm");
        await expect(radar(page).locator("#ropFeed")).not.toContainText("Arroz");

        // Salvo no banco e filtrado na consulta (não no navegador)
        expect(chamadas.find(c => c.nome === "definir_segmentos").corpo).toEqual({ p_categorias: [METAIS] });
        const consulta = chamadas.filter(c => c.tabela === "oportunidades").at(-1);
        expect(consulta.parametros).toContainEqual(["categoria", `in.(${METAIS})`]);

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("a escolha salva vale na próxima visita; 'Ver todos' limpa", async ({ page }) => {
        const tabelas = tabelasComMetais();
        tabelas.segmentos_interesse = [{ categoria: ALIMENTOS }];
        await abrir(page, tabelas);

        const botao = radar(page).locator("#ropSegmentos");
        await expect(botao).toHaveText("◎ Segmentos (1)");
        await expect(radar(page).locator("#ropStatus")).toContainText(`em ${ALIMENTOS}`);
        await expect(radar(page).locator("#ropFeed")).not.toContainText("Chapa de aço");

        await botao.click();
        await expect(radar(page).getByLabel(ALIMENTOS)).toBeChecked();
        await radar(page).getByRole("button", { name: "Ver todos" }).click();

        await expect(botao).toHaveText("◎ Segmentos");
        await expect(radar(page).locator("#ropTotal")).toHaveText("5");
        await expect(radar(page).locator("#ropStatus")).toHaveText("5 oportunidades detectadas para a sua empresa.");
    });

    test("segmento sem oportunidades: radar vazio explica e avisa do e-mail", async ({ page }) => {
        await abrir(page);
        await radar(page).locator("#ropSegmentos").click();
        await radar(page).getByLabel("Construção Civil").check();
        await radar(page).getByRole("button", { name: "Aplicar" }).click();

        await expect(radar(page).locator("#ropTotal")).toHaveText("0");
        await expect(radar(page).locator("#ropStatus"))
            .toHaveText("Nenhuma oportunidade em Construção Civil agora. Você recebe um e-mail quando surgir um produto novo.");
    });

    test("teclado: Esc fecha o painel e devolve o foco; erro ao salvar aparece no painel", async ({ page }) => {
        await simularSupabase(page, {
            usuario: EMPRESA, tabelas: tabelasComMetais(),
            rpc: { definir_segmentos: () => { throw Object.assign(new Error("Escolha no máximo 20 segmentos."), { code: "P0001" }); } }
        });
        await page.goto("/pages/app/home.html");

        const botao = radar(page).locator("#ropSegmentos");
        await botao.click();
        await expect(radar(page).getByLabel(METAIS)).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(radar(page).locator("#ropPainelSegmentos")).toBeHidden();
        await expect(botao).toBeFocused();

        await botao.click();
        await radar(page).getByLabel(METAIS).check();
        await radar(page).getByRole("button", { name: "Aplicar" }).click();
        await expect(radar(page).locator("#ropErroSegmentos")).toHaveText("Escolha no máximo 20 segmentos.");
        await expect(radar(page).locator("#ropPainelSegmentos")).toBeVisible();
        await expect(radar(page).locator("#ropTotal")).toHaveText("5");    // nada mudou
    });

    test("sem a migration 021, o botão some e o radar mostra tudo", async ({ page }) => {
        const tabelas = tabelasComMetais();
        await simularSupabase(page, { usuario: EMPRESA, tabelas, falhas: { segmentos_interesse: "relation does not exist" } });
        await page.goto("/pages/app/home.html");

        await expect(radar(page).locator("#ropTotal")).toHaveText("5");
        await expect(radar(page).locator("#ropSegmentos")).toBeHidden();
    });
});
