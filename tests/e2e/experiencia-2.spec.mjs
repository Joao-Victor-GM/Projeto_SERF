// Primeiros passos, verificação do CNPJ, avisos por e-mail, busca de
// produtos e tabela de pedidos no celular.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const PASSOS_NOVA = {
    perfil: "Ambos", perfil_completo: true, cadastrou_produto: true,
    cnpj_verificado: false, fez_pedido: false, enviou_mensagem: false
};

async function abrir(page, caminho, { tabelas = criarTabelas(), rpc = {}, funcoes = {} } = {}) {
    const mock = await simularSupabase(page, {
        usuario: EMPRESA, tabelas, funcoes,
        rpc: { primeiros_passos: () => PASSOS_NOVA, ...rpc }
    });
    await page.goto(caminho);
    return { ...mock, tabelas };
}

test.describe("primeiros passos", () => {
    test("mostra o progresso e destaca o próximo passo", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/home.html");
        const secao = page.locator("#primeirosPassos");

        await expect(secao).toBeVisible();
        await expect(secao).toContainText("2 de 5 concluídos");
        await expect(secao.locator(".pp-passo.feito")).toHaveCount(2);
        await expect(secao.locator(".pp-passo.proximo")).toContainText("Verifique seu CNPJ");
        await expect(secao.locator(".pp-passo.proximo .pp-acao")).toHaveAttribute("href", "perfil.html#homologacao");
        await expect(secao.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "2");

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("passos que não se aplicam ao perfil não aparecem", async ({ page }) => {
        await abrir(page, "/pages/app/home.html", {
            rpc: { primeiros_passos: () => ({ ...PASSOS_NOVA, perfil: "Comprador", cadastrou_produto: null, cnpj_verificado: null }) }
        });
        await expect(page.locator("#primeirosPassos")).toContainText("1 de 3 concluídos");
        await expect(page.locator("#primeirosPassos")).not.toContainText("primeiro produto");
    });

    test("tudo feito: o cartão não aparece; ocultar vale para as próximas visitas", async ({ page }) => {
        await abrir(page, "/pages/app/home.html");
        await page.locator("#ppOcultar").click();
        await expect(page.locator("#primeirosPassos")).toBeHidden();
        await page.reload();
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");
        await expect(page.locator("#primeirosPassos")).toBeHidden();
    });

    test("empresa com tudo concluído não vê o checklist", async ({ page }) => {
        await abrir(page, "/pages/app/home.html", {
            rpc: { primeiros_passos: () => ({ ...PASSOS_NOVA, cnpj_verificado: true, fez_pedido: true, enviou_mensagem: true }) }
        });
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");
        await expect(page.locator("#primeirosPassos")).toBeHidden();
    });
});

test.describe("verificação do CNPJ (Perfil)", () => {
    test("o selo não afirma 'validado' sem verificação; verificar atualiza o selo", async ({ page }) => {
        const tabelas = criarTabelas();
        const { chamadas, errosDaPagina } = await abrir(page, "/pages/app/perfil.html", {
            tabelas,
            funcoes: {
                "homologar-fornecedor": (_, t) => {
                    t.fornecedores[0].status_cadastro = "APROVADO";
                    return { status: "APROVADO", motivo: "CNPJ ativo e razão social conferida na Receita Federal." };
                }
            }
        });

        const selos = page.locator("#perfilSelos");
        await expect(selos).toContainText("CNPJ ainda não verificado na Receita Federal");
        await expect(selos).not.toContainText("CNPJ validado");

        await page.locator("#btnVerificarCnpj").click();

        await expect(selos).toContainText("CNPJ validado na Receita Federal");
        await expect(selos).toContainText("Fornecedora homologada");
        await expect(page.locator("#homologacao")).toBeHidden();
        expect(chamadas.some(c => c.tipo === "funcao" && c.nome === "homologar-fornecedor")).toBe(true);

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("nome diferente da Receita: explica o motivo e mantém o botão", async ({ page }) => {
        await abrir(page, "/pages/app/perfil.html", {
            funcoes: {
                "homologar-fornecedor": () => ({ status: "PENDENTE", motivo: 'CNPJ ativo, mas a razão social cadastrada ("Atacadão Ambos LTDA") é diferente da Receita.' })
            }
        });

        await page.locator("#btnVerificarCnpj").click();
        await expect(page.locator(".swal2-popup")).toContainText("Verificação em análise");
        await page.locator(".swal2-confirm").click();
        await expect(page.locator("#homologacao")).toContainText("é diferente da Receita");
        await expect(page.locator("#btnVerificarCnpj")).toBeVisible();
    });

    test("Receita fora do ar: mensagem clara, sem detalhe técnico", async ({ page }) => {
        await abrir(page, "/pages/app/perfil.html", {
            funcoes: {
                "homologar-fornecedor": () => {
                    const erro = new Error("A consulta à Receita Federal está indisponível agora. Tente de novo em alguns minutos.");
                    erro.status = 503;
                    throw erro;
                }
            }
        });

        await page.locator("#btnVerificarCnpj").click();
        await expect(page.locator(".swal2-popup")).toContainText("indisponível agora");
        await expect(page.locator(".swal2-popup")).not.toContainText("non-2xx");
    });
});

test("avisos por e-mail: desligar grava a preferência", async ({ page }) => {
    const { chamadas } = await abrir(page, "/pages/app/perfil.html");
    const caixa = page.locator("#prefEmail");

    // A seção só aparece depois que a preferência foi lida e aplicada à caixa.
    // (Sem esta espera o teste era instável com a máquina carregada: o Perfil
    // faz várias consultas antes e os 5 s padrão às vezes não bastavam.)
    await expect(page.locator("#notificacoes")).toBeVisible({ timeout: 15000 });
    await expect(caixa).toBeChecked();          // padrão: recebe
    await caixa.uncheck();

    await expect.poll(() => chamadas.some(c => c.tabela === "preferencias_notificacao" && c.metodo === "POST")).toBe(true);
    const gravacao = chamadas.find(c => c.tabela === "preferencias_notificacao" && c.metodo === "POST");
    expect(gravacao.corpo).toMatchObject({ auth_user_id: EMPRESA.id, receber_email: false });
});

test("busca sugere produtos e abre a negociação", async ({ page }) => {
    const { errosDaPagina } = await abrir(page, "/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

    await page.locator("#buscaGlobal").pressSequentially("café", { delay: 20 });

    const lista = page.locator("#resultadoBusca");
    await expect(lista.locator(".busca-grupo")).toHaveText(["Produtos"]);
    await expect(lista.locator('[role="option"]')).toContainText(["Café Torrado 500g"]);
    await expect(lista).toContainText("Distribuidora Sul · R$");

    await page.locator("#buscaGlobal").press("ArrowDown");
    await page.locator("#buscaGlobal").press("Enter");

    await expect(page.locator("#modalNegociacao")).toBeVisible();
    await expect(page.locator("#modalNegociacao")).toContainText("Café Torrado 500g");

    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("celular: pedidos viram cartões com rótulos", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await abrir(page, "/pages/app/home.html");
    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

    await expect(page.locator("#pedidos thead")).toBeHidden();
    const primeira = page.locator("#pedidosTableBody tr").first();
    expect(await primeira.evaluate(tr => getComputedStyle(tr).display)).toBe("grid");
    expect(await primeira.locator('td[data-rotulo="Status"]').evaluate(td => getComputedStyle(td, "::before").content))
        .toBe('"Status"');

    // Sem rolagem horizontal da página
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Cada cartão cabe na tela, com todos os campos e o botão inteiros visíveis
    await primeira.scrollIntoViewIfNeeded();
    for (const rotulo of ["Pedido", "Empresa", "Produto", "Status", "Atualização"]) {
        await expect(primeira.locator(`td[data-rotulo="${rotulo}"]`)).toBeInViewport({ ratio: 1 });
    }
    const botao = await primeira.locator(".table-action").boundingBox();
    expect(botao.x + botao.width).toBeLessThanOrEqual(390);
});
