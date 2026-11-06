// Página pública (frontend/pages/public/index.html).

import { test, expect } from "@playwright/test";
import { simularSupabase } from "./supabase-falso.mjs";

const INICIO = "pages/public/";

function coletarErros(page) {
    const erros = [];
    page.on("pageerror", erro => erros.push(erro.message));
    page.on("console", msg => { if (msg.type() === "error") erros.push(msg.text()); });
    return erros;
}

test("a pasta pública abre a landing (index.html); landing.html não existe mais", async ({ page, request }) => {
    const erros = coletarErros(page);
    await page.goto(INICIO);

    await expect(page).toHaveTitle(/S\.E\.R\.F\./);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText("Onde empresas");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /B2B/);

    expect((await request.get("/pages/public/landing.html")).status()).toBe(404);
    expect(erros).toEqual([]);
});

test("conteúdo honesto: nada 'ao vivo' inventado; o exemplo é rotulado; simulação é avisada", async ({ page }) => {
    await page.goto(INICIO);

    await expect(page.locator("body")).not.toContainText(/ao vivo/i);
    // Só recursos que existem: a cotação reversa entrou com a migration 024
    await expect(page.locator(".lp-recursos")).toContainText("Cotação reversa");
    await expect(page.locator(".lp-demo figcaption")).toHaveText("Exemplo ilustrativo da tela de pedido");
    await expect(page.locator(".lp-rodape")).toContainText("pagamentos e notas fiscais são simulados");
});

test("'Criar conta' abre o login direto no cadastro; 'Entrar' abre no login", async ({ page }) => {
    await simularSupabase(page, { usuario: null });
    await page.goto(INICIO);

    await page.locator(".lp-acoes-topo").getByText("Criar conta").click();
    await expect(page).toHaveURL(/login-cadastro\.html#cadastro$/);
    await expect(page.locator("#container")).toHaveClass(/right-panel-active/);

    await page.goto(INICIO);
    await page.locator(".lp-acoes-topo").getByText("Entrar").click();
    await expect(page).toHaveURL(/login-cadastro\.html$/);
    await expect(page.locator("#container")).not.toHaveClass(/right-panel-active/);
});

test("celular: menu abre, fecha com Esc e ao escolher um destino; sem rolagem lateral", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(INICIO);

    const botao = page.locator("#lpMenuBotao");
    const menu = page.locator("#lpMenu");

    await expect(menu).toBeHidden();
    await botao.click();
    await expect(menu).toBeVisible();
    await expect(botao).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(botao).toBeFocused();

    await botao.click();
    await menu.getByText("Dúvidas").click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/#duvidas$/);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("dúvidas frequentes abrem e fecham", async ({ page }) => {
    await page.goto(INICIO);
    const pergunta = page.locator(".lp-faq details").filter({ hasText: "Preciso ter CNPJ?" });

    await expect(pergunta.locator("p")).toBeHidden();
    await pergunta.locator("summary").click();
    await expect(pergunta.locator("p")).toBeVisible();
});

test("navegação por âncoras (Como funciona, Para quem é, Recursos, Dúvidas) e recarga com hash exibem todo o conteúdo", async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(INICIO);

    for (const [texto, seletor] of [
        ["Como funciona", "#como-funciona .lp-passo"],
        ["Para quem é", "#para-quem .lp-papel"],
        ["Recursos", "#recursos .lp-recurso"],
        ["Dúvidas", "#duvidas .lp-cabecalho-secao"]
    ]) {
        await page.locator("#lpMenu").getByRole("link", { name: texto }).click();
        await expect.poll(async () => {
            const opacidades = await page.locator(seletor).evaluateAll(els => els.map(el => Number(getComputedStyle(el).opacity)));
            return opacidades.every(o => o > 0.95);
        }).toBe(true);
    }

    // Abrir ou recarregar diretamente com #como-funciona na URL nunca deixa a seção vazia
    await page.goto(`${INICIO}index.html#como-funciona`);
    await expect.poll(async () => {
        const opacidades = await page.locator("#como-funciona .lp-passo").evaluateAll(els => els.map(el => Number(getComputedStyle(el).opacity)));
        return opacidades.every(o => o > 0.95);
    }).toBe(true);

    expect(erros).toEqual([]);
});

test("botão de tema alterna modo claro e escuro na landing trocando cores reais", async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto(INICIO);

    const temaInicial = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    const fundoInicial = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.locator("#btnTema").click();
    const temaAlternado = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(temaAlternado).not.toBe(temaInicial);

    await expect.poll(async () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(fundoInicial);

    await page.locator("#btnTema").click();
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(temaInicial);
    expect(erros).toEqual([]);
});

test("teclado: 'Pular para o conteúdo' é o primeiro foco", async ({ page }) => {
    await page.goto(INICIO);
    await page.keyboard.press("Tab");
    await expect(page.locator(".lp-pular")).toBeFocused();
    await expect(page.locator(".lp-pular")).toBeInViewport();
});

// Pixels laranja (conexões e pontos) desenhados no canvas do mapa
const pixelsLaranjaNoMapa = page => page.evaluate(() => {
    const canvas = document.getElementById("brasil-particles");
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let laranja = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 40 && data[i] > 200 && data[i + 1] > 80 && data[i + 1] < 170 && data[i + 2] < 90) laranja += 1;
    }
    return laranja;
});

for (const [nome, largura] of [["desktop", 1440], ["celular", 390]]) {
    test(`mapa (${nome}): canvas quadrado sobre o mapa e a rede se conectando`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: 900 });

        // Rede real: a imagem do mapa chega depois do script. Antes da correção,
        // o canvas era medido com altura 0 nesse caso e a rede não aparecia.
        await page.route("**/mapa-brasil.svg", async rota => {
            await new Promise(resolver => setTimeout(resolver, 1500));
            await rota.continue();
        });

        await page.goto(INICIO);

        const mapa = page.locator(".lp-mapa");
        await mapa.scrollIntoViewIfNeeded();

        // O canvas cobre exatamente a área do mapa (nunca com altura 0)
        const tamanho = await page.locator("#brasil-particles").evaluate(c => ({
            largura: c.offsetWidth, altura: c.offsetHeight
        }));
        const area = await mapa.boundingBox();
        expect(tamanho.altura).toBeGreaterThan(200);
        expect(tamanho.altura).toBe(tamanho.largura);
        expect(Math.abs(area.height - tamanho.altura)).toBeLessThanOrEqual(1);

        // Começa com poucos pontos e a rede cresce: mais laranja com o tempo
        await page.waitForTimeout(300);
        const inicio = await pixelsLaranjaNoMapa(page);
        await page.waitForTimeout(3500);
        const depois = await pixelsLaranjaNoMapa(page);

        expect(inicio).toBeGreaterThan(0);
        expect(depois).toBeGreaterThan(inicio);
    });
}

test("'reduzir movimento': o mapa mostra a rede COMPLETA, parada (não só o primeiro ponto)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/mapa-brasil.svg", async rota => {
        await new Promise(resolver => setTimeout(resolver, 1500));
        await rota.continue();
    });
    await page.goto(INICIO);
    await page.locator(".lp-mapa").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);

    const parado = await pixelsLaranjaNoMapa(page);
    await page.waitForTimeout(1500);

    expect(parado).toBeGreaterThan(1500);                       // rede inteira, não um ponto
    expect(await pixelsLaranjaNoMapa(page)).toBe(parado);       // e sem animar

    // Preferência desligada com a página aberta: volta a animar do começo
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(300);
    expect(await pixelsLaranjaNoMapa(page)).toBeLessThan(parado);
});

// Conta quantos quadros de animação são pedidos ao navegador em ~1 s
async function quadrosPorSegundo(page) {
    await page.addInitScript(() => {
        window.__quadros = 0;
        const original = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => { window.__quadros += 1; return original(callback); };
    });
    await page.goto(INICIO);
    await page.waitForTimeout(400);
    const antes = await page.evaluate(() => window.__quadros);
    await page.waitForTimeout(1000);
    return (await page.evaluate(() => window.__quadros)) - antes;
}

test("com 'reduzir movimento', as animações param e todo o conteúdo aparece", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await quadrosPorSegundo(page)).toBe(0);

    // Sem esperar a rolagem: os blocos "reveal" não ficam escondidos
    const bloco = page.locator("#recursos .lp-cabecalho-secao");
    expect(await bloco.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
});

test("sem a preferência, a rede de fundo anima normalmente", async ({ page }) => {
    expect(await quadrosPorSegundo(page)).toBeGreaterThan(20);
});
