// Perfil → "Identidade da empresa" (posse do CNPJ, migration 029).

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const emDias = d => new Date(Date.now() + d * 86400000).toISOString();

function tabelas({ identidade = {}, modo = "DEMONSTRACAO" } = {}) {
    const t = criarTabelas();
    t.configuracao_identidade = [{ modo }];
    t.identidade_empresas = [{
        auth_user_id: EMPRESA.id, cnpj: "12345678000190", verificada_em: null, metodo: null,
        carencia_ate: null, contestada_em: null, codigo_expira_em: null, tentativas: 0, email_destino: null, ...identidade
    }];
    return t;
}

// confirmar_identidade simulada: aceita só "482913"
const rpc = {
    confirmar_identidade: ({ p_codigo }, t) => {
        if (p_codigo !== "482913") return `incorreto:${4 - ((t.__erros = (t.__erros || 0) + 1) - 1)}`;
        Object.assign(t.identidade_empresas[0], { verificada_em: new Date().toISOString(), metodo: "DEMONSTRACAO" });
        return "verificada";
    }
};

async function abrir(page, opcoes = {}, funcoes = {}) {
    const t = tabelas(opcoes);
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas: t, rpc, funcoes });
    await page.goto("/pages/app/perfil.html");
    await expect(page.locator("#identidade")).toBeVisible({ timeout: 15000 });
    return { ...mock, tabelas: t };
}

test("demonstração: envia, mostra o código na tela, erra, acerta e fica verificada", async ({ page }) => {
    const { chamadas, errosDaPagina } = await abrir(page, { identidade: { carencia_ate: emDias(20) } }, {
        "verificar-cnpj": () => ({ modo: "DEMONSTRACAO", destino: "c***@ambos.com.br", codigo: "482913" })
    });
    const cartao = page.locator("#identidade");

    await expect(cartao).toContainText("Você pode continuar vendendo até");
    await expect(cartao).toContainText("Modo demonstração");

    await cartao.getByRole("button", { name: "Enviar código" }).click();
    await expect(cartao.locator(".identidade-demo")).toContainText("em produção, este código iria para o e-mail da Receita Federal");
    await expect(cartao.locator(".identidade-demo code")).toHaveText("482913");
    await expect(page.locator("#codigoIdentidade")).toBeFocused();

    await page.locator("#codigoIdentidade").fill("111111");
    await cartao.getByRole("button", { name: "Confirmar" }).click();
    await expect(cartao.getByRole("alert")).toContainText("Código incorreto. Restam");

    await page.locator("#codigoIdentidade").fill("482913");
    await cartao.getByRole("button", { name: "Confirmar" }).click();
    await expect(cartao).toContainText("✓ Posse do CNPJ comprovada em");
    expect(chamadas.filter(c => c.nome === "confirmar_identidade").map(c => c.corpo.p_codigo)).toEqual(["111111", "482913"]);
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("modo REAL: não mostra o código; diz para qual e-mail (mascarado) foi", async ({ page }) => {
    await abrir(page, { modo: "REAL" }, {
        "verificar-cnpj": () => ({ modo: "REAL", destino: "c***@contabilxyz.com.br" })
    });
    const cartao = page.locator("#identidade");

    await expect(cartao).toContainText("Até comprovar, sua empresa não recebe pedidos nem envia propostas.");
    await expect(cartao).toContainText("e-mail que a Receita Federal tem deste CNPJ");
    await cartao.getByRole("button", { name: "Enviar código" }).click();

    await expect(cartao).toContainText("Enviamos um código para c***@contabilxyz.com.br");
    await expect(cartao.locator(".identidade-demo")).toHaveCount(0);
});

test("CNPJ sem e-mail na Receita: a mensagem do servidor explica a saída", async ({ page }) => {
    await abrir(page, { modo: "REAL" }, {
        "verificar-cnpj": () => { throw Object.assign(new Error("A Receita Federal não tem e-mail cadastrado para este CNPJ."), { status: 422 }); }
    });
    await page.locator("#identidade").getByRole("button", { name: "Enviar código" }).click();
    await expect(page.locator("#identidade .identidade-msg.envio")).toContainText("não tem e-mail cadastrado");
    await expect(page.locator("#identidade .identidade-msg.envio")).toHaveAttribute("role", "alert");
});

test("situações: verificada e contestada (outra conta comprovou o CNPJ)", async ({ page }) => {
    await abrir(page, { identidade: { verificada_em: emDias(-3), metodo: "EMAIL_RECEITA" } });
    await expect(page.locator("#identidade")).toContainText("✓ Posse do CNPJ comprovada em");
    await expect(page.locator("#identidade").getByRole("button")).toHaveCount(0);

    await abrir(page, { identidade: { contestada_em: emDias(-1) } });
    await expect(page.locator("#identidade").getByRole("alert")).toContainText("Outra conta comprovou a posse deste CNPJ");
});

test("sem a migration 029, o cartão não aparece", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas(), falhas: { identidade_empresas: "relation does not exist" } });
    await page.goto("/pages/app/perfil.html");
    await expect(page.locator("#privacidade")).toBeVisible();
    await expect(page.locator("#identidade")).toBeHidden();
});
