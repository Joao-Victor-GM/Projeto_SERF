// Página pública de descadastro (link "Parar de receber" dos e-mails).

import { test, expect } from "@playwright/test";
import { simularSupabase } from "./supabase-falso.mjs";

const PAGINA = "pages/public/descadastro.html";

test("só descadastra depois do clique, enviando o token do link", async ({ page }) => {
    const { chamadas } = await simularSupabase(page, { usuario: null, funcoes: { descadastrar: () => ({ ok: true }) } });
    await page.goto(`${PAGINA}?t=uid.assinatura`);

    await expect(page.getByRole("heading", { name: "Parar de receber e-mails?" })).toBeVisible();
    await page.waitForTimeout(300);
    expect(chamadas.filter(c => c.tipo === "funcao")).toEqual([]);      // abrir o link não basta

    await page.getByRole("button", { name: "Parar de receber" }).click();

    await expect(page.getByRole("heading", { name: "Pronto" })).toBeVisible();
    await expect(page.locator("#feito")).toContainText("Perfil → Avisos por e-mail");
    expect(chamadas.filter(c => c.tipo === "funcao")).toEqual([{ tipo: "funcao", nome: "descadastrar", corpo: { t: "uid.assinatura" } }]);
});

test("link inválido: explica e mantém o botão para tentar de novo", async ({ page }) => {
    await simularSupabase(page, {
        usuario: null,
        funcoes: { descadastrar: () => { throw Object.assign(new Error("Link de descadastro inválido."), { status: 400 }); } }
    });
    await page.goto(`${PAGINA}?t=falso`);
    await page.getByRole("button", { name: "Parar de receber" }).click();

    await expect(page.getByRole("alert")).toHaveText(/link de descadastro é inválido/);
    await expect(page.getByRole("button", { name: "Parar de receber" })).toBeEnabled();
});

test("sem token: nem oferece o botão", async ({ page }) => {
    await simularSupabase(page, { usuario: null });
    await page.goto(PAGINA);

    await expect(page.getByRole("alert")).toContainText("Link incompleto");
    await expect(page.getByRole("button")).toHaveCount(0);
});
