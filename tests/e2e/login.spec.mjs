// Login e cadastro (login-cadastro.html): celular, desktop, acessibilidade
// e as verificações de segurança da tela.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const PAGINA = "/pages/public/login-cadastro.html";
const CELULAR = { width: 390, height: 844 };

test.describe("celular", () => {
    test.beforeEach(async ({ page }) => page.setViewportSize(CELULAR));

    test("uma coluna com abas; um formulário por vez; nada sai da tela", async ({ page }) => {
        const { errosDaPagina } = await simularSupabase(page, { usuario: null });
        await page.goto(PAGINA);

        const entrar = page.getByRole("tab", { name: "Entrar" });
        const cadastrar = page.getByRole("tab", { name: "Criar conta" });
        await expect(entrar).toHaveAttribute("aria-selected", "true");
        await expect(page.locator("#formLogin")).toBeVisible();
        await expect(page.locator("#formCadastro")).toBeHidden();

        await cadastrar.click();
        await expect(cadastrar).toHaveAttribute("aria-selected", "true");
        await expect(page.locator("#formCadastro")).toBeVisible();
        await expect(page.locator("#formLogin")).toBeHidden();
        await expect(page).toHaveURL(/#cadastro$/);

        // Todos os campos e o botão cabem inteiros na largura
        for (const id of ["cnpjCadastro", "razaoSocialCadastro", "emailCadastro", "senhaCadastro", "confirmarSenhaCadastro"]) {
            const caixa = await page.locator(`#${id}`).boundingBox();
            expect(caixa.width, id).toBeGreaterThan(280);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("campos com 16px (o iPhone não dá zoom) e alvos de toque de 44px+", async ({ page }) => {
        await simularSupabase(page, { usuario: null });
        await page.goto(PAGINA);

        const tamanhos = await page.locator("#formLogin input").evaluateAll(campos =>
            campos.map(c => parseFloat(getComputedStyle(c).fontSize)));
        expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(16);

        for (const alvo of ["#formLogin .btn-solid", "#abaCadastrar", "#formLogin input[type=email]"]) {
            expect((await page.locator(alvo).boundingBox()).height, alvo).toBeGreaterThanOrEqual(44);
        }
    });

    test("tela baixa (360×640) com o cadastro: rola até o botão", async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 640 });
        await simularSupabase(page, { usuario: null });
        await page.goto(`${PAGINA}#cadastro`);

        const botao = page.locator("#formCadastro .btn-solid");
        await botao.scrollIntoViewIfNeeded();
        await expect(botao).toBeInViewport();
    });
});

test("desktop: painel deslizante continua; link da página inicial abre o cadastro", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simularSupabase(page, { usuario: null });
    await page.goto(`${PAGINA}#cadastro`);

    await expect(page.locator("#container")).toHaveClass(/right-panel-active/);
    await expect(page.locator(".auth-abas")).toBeHidden();
    await page.locator("#signIn").click();
    await expect(page.locator("#container")).not.toHaveClass(/right-panel-active/);
    await expect(page.locator("#emailLogin")).toBeFocused();
});

test("acessibilidade: todo campo tem rótulo; o formulário escondido sai da tabulação", async ({ page }) => {
    await page.setViewportSize(CELULAR);
    await simularSupabase(page, { usuario: null });
    await page.goto(PAGINA);

    for (const nome of ["E-mail", "Senha"]) await expect(page.locator("#formLogin").getByLabel(nome, { exact: true })).toBeVisible();
    await expect(page.locator("#painelCadastrar")).toHaveAttribute("inert", "");
    await expect(page.locator("#senhaLogin")).toHaveAttribute("autocomplete", "current-password");
    await expect(page.locator("#senhaCadastro")).toHaveAttribute("autocomplete", "new-password");
});

test("mostrar/ocultar senha", async ({ page }) => {
    await simularSupabase(page, { usuario: null });
    await page.goto(PAGINA);

    const senha = page.locator("#senhaLogin");
    await senha.fill("segredo123");
    await page.locator("#formLogin").getByRole("button", { name: "Mostrar senha" }).click();
    await expect(senha).toHaveAttribute("type", "text");
    await page.locator("#formLogin").getByRole("button", { name: "Ocultar senha" }).click();
    await expect(senha).toHaveAttribute("type", "password");
});

test("recuperar senha: abre com o e-mail já digitado, Esc fecha e devolve o foco", async ({ page }) => {
    await page.setViewportSize(CELULAR);
    await simularSupabase(page, { usuario: null });
    await page.goto(PAGINA);

    await page.locator("#emailLogin").fill("compras@empresa.com.br");
    await page.getByRole("link", { name: "Esqueceu a senha?" }).click();

    const dialogo = page.getByRole("dialog", { name: "Recuperar senha" });
    await expect(dialogo).toBeVisible();
    await expect(page.locator("#emailRecuperar")).toHaveValue("compras@empresa.com.br");
    await expect(page.locator("#emailRecuperar")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialogo).toBeHidden();
    await expect(page.getByRole("link", { name: "Esqueceu a senha?" })).toBeFocused();
});

test("login: credencial errada mostra mensagem genérica; certa entra na Home", async ({ page }) => {
    await simularSupabase(page, {
        usuario: null, tabelas: criarTabelas(),
        login: { email: EMPRESA.email, senha: "SenhaForte123", usuario: EMPRESA }
    });
    await page.goto(PAGINA);

    await page.locator("#emailLogin").fill(EMPRESA.email);
    await page.locator("#senhaLogin").fill("errada");
    await page.locator("#formLogin .btn-solid").click();
    await expect(page.locator(".swal2-popup")).toContainText("E-mail ou senha inválidos.");   // não diz qual dos dois
    await page.locator(".swal2-confirm").click();

    await page.locator("#senhaLogin").fill("SenhaForte123");
    await page.locator("#formLogin .btn-solid").click();
    await expect(page).toHaveURL(/pages\/app\/home\.html/, { timeout: 10000 });
});

test("cadastro: senha curta é recusada antes de ir ao servidor", async ({ page }) => {
    const { chamadas } = await simularSupabase(page, { usuario: null });
    await page.route("https://brasilapi.com.br/**", rota => rota.fulfill({
        contentType: "application/json", body: JSON.stringify({ razao_social: "EMPRESA TESTE LTDA" })
    }));
    await page.goto(`${PAGINA}#cadastro`);

    await page.locator("#cnpjCadastro").fill("12345678000190");
    await page.locator("#emailCadastro").click();
    await expect(page.locator("#razaoSocialCadastro")).toHaveValue("EMPRESA TESTE LTDA");
    await page.locator("#emailCadastro").fill("compras@empresa.com.br");
    await page.locator("#senhaCadastro").fill("1234567");
    await page.locator("#confirmarSenhaCadastro").fill("1234567");
    await page.locator("#formCadastro .btn-solid").click();

    await expect(page.locator(".swal2-popup")).toContainText("8 ou mais caracteres");
    expect(chamadas.some(c => c.caminho?.endsWith("/signup"))).toBe(false);
});

test("cadastro: o e-mail digitado aparece como TEXTO na confirmação (sem injeção de HTML)", async ({ page }) => {
    await simularSupabase(page, { usuario: null });
    await page.route("https://brasilapi.com.br/**", rota => rota.fulfill({
        contentType: "application/json", body: JSON.stringify({ razao_social: "EMPRESA TESTE LTDA" })
    }));
    await page.goto(`${PAGINA}#cadastro`);

    await page.locator("#cnpjCadastro").fill("12345678000190");
    await page.locator("#emailCadastro").click();
    await expect(page.locator("#razaoSocialCadastro")).toHaveValue("EMPRESA TESTE LTDA");
    // Sem espaços: passa pela validação de formato e chega à mensagem
    await page.locator("#emailCadastro").fill("<img/src=x/onerror=window.__xss=1>@x.com");
    await page.locator("#senhaCadastro").fill("SenhaForte123");
    await page.locator("#confirmarSenhaCadastro").fill("SenhaForte123");
    await page.locator("#formCadastro .btn-solid").click();

    await expect(page.locator(".swal2-popup")).toContainText("Confirme seu E-mail");
    await expect(page.locator(".swal2-popup")).toContainText("<img/src=x");
    await expect(page.locator(".swal2-html-container img")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
