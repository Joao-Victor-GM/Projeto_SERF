// LGPD no Perfil: baixar os próprios dados e excluir a conta (migration 025).

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const PERFIL = "/pages/app/perfil.html";
const EXPORTACAO = { gerado_em: "2026-10-20T12:00:00Z", conta: { email: EMPRESA.email }, compras: [{ id_pedido: 101 }], vendas: [] };

async function abrir(page, { pendentes = [], funcoes = {} } = {}) {
    const mock = await simularSupabase(page, {
        usuario: EMPRESA,
        tabelas: criarTabelas(),
        rpc: { exportar_meus_dados: () => EXPORTACAO, meus_pedidos_em_andamento: () => pendentes },
        funcoes
    });
    await page.goto(PERFIL);
    await expect(page.locator("#privacidade")).toBeVisible();
    return mock;
}

test("baixar meus dados: arquivo JSON com o que o banco devolveu", async ({ page }) => {
    const { errosDaPagina } = await abrir(page);

    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Baixar meus dados" }).click()
    ]);

    expect(download.suggestedFilename()).toMatch(/^serf-meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(fs.readFileSync(await download.path(), "utf8"))).toEqual(EXPORTACAO);
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("excluir com pedidos em andamento: explica e não chama a exclusão", async ({ page }) => {
    const { chamadas } = await abrir(page, {
        pendentes: [{ id_pedido: 101, status_pedido: "CONFIRMADO", papel: "comprador" }, { id_pedido: 201, status_pedido: "PENDENTE", papel: "fornecedor" }],
        funcoes: { "excluir-conta": () => ({ ok: true }) }
    });

    await page.getByRole("button", { name: "Excluir conta" }).click();

    await expect(page.locator(".swal2-popup")).toContainText("Ainda não dá para excluir a conta");
    await expect(page.locator(".swal2-popup")).toContainText("#101, #201");
    expect(chamadas.filter(c => c.tipo === "funcao")).toEqual([]);
});

test("excluir: exige digitar EXCLUIR; confirmado, chama a função, sai e vai à página pública", async ({ page }) => {
    const { chamadas } = await abrir(page, { funcoes: { "excluir-conta": () => ({ ok: true }) } });

    await page.getByRole("button", { name: "Excluir conta" }).click();
    const popup = page.locator(".swal2-popup");
    await expect(popup).toContainText("Não dá para desfazer");
    const campo = page.getByRole("textbox", { name: "Digite EXCLUIR para confirmar" });
    await expect(campo).toBeFocused();          // um clique só nunca exclui: precisa digitar

    await campo.fill("sim");
    await page.getByRole("button", { name: "Excluir minha conta" }).click();
    await expect(popup).toContainText("Digite EXCLUIR para confirmar.");
    expect(chamadas.filter(c => c.tipo === "funcao")).toEqual([]);

    await campo.fill("excluir");
    await page.getByRole("button", { name: "Excluir minha conta" }).click();

    await expect(page).toHaveURL(/pages\/public\/index\.html$/);
    expect(chamadas.find(c => c.tipo === "funcao")).toEqual({ tipo: "funcao", nome: "excluir-conta", corpo: { confirmacao: "EXCLUIR" } });
    expect(chamadas.some(c => c.tipo === "auth" && c.caminho.endsWith("/logout"))).toBe(true);
});

test("excluir: erro do servidor aparece com a mensagem dele e a conta continua", async ({ page }) => {
    await abrir(page, { funcoes: { "excluir-conta": () => { throw Object.assign(new Error("Conclua ou cancele os pedidos em andamento antes de excluir a conta: #7."), { status: 409 }); } } });

    await page.getByRole("button", { name: "Excluir conta" }).click();
    await page.getByRole("textbox", { name: "Digite EXCLUIR para confirmar" }).fill("EXCLUIR");
    await page.getByRole("button", { name: "Excluir minha conta" }).click();

    await expect(page.locator(".swal2-popup")).toContainText("Não foi possível excluir a conta");
    await expect(page.locator(".swal2-popup")).toContainText("#7");
    await expect(page).toHaveURL(/perfil\.html$/);
});
