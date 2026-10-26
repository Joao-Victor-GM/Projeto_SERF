// CAPTCHA (js/captcha.js, Cloudflare Turnstile): desligado por padrão;
// ligado, o token vai junto no cadastro, no login e na recuperação de senha.
// O Turnstile é simulado: o teste não depende da Cloudflare.

import { test, expect } from "@playwright/test";
import { simularSupabase } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const LOGIN = { email: "contato@ambos.com.br", senha: "senha-forte-123", usuario: EMPRESA };

// Turnstile falso: entrega um token novo a cada render/reset
const TURNSTILE_FALSO = `
    let contador = 0;
    const widgets = {};
    window.turnstile = {
        render(caixa, opcoes) {
            const id = "w" + (++contador);
            widgets[id] = opcoes;
            window.__captchaOpcoes = opcoes;
            setTimeout(() => opcoes.callback("token-" + id + "-1"), 50);
            return id;
        },
        reset(id) {
            widgets[id].__n = (widgets[id].__n || 1) + 1;
            setTimeout(() => widgets[id].callback("token-" + id + "-" + widgets[id].__n), 50);
        }
    };`;

async function abrirLogin(page, { chave, turnstile = TURNSTILE_FALSO } = {}) {
    if (chave) await page.addInitScript(valor => { window.SERFConfig = { turnstileChaveSite: valor }; }, chave);
    const carregouTurnstile = [];
    await page.route(/challenges\.cloudflare\.com/, rota => {
        carregouTurnstile.push(rota.request().url());
        return turnstile === null ? rota.abort() : rota.fulfill({ contentType: "text/javascript", body: turnstile });
    });
    const mock = await simularSupabase(page, { usuario: null, tabelas: criarTabelas(), login: LOGIN });
    await page.goto("/pages/public/login-cadastro.html");
    return { ...mock, carregouTurnstile };
}

const corpoDoLogin = chamadas => chamadas.filter(c => c.tipo === "auth" && c.caminho.endsWith("/token")).at(-1);

async function entrar(page) {
    await page.locator("#emailLogin").fill(LOGIN.email);
    await page.locator("#senhaLogin").fill(LOGIN.senha);
    await page.locator("#formLogin button[type=submit]").click();
}

test("desligado (padrão): nem carrega o Turnstile e o login funciona", async ({ page }) => {
    const { carregouTurnstile } = await abrirLogin(page);
    await entrar(page);
    await page.waitForURL(/pages\/app\//);
    expect(carregouTurnstile).toEqual([]);
    await expect(page.locator(".captcha-caixa")).toHaveCount(0);
});

test("ligado: o login manda o token ao Supabase e cada tentativa usa um token novo", async ({ page }) => {
    const pedidos = [];
    page.on("request", req => { if (req.url().includes("/auth/v1/token")) pedidos.push(req.postDataJSON()); });
    const { carregouTurnstile } = await abrirLogin(page, { chave: "0x4AAAAAAAteste" });

    expect(carregouTurnstile[0]).toContain("render=explicit");
    expect(await page.evaluate(() => window.__captchaOpcoes.sitekey)).toBe("0x4AAAAAAAteste");

    // 1ª tentativa com senha errada, 2ª certa
    await page.locator("#emailLogin").fill(LOGIN.email);
    await page.locator("#senhaLogin").fill("errada-123456");
    await page.locator("#formLogin button[type=submit]").click();
    await expect(page.locator(".swal2-popup")).toBeVisible();
    await page.locator(".swal2-confirm").click();
    await entrar(page);
    await page.waitForURL(/pages\/app\//);

    const tokens = pedidos.map(p => p.gotrue_meta_security?.captcha_token);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatch(/^token-/);
    expect(tokens[1]).toMatch(/^token-/);
    expect(tokens[1]).not.toBe(tokens[0]);   // token é de uso único
});

test("ligado: cadastro e recuperação de senha também mandam o token", async ({ page }) => {
    const corpos = {};
    page.on("request", req => {
        const url = req.url();
        if (url.includes("/auth/v1/signup")) corpos.cadastro = req.postDataJSON();
        if (url.includes("/auth/v1/recover")) corpos.recuperar = req.postDataJSON();
    });
    await page.route("https://brasilapi.com.br/**", rota => rota.fulfill({
        contentType: "application/json", body: JSON.stringify({ razao_social: "EMPRESA TESTE LTDA" })
    }));
    await abrirLogin(page, { chave: "0x4AAAAAAAteste" });
    await expect.poll(() => page.locator(".captcha-caixa").count()).toBe(3);

    // Cadastro
    await page.goto("/pages/public/login-cadastro.html#cadastro");
    await page.locator("#cnpjCadastro").fill("12345678000190");
    await page.locator("#emailCadastro").click();
    await expect(page.locator("#razaoSocialCadastro")).toHaveValue("EMPRESA TESTE LTDA");
    await page.locator("#emailCadastro").fill("nova@empresa.com.br");
    await page.locator("#senhaCadastro").fill("SenhaForte123");
    await page.locator("#confirmarSenhaCadastro").fill("SenhaForte123");
    await page.locator("#formCadastro .btn-solid").click();
    await expect.poll(() => corpos.cadastro?.gotrue_meta_security?.captcha_token).toMatch(/^token-/);
    await expect(page.locator(".swal2-popup")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
        // Recuperar senha (o formulário pode estar escondido; o envio é o mesmo)
        document.getElementById("emailRecuperar").value = "contato@ambos.com.br";
        document.getElementById("formRecuperar").requestSubmit();
    });
    await expect.poll(() => corpos.recuperar?.gotrue_meta_security?.captcha_token).toMatch(/^token-/);
});

test("ligado mas a Cloudflare não carrega: avisa em vez de tentar entrar sem token", async ({ page }) => {
    const { chamadas } = await abrirLogin(page, { chave: "0x4AAAAAAAteste", turnstile: null });
    await entrar(page);

    await expect(page.locator(".swal2-popup")).toContainText("verificação de segurança");
    expect(corpoDoLogin(chamadas)).toBeUndefined();
});
