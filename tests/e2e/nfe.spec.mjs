// NF-e real (notas.js + Edge Function nfe, migration 027) e os dados
// fiscais do Perfil e do produto.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

// Pedido 201: VENDA da EMPRESA (Mercado Bom Preço compra Arroz). Fica
// CONFIRMADO e pago, sem nota: pronto para emitir.
const PEDIDO = 201;

function tabelasDeVenda({ modo = "REAL" } = {}) {
    const tabelas = criarTabelas();
    for (const lista of [tabelas.pedidos, tabelas.pedidos_painel]) {
        const pedido = lista.find(p => p.id_pedido === PEDIDO);
        pedido.status_pedido = "CONFIRMADO";
        pedido.data_resposta = pedido.data_pedido;
    }
    tabelas.pagamentos = [{ id_pagamento: 1, id_pedido: PEDIDO, metodo: "PIX", status: "PAGO", valor: 510, parcelas: 1,
        provedor: "SIMULADO", data_pagamento: new Date().toISOString(), transacao_id: "SERF-1" }];
    tabelas.notas_fiscais = [];
    tabelas.configuracao_nfe = [{ modo }];
    return tabelas;
}

const nota = (status, extras = {}) => ({
    id_nota: 1, id_pedido: PEDIDO, id_fornecedor: 1, status, provedor: "FOCUS_NFE", provedor_ref: `serf-${PEDIDO}-1`,
    numero: null, serie: 1, chave_acesso: null, protocolo: null, url_danfe: null, url_xml: null, mensagem_sefaz: null,
    data_emissao: new Date().toISOString(), ...extras
});

const AUTORIZADA = nota("AUTORIZADA", { numero: 42, chave_acesso: "41261012345678000190550010000000421234567890", protocolo: "1412600001",
    url_danfe: "https://homologacao.focusnfe.com.br/arquivos/danfe.pdf", url_xml: "https://homologacao.focusnfe.com.br/arquivos/nota.xml" });

async function abrirVenda(page, tabelas, funcoes) {
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas, funcoes });
    await page.goto(`/pages/app/home.html?pedido=${PEDIDO}`);
    const secao = page.locator("#pedidoNota");
    await expect(secao).toContainText("Nota fiscal");
    return { ...mock, secao };
}

test("REAL: emitir → 'Na SEFAZ' → autoriza sozinho; DANFE e XML oficiais", async ({ page }) => {
    const tabelas = tabelasDeVenda();
    let consultas = 0;
    const { chamadas, secao, errosDaPagina } = await abrirVenda(page, tabelas, {
        nfe: (corpo, t) => {
            if (corpo.acao === "emitir") {
                t.notas_fiscais = [nota("PROCESSANDO")];
                return { nota: t.notas_fiscais[0] };
            }
            consultas += 1;                                   // "consultar"
            if (consultas >= 2) t.notas_fiscais = [AUTORIZADA];
            return { nota: t.notas_fiscais[0] };
        }
    });

    await secao.getByRole("button", { name: "Emitir NF-e" }).click();
    await expect(page.locator(".swal2-popup")).toContainText("valor fiscal");
    await page.getByRole("button", { name: "Emitir", exact: true }).click();

    await expect(secao).toContainText("Na SEFAZ");
    await expect(secao.getByRole("button", { name: "Consultar agora" })).toBeVisible();

    // Acompanhamento automático (a cada 5 s) até a SEFAZ autorizar
    await expect(secao).toContainText("NF-e autorizada", { timeout: 15000 });
    await expect(secao.getByRole("link", { name: "Ver DANFE (PDF)" })).toHaveAttribute("href", AUTORIZADA.url_danfe);
    await expect(secao.getByRole("link", { name: "XML" })).toHaveAttribute("href", AUTORIZADA.url_xml);

    expect(chamadas.find(c => c.tipo === "funcao").corpo).toEqual({ acao: "emitir", id_pedido: PEDIDO });
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("REAL: rejeitada mostra o motivo da SEFAZ e oferece emitir de novo", async ({ page }) => {
    const { secao } = await abrirVenda(page, tabelasDeVenda(), {
        nfe: (corpo, t) => {
            t.notas_fiscais = [nota("REJEITADA", { mensagem_sefaz: "Rejeição 778: NCM inexistente" })];
            return { nota: t.notas_fiscais[0] };
        }
    });

    await secao.getByRole("button", { name: "Emitir NF-e" }).click();
    await page.getByRole("button", { name: "Emitir", exact: true }).click();

    await expect(page.locator(".swal2-popup")).toContainText("Rejeição 778: NCM inexistente");
    await page.locator(".swal2-confirm").click();
    await expect(secao).toContainText("NF-e rejeitada");
    await expect(secao.getByRole("button", { name: "Emitir de novo" })).toBeVisible();
});

test("REAL: faltam dados fiscais → a mensagem do banco diz o que e onde corrigir", async ({ page }) => {
    const { secao } = await abrirVenda(page, tabelasDeVenda(), {
        nfe: () => { throw Object.assign(new Error("Faltam dados para a NF-e: NCM do produto \"Arroz Tipo 1 5kg\" (Catálogo → editar produto)."), { status: 409 }); }
    });

    await secao.getByRole("button", { name: "Emitir NF-e" }).click();
    await page.getByRole("button", { name: "Emitir", exact: true }).click();
    await expect(page.locator(".swal2-popup")).toContainText("NCM do produto \"Arroz Tipo 1 5kg\"");
});

test("SIMULADA (padrão): emite pelo banco, sem chamar o emissor", async ({ page }) => {
    const tabelas = tabelasDeVenda({ modo: "SIMULADA" });
    const { chamadas, secao } = await simularSupabase(page, {
        usuario: EMPRESA, tabelas,
        rpc: { emitir_nota_fiscal: (corpo, t) => {
            t.notas_fiscais = [{ ...AUTORIZADA, provedor: "SIMULADO", url_danfe: null, url_xml: null }];
            return t.notas_fiscais[0];
        } }
    }).then(async mock => {
        await page.goto(`/pages/app/home.html?pedido=${PEDIDO}`);
        return { ...mock, secao: page.locator("#pedidoNota") };
    });

    await secao.getByRole("button", { name: "Emitir NF-e" }).click();
    await expect(page.locator(".swal2-popup")).toContainText("Documento simulado");
    await page.getByRole("button", { name: "Emitir", exact: true }).click();

    await expect(page.locator(".swal2-popup")).toContainText("NF-e autorizada", { timeout: 8000 });
    await page.getByRole("button", { name: "Fechar" }).click();
    await expect(secao).toContainText("NF-e autorizada");
    await expect(secao.getByRole("button", { name: "Ver DANFE" })).toBeVisible();
    expect(chamadas.filter(c => c.tipo === "funcao")).toEqual([]);
});

/* ---------------- Dados fiscais no Perfil ---------------- */

test("Perfil: endereço para nota fiscal com CEP preenchendo o resto (ViaCEP) e salvando só dígitos", async ({ page }) => {
    const tabelas = criarTabelas();
    Object.assign(tabelas.usuarios[0], { cep: null, logradouro: null, numero_endereco: null, complemento: null,
        bairro: null, municipio: null, uf: null, inscricao_estadual: null });
    Object.assign(tabelas.fornecedores[0], { regime_tributario: "SIMPLES" });

    await page.route("https://viacep.com.br/ws/80010000/json/", rota => rota.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ cep: "80010-000", logradouro: "Rua XV de Novembro", bairro: "Centro", localidade: "Curitiba", uf: "PR" })
    }));

    const { chamadas } = await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/perfil.html");
    await page.locator('.profile-tab-btn[data-tab="dados"]').click();

    await expect(page.locator("#camposEndereco")).toBeVisible();
    await expect(page.locator("#camposFiscaisFornecedor")).toBeVisible();

    await page.locator("#cadCep").fill("80010-000");
    await expect(page.locator("#cadLogradouro")).toHaveValue("Rua XV de Novembro");
    await expect(page.locator("#cadMunicipio")).toHaveValue("Curitiba");
    await expect(page.locator("#cadNumero")).toBeFocused();

    await page.locator("#cadNumero").fill("100");
    await page.locator("#cadIe").fill("901.234.567-8");
    await page.locator("#formDadosEmpresa").getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.locator(".swal2-popup")).toContainText("Dados atualizados!");

    const salvo = chamadas.find(c => c.tabela === "usuarios" && c.metodo === "PATCH").corpo;
    expect(salvo).toMatchObject({ cep: "80010000", logradouro: "Rua XV de Novembro", numero_endereco: "100",
        bairro: "Centro", municipio: "Curitiba", uf: "PR", inscricao_estadual: "9012345678" });
});

test("Perfil: sem a migration 027 os campos fiscais não aparecem e o salvar segue como antes", async ({ page }) => {
    const { chamadas } = await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/perfil.html");
    await page.locator('.profile-tab-btn[data-tab="dados"]').click();

    await expect(page.locator("#camposEndereco")).toBeHidden();
    await expect(page.locator("#camposFiscaisFornecedor")).toBeHidden();

    await page.locator("#formDadosEmpresa").getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.locator(".swal2-popup")).toContainText("Dados atualizados!");
    const salvo = chamadas.find(c => c.tabela === "usuarios" && c.metodo === "PATCH").corpo;
    expect(Object.keys(salvo).sort()).toEqual(["nicho", "telefone"]);
});
