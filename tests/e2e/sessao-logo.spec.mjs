// "Manter conectado", saída por inatividade (supabase-client.js +
// auth-check.js) e logo da empresa (perfil.js, empresas.js, migration 031).

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const CHAVE_SESSAO = "sb-rparlqdgcwzoanpqqeof-auth-token";
const LOGIN = { email: "contato@ambos.com.br", senha: "senha-forte-123", usuario: EMPRESA };
const PNG = fs.readFileSync(path.resolve("frontend/assets/icons/fivecon.png"));

async function entrar(page, { manterConectado }) {
    await simularSupabase(page, { usuario: null, tabelas: criarTabelas(), login: LOGIN });
    await page.goto("/pages/public/login-cadastro.html");
    await page.locator("#emailLogin").fill(LOGIN.email);
    await page.locator("#senhaLogin").fill(LOGIN.senha);
    if (manterConectado) await page.locator("#manterConectado").check();
    await page.locator("#formLogin button[type=submit]").click();
    await page.waitForURL(/pages\/app\//);
}

const ondeEstaASessao = page => page.evaluate(chave => ({
    local: localStorage.getItem(chave) !== null,
    aba: sessionStorage.getItem(chave) !== null
}), CHAVE_SESSAO);

test.describe("sessão", () => {
    test("sem 'Manter conectado' a sessão fica só nesta aba (some ao fechar o navegador)", async ({ page }) => {
        await entrar(page, { manterConectado: false });
        expect(await ondeEstaASessao(page)).toEqual({ local: false, aba: true });
    });

    test("com 'Manter conectado' a sessão sobrevive a fechar o navegador", async ({ page }) => {
        await entrar(page, { manterConectado: true });
        expect(await ondeEstaASessao(page)).toEqual({ local: true, aba: false });
    });

    test("parado além do limite: sai antes de mostrar dados e explica no login", async ({ page }) => {
        await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
        // Última atividade há 31 min (só na primeira carga)
        await page.addInitScript(() => {
            if (sessionStorage.getItem("teste-preparado")) return;
            sessionStorage.setItem("teste-preparado", "1");
            localStorage.setItem("serf-ultima-atividade", String(Date.now() - 31 * 60 * 1000));
        });

        await page.goto("/pages/app/home.html");
        await page.waitForURL(/login-cadastro\.html/);
        await expect(page.locator(".swal2-popup")).toContainText("Sessão encerrada");
        expect(page.url()).not.toContain("motivo=");   // recarregar não repete o aviso
    });

    test("2 minutos antes do limite pergunta se ainda está aí; continuar mantém a sessão", async ({ page }) => {
        await page.clock.install();
        await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
        await page.goto("/pages/app/relatorios.html");
        await expect(page.locator("#sidebar")).toBeVisible();

        // 29 min sem uso: no próximo ciclo (15 s) aparece o aviso
        await page.evaluate(() => localStorage.setItem("serf-ultima-atividade", String(Date.now() - 29 * 60 * 1000)));
        await page.clock.fastForward(16000);
        const aviso = page.getByRole("alertdialog", { name: "Você ainda está aí?" });
        await expect(aviso).toBeVisible();
        await expect(aviso.getByRole("button", { name: "Continuar conectado" })).toBeFocused();

        await aviso.getByRole("button", { name: "Continuar conectado" }).click();
        await expect(aviso).toHaveCount(0);
        const parado = await page.evaluate(() => Date.now() - Number(localStorage.getItem("serf-ultima-atividade")));
        expect(parado).toBeLessThan(5000);
        expect(page.url()).toContain("relatorios.html");
    });

    test("o aviso de inatividade não fecha um diálogo que estava aberto", async ({ page }) => {
        await page.clock.install();
        await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
        await page.goto("/pages/app/catalogo.html?modo=vender");
        await page.locator('.produto-card[data-id="11"] .btn-editar-produto').click();
        await expect(page.locator(".swal2-popup")).toContainText("Editar produto");

        await page.evaluate(() => localStorage.setItem("serf-ultima-atividade", String(Date.now() - 29 * 60 * 1000)));
        await page.clock.fastForward(16000);

        await expect(page.locator(".serf-aviso-inatividade")).toBeVisible();
        await expect(page.locator(".swal2-popup")).toContainText("Editar produto");   // o formulário continua lá
    });
});

test("logo do topo: consulta uma vez por aba, não a cada página", async ({ page }) => {
    const { chamadas } = await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    const consultasDeLogo = () => chamadas.filter(c => c.tipo === "rest" && c.metodo === "GET"
        && c.parametros.some(([k, v]) => k === "select" && v === "logo_url")).length;

    await page.goto("/pages/app/relatorios.html");
    await expect.poll(consultasDeLogo).toBe(2);   // usuarios + fornecedores
    await page.goto("/pages/app/alertas.html");
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(consultasDeLogo()).toBe(2);
});

test("Home avisa na tela quando o painel bate no limite de 1.000 pedidos", async ({ page }) => {
    const tabelas = criarTabelas();
    const base = tabelas.pedidos_painel[0];
    tabelas.pedidos_painel = Array.from({ length: 1000 }, (_, i) => ({ ...base, id_pedido: 5000 + i }));
    await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/home.html");

    await expect(page.locator("#avisoLimitePedidos")).toBeVisible();
    await expect(page.locator('#avisoLimitePedidos a[href="relatorios.html"]')).toBeVisible();
});

test("Home com poucos pedidos não mostra o aviso de limite", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#pedidosTableBody tr").first()).toBeVisible();
    await expect(page.locator("#avisoLimitePedidos")).toBeHidden();
});

test.describe("logo da empresa", () => {
    const URL_LOGO = `https://rparlqdgcwzoanpqqeof.supabase.co/storage/v1/object/public/logos/${EMPRESA.id}/logo?v=1`;

    // Storage simulado: aceita o envio e serve a imagem
    async function simularStorage(page, enviados = []) {
        await page.route(/supabase\.co\/storage\/v1\//, rota => {
            const requisicao = rota.request();
            if (requisicao.method() === "GET") return rota.fulfill({ status: 200, contentType: "image/png", body: PNG });
            enviados.push({ metodo: requisicao.method(), url: requisicao.url(), tipo: requisicao.headers()["content-type"] });
            return rota.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
                body: JSON.stringify({ Key: `logos/${EMPRESA.id}/logo` }) });
        });
        return enviados;
    }

    test("enviar logo: vai para a pasta da empresa, grava o endereço e aparece no perfil", async ({ page }) => {
        const tabelas = criarTabelas();
        const { chamadas, errosDaPagina } = await simularSupabase(page, { usuario: EMPRESA, tabelas });
        const enviados = await simularStorage(page);
        await page.goto("/pages/app/perfil.html");

        await expect(page.locator("#btnAlterarLogo")).toBeVisible();
        await expect(page.locator("#btnRemoverLogo")).toBeHidden();
        await page.locator("#inputLogo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });

        await expect(page.locator(".swal2-popup")).toContainText("Logo atualizado");
        expect(enviados.at(-1).url).toContain(`/storage/v1/object/logos/${EMPRESA.id}/logo`);

        const gravados = chamadas.filter(c => c.tipo === "rest" && c.metodo === "PATCH").map(c => [c.tabela, c.corpo.logo_url]);
        expect(gravados.map(([tabela]) => tabela).sort()).toEqual(["fornecedores", "usuarios"]);
        for (const [, url] of gravados) expect(url).toMatch(new RegExp(`/storage/v1/object/public/logos/${EMPRESA.id}/logo\\?v=\\d+$`));

        await expect(page.locator("#heroAvatar img")).toHaveAttribute("src", /logos\/.*\/logo\?v=/);
        await expect(page.locator("#btnRemoverLogo")).toBeVisible();
        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("arquivo que não é imagem aceita é recusado antes de enviar", async ({ page }) => {
        await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
        const enviados = await simularStorage(page);
        await page.goto("/pages/app/perfil.html");

        await page.locator("#inputLogo").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
        await expect(page.locator(".swal2-popup")).toContainText("Formato não aceito");
        expect(enviados).toEqual([]);
    });

    test("Empresas mostra o logo do fornecedor", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.fornecedores_vitrine[1].logo_url = URL_LOGO;
        await simularSupabase(page, { usuario: EMPRESA, tabelas });
        await simularStorage(page);
        await page.goto("/pages/app/empresas.html");

        const logo = page.locator("#gradeFornecedores .emp-avatar.com-logo img");
        await expect(logo).toHaveCount(1);
        await expect(logo).toHaveAttribute("src", URL_LOGO);
        await expect.poll(() => logo.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    });

    test("Empresas: se a imagem do logo falhar, volta a inicial", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.fornecedores_vitrine[1].logo_url = URL_LOGO;
        await simularSupabase(page, { usuario: EMPRESA, tabelas });
        // Imagem removida do Storage
        await page.route(/supabase\.co\/storage\/v1\//, rota => rota.fulfill({ status: 404, body: "" }));
        await page.goto("/pages/app/empresas.html");

        await expect(page.locator("#gradeFornecedores .emp-avatar").filter({ hasText: "D" })).toHaveCount(1);
        await expect(page.locator("#gradeFornecedores .emp-avatar.com-logo")).toHaveCount(0);
    });
});
