// Content-Security-Policy (meta em todas as páginas; _headers no host):
// nenhuma página viola a política, e script injetado é bloqueado.

import { test, expect } from "@playwright/test";
import { simularSupabase } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const PUBLICAS = ["index.html", "login-cadastro.html", "redefinir-senha.html", "descadastro.html?t=x.y", "segmentacao.html"];
const INTERNAS = ["home.html", "catalogo.html", "cotacoes.html", "empresas.html", "relatorios.html", "alertas.html", "perfil.html"];

// Registra as violações de CSP antes de qualquer script da página
async function vigiarCsp(page) {
    await page.addInitScript(() => {
        window.__violacoes = [];
        document.addEventListener("securitypolicyviolation", e =>
            window.__violacoes.push(`${e.violatedDirective} ← ${e.blockedURI || "inline"} (${e.sourceFile}:${e.lineNumber})`));
    });
}

for (const pagina of [...PUBLICAS.map(p => `public/${p}`), ...INTERNAS.map(p => `app/${p}`)]) {
    test(`${pagina}: sem violações de CSP`, async ({ page }) => {
        await vigiarCsp(page);
        await simularSupabase(page, { usuario: pagina.startsWith("app/") ? EMPRESA : null, tabelas: criarTabelas() });
        await page.goto(`/pages/${pagina}`);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);

        const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
        expect(csp).toContain("script-src 'self' https://cdn.jsdelivr.net");
        expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
        expect(await page.evaluate(() => window.__violacoes)).toEqual([]);
    });
}

// Sem 'unsafe-inline' em style-src: diálogos e telas montados pelo JS
// usam data-css (js/ui/estilos-dinamicos.js). Confere que nada é bloqueado
// e que o estilo calculado chega mesmo ao elemento.
test("estilos calculados em diálogos e modais funcionam sem estilo inline", async ({ page }) => {
    await vigiarCsp(page);
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });

    // Detalhe do produto (SweetAlert com cor do estoque calculada)
    await page.goto("/pages/app/catalogo.html?modo=comprar");
    await page.locator('.produto-card[data-id="20"] .btn-ver-detalhes').click();
    const estoque = page.locator(".swal2-html-container strong", { hasText: "unidades" }).nth(1);
    await expect(estoque).toBeVisible();
    expect(await estoque.evaluate(el => getComputedStyle(el).color)).toBe("rgb(21, 128, 61)");
    expect(await page.locator("[data-css]").count()).toBe(0);   // tudo aplicado

    // Modal de negociação (montado no JS) e gráfico da Home (alturas calculadas)
    await page.keyboard.press("Escape");
    await page.locator('.produto-card[data-id="20"] .btn-iniciar-negociacao').click();
    await expect(page.locator("#modalNegociacao")).toBeVisible();

    await page.goto("/pages/app/home.html");
    const barra = page.locator(".grafico-producao-barra").first();
    await expect(barra).toBeAttached();
    expect(await barra.evaluate(el => el.style.height)).toMatch(/%$/);

    expect(await page.evaluate(() => window.__violacoes)).toEqual([]);
});

// Modais começam escondidos por classe (.oculto-inicial), não por style=""
for (const pagina of ["home.html", "catalogo.html?modo=vender", "empresas.html"]) {
    test(`${pagina}: modais e botões começam escondidos`, async ({ page }) => {
        await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
        await page.goto(`/pages/app/${pagina}`);
        await page.waitForLoadState("networkidle");
        for (const modal of await page.locator(".modal-serf").all()) await expect(modal).toBeHidden();
    });
}

test("script injetado na página é bloqueado pelo navegador", async ({ page }) => {
    await vigiarCsp(page);
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/home.html");

    await page.evaluate(() => {
        const s = document.createElement("script");
        s.textContent = "window.__invadiu = true";
        document.body.appendChild(s);
    });

    expect(await page.evaluate(() => window.__invadiu)).toBeUndefined();
    expect((await page.evaluate(() => window.__violacoes)).join()).toContain("script-src");
});

test("DANFE simulado: o botão Imprimir funciona sem script inline", async ({ page, context }) => {
    await vigiarCsp(page);
    const tabelas = criarTabelas();
    tabelas.notas_fiscais = [{ id_nota: 1, id_pedido: 202, id_fornecedor: 1, numero: 7, serie: 1, status: "AUTORIZADA",
        provedor: "SIMULADO", chave_acesso: "41261012345678000190550010000000071234567890", protocolo: "1",
        emitente_razao_social: "Atacadão Ambos LTDA", emitente_cnpj: "12345678000190", destinatario_nome: "Mercado",
        destinatario_cnpj: "98765432000110", produto_codigo: 10, produto_descricao: "Arroz", quantidade: 20,
        valor_unitario: 25.5, valor_total: 510, aliquota_icms: 18, valor_icms: 91.8, forma_pagamento: "Pix",
        data_emissao: new Date().toISOString() }];

    await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/home.html?pedido=202");

    const [janela] = await Promise.all([
        context.waitForEvent("page"),
        page.locator("#pedidoNota").getByRole("button", { name: "Ver DANFE" }).click()
    ]);
    await janela.evaluate(() => { window.print = () => { window.__imprimiu = true; }; });
    await janela.getByRole("button", { name: "Imprimir / Salvar PDF" }).click();
    expect(await janela.evaluate(() => window.__imprimiu)).toBe(true);
});
