// Monitor de erros (js/monitor-erros.js + migration 032): o que quebra na
// tela de quem usa chega à tabela erros_navegador do próprio Supabase.

import { test, expect } from "@playwright/test";
import { simularSupabase } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const relatos = chamadas => chamadas.filter(c => c.tipo === "rest" && c.tabela === "erros_navegador" && c.metodo === "POST").map(c => c.corpo);

async function abrir(page, caminho, opcoes = {}) {
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas(), ...opcoes });
    await page.goto(caminho);
    await expect(page.locator("#sidebar")).toBeVisible();
    return mock;
}

test("erro de JavaScript não tratado é registrado com página e origem", async ({ page }) => {
    const { chamadas } = await abrir(page, "/pages/app/relatorios.html?aba=1#x");

    await page.evaluate(() => setTimeout(() => { throw new TypeError("teste de monitor"); }));

    await expect.poll(() => relatos(chamadas).length).toBe(1);
    const [relato] = relatos(chamadas);
    expect(relato.mensagem).toBe("TypeError: teste de monitor");
    expect(relato.pagina).toBe("/pages/app/relatorios.html");   // sem ?parâmetros nem #
    expect(relato.pilha).toContain("teste de monitor");
});

test("promessa rejeitada sem catch e falha registrada pelo código também chegam", async ({ page }) => {
    const { chamadas } = await abrir(page, "/pages/app/home.html");

    await page.evaluate(() => { Promise.reject(new Error("sem catch")); });
    await page.evaluate(() => console.error("[SERF:Teste] Falha ao salvar:", new Error("violação de regra")));

    await expect.poll(() => relatos(chamadas).map(r => r.mensagem).sort()).toEqual([
        "Promessa rejeitada: Error: sem catch",
        "[SERF:Teste] Falha ao salvar: Error: violação de regra"
    ]);
});

test("falha de consulta numa tela real (tabela fora do ar) vira relato", async ({ page }) => {
    const { chamadas } = await abrir(page, "/pages/app/catalogo.html?modo=comprar", { falhas: { produtos: "relation does not exist" } });
    await expect.poll(() => relatos(chamadas).some(r => r.mensagem.startsWith("[SERF:Catalogo]"))).toBe(true);
});

test("o mesmo erro só é enviado uma vez e uma página em loop para em 10", async ({ page }) => {
    const { chamadas } = await abrir(page, "/pages/app/alertas.html");

    await page.evaluate(() => {
        for (let i = 0; i < 5; i++) window.SERFMonitor.relatar({ mensagem: "repetido" });
        for (let i = 0; i < 30; i++) window.SERFMonitor.relatar({ mensagem: `erro ${i}` });
    });

    await expect.poll(() => relatos(chamadas).length).toBe(10);
    expect(relatos(chamadas).filter(r => r.mensagem === "repetido")).toHaveLength(1);
});

test("ruído fora do S.E.R.F. é ignorado (imagem quebrada, extensão, sem internet)", async ({ page }) => {
    const { chamadas } = await abrir(page, "/pages/app/alertas.html");

    await page.evaluate(() => {
        const img = document.createElement("img");
        img.src = "/nao-existe.png";
        document.body.append(img);
        window.SERFMonitor.relatar({ mensagem: "TypeError: Failed to fetch" });
        window.SERFMonitor.relatar({ mensagem: "x", origem: "chrome-extension://abc/x.js:1:1" });
        console.error("mensagem de biblioteca, sem prefixo [SERF");
    });
    await page.waitForTimeout(500);
    expect(relatos(chamadas)).toEqual([]);
});
