// Regressão mobile/iOS e segmentação ampliada (CNAE 2.0 + campo "Outros"):
// - segmentacao.html no celular: sem corte no topo/laterais, busca e nicho personalizado;
// - home.html #modalPedido em tela baixa (simulando iOS com teclado virtual aberto):
//   #chatInput com 16px, visível, alcançável e enviando mensagem;
// - perfil.html: escolha de "Outros" com nicho personalizado;
// - relatorios.html: filtro após falha de rede não dispara TypeError.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

test("celular (360x640): segmentação não corta o topo e permite digitar nicho em 'Outros'", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });

    const { chamadas, errosDaPagina } = await simularSupabase(page, {
        usuario: { id: EMPRESA.id, email: EMPRESA.email, metadados: {} },
        tabelas: criarTabelas(),
        rpc: { atualizar_segmentacao_usuario: ({ p_perfil }) => p_perfil }
    });

    await page.goto("/pages/public/segmentacao.html");

    // Passo 1: o topo do cartão nunca fica negativo (cortado fora da área de rolagem)
    const caixaPasso1 = await page.locator(".container-triagem").boundingBox();
    expect(caixaPasso1.y).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.locator("#cardAmbos").click();
    await expect(page.locator("#cardAmbos")).toHaveAttribute("aria-checked", "true");
    await page.locator("#btnProximo").click();

    // Passo 2: 16 setores CNAE + Outros, sem rolagem horizontal
    await expect(page.locator(".card-nicho")).toHaveCount(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const caixaPasso2 = await page.locator(".container-triagem").boundingBox();
    expect(caixaPasso2.y).toBeGreaterThanOrEqual(0);

    // Filtrar por texto mantém "Outros" disponível
    await page.locator("#buscaNicho").fill("inexistente");
    await expect(page.locator("#nichoSemResultado")).toBeVisible();
    const cardOutros = page.locator('.card-nicho[data-nicho="Outros"]');
    await expect(cardOutros).toBeVisible();

    await cardOutros.click();
    const inputOutro = page.locator("#outroNichoInput");
    await expect(inputOutro).toBeVisible();
    expect(await inputOutro.evaluate(el => getComputedStyle(el).fontSize)).toBe("16px");
    await expect(page.locator("#btnProximo")).toBeDisabled();

    await inputOutro.fill("  Refrigeração   comercial ");
    await expect(page.locator("#btnProximo")).toBeEnabled();
    await page.locator("#btnProximo").click();

    const chamadaRpc = chamadas.find(c => c.tipo === "rpc" && c.nome === "atualizar_segmentacao_usuario");
    expect(chamadaRpc.corpo).toEqual({
        p_perfil: "Ambos",
        p_nicho: "Refrigeração comercial"
    });
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("celular com teclado aberto (390x420, iOS): campo de chat fica visível, com 16px, e envia mensagem", async ({ page }) => {
    // Altura reduzida simula iPhone com barra do Safari + teclado virtual aberto,
    // além de seção de pagamento e nota fiscal visíveis no mesmo modal.
    await page.setViewportSize({ width: 390, height: 420 });

    const tabelas = criarTabelas();
    tabelas.pagamentos = [{
        id_pagamento: 1, id_pedido: 101, metodo: "PIX", status: "PENDENTE",
        valor: 510, pix_copia_cola: "00020126", criado_em: new Date().toISOString()
    }];
    tabelas.notas_fiscais = [{
        id_nota: 1, id_pedido: 101, id_fornecedor: 2, numero: 12, serie: 1, status: "AUTORIZADA",
        provedor: "SIMULADO", chave_acesso: "41261012345678000190550010000000121234567890", protocolo: "1",
        emitente_razao_social: "Distribuidora Sul LTDA", emitente_cnpj: "98765432000110",
        destinatario_nome: "Atacadão Ambos LTDA", destinatario_cnpj: "12345678000190",
        produto_codigo: 20, produto_descricao: "Açúcar Cristal 2kg", quantidade: 20,
        valor_unitario: 25.5, valor_total: 510, aliquota_icms: 18, valor_icms: 91.8,
        forma_pagamento: "Pix", data_emissao: new Date().toISOString()
    }];

    const { chamadas, errosDaPagina } = await simularSupabase(page, { usuario: EMPRESA, tabelas });
    await page.goto("/pages/app/home.html");

    const botaoPedido = page.locator('#pedidosTableBody [data-pedido="101"]');
    await botaoPedido.scrollIntoViewIfNeeded();
    await botaoPedido.click();

    await expect(page.locator("#modalPedido")).toBeVisible();
    await expect(page.locator("#pedidoPagamento")).toBeVisible();
    await expect(page.locator("#pedidoNota")).toBeVisible();

    const chatInput = page.locator("#chatInput");
    expect(await chatInput.evaluate(el => getComputedStyle(el).fontSize)).toBe("16px");

    await chatInput.scrollIntoViewIfNeeded();
    const caixaInput = await chatInput.boundingBox();
    expect(caixaInput).not.toBeNull();
    expect(caixaInput.height).toBeGreaterThanOrEqual(36);
    expect(caixaInput.y + caixaInput.height).toBeLessThanOrEqual(420);

    await chatInput.click();
    await chatInput.fill("Entrega confirmada para amanhã às 8h!");
    await page.locator("#btnEnviarMensagem").click();

    await expect(page.locator("#chatMensagens")).toContainText("Entrega confirmada para amanhã às 8h!");
    expect(chamadas.some(c => c.tabela === "mensagens_pedidos" && c.metodo === "POST")).toBe(true);
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("Perfil: selecionar 'Outros' permite gravar nicho personalizado", async ({ page }) => {
    const { chamadas, errosDaPagina } = await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas() });
    await page.goto("/pages/app/perfil.html");
    await page.locator('.profile-tab-btn[data-tab="dados"]').click();

    // Dados iniciais tinham nicho "Alimentos" (fora da lista padrão) → pré-carrega em Outros
    await expect(page.locator("#cadNicho")).toHaveValue("Outros");
    await expect(page.locator("#cadOutroNicho")).toBeVisible();
    await expect(page.locator("#cadOutroNicho")).toHaveValue("Alimentos");

    await page.locator("#cadOutroNicho").fill("Automação hospitalar");
    await page.locator("#formDadosEmpresa").getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.locator(".swal2-popup")).toContainText("Dados atualizados!");

    const patchUsuario = chamadas.find(c => c.tabela === "usuarios" && c.metodo === "PATCH");
    const patchFornecedor = chamadas.find(c => c.tabela === "fornecedores" && c.metodo === "PATCH");
    expect(patchUsuario.corpo.nicho).toBe("Automação hospitalar");
    expect(patchFornecedor.corpo.nicho).toBe("Automação hospitalar");
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("Relatórios: trocar filtro após falha no carregamento não gera TypeError", async ({ page }) => {
    const { errosDaPagina } = await simularSupabase(page, {
        usuario: EMPRESA,
        tabelas: criarTabelas(),
        falhas: { pedidos_painel: "connection error" }
    });
    await page.goto("/pages/app/relatorios.html");

    await expect(page.locator("#relAviso")).toBeVisible();
    await page.locator('#filtroPeriodoRel [data-dias="7"]').click();

    await expect(page.locator("#relAviso")).toBeVisible();
    expect(errosDaPagina.filter(e => e.startsWith("pageerror:"))).toEqual([]);
});

