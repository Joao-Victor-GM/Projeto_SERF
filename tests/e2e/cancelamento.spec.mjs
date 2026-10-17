// Cancelamento do pedido pelo comprador (Home → modal do pedido).

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

// Simula a RPC: o banco real valida a regra (testada em tests/banco).
function rpcCancelar(corpo, tabelas) {
    const atualizar = linha => Object.assign(linha, {
        status_pedido: "CANCELADO",
        motivo_cancelamento: corpo.p_motivo,
        data_cancelamento: new Date().toISOString(),
        data_atualizacao: new Date().toISOString()
    });

    tabelas.pedidos_painel.filter(p => p.id_pedido === corpo.p_id_pedido).forEach(atualizar);
    const pedido = tabelas.pedidos.find(p => p.id_pedido === corpo.p_id_pedido);
    const { produtos, usuarios, ...linha } = atualizar(pedido);
    return linha;
}

async function abrirPedido(page, idPedido, modo = "comprar") {
    const tabelas = criarTabelas();
    const mock = await simularSupabase(page, {
        usuario: EMPRESA,
        tabelas,
        rpc: { cancelar_pedido_comprador: rpcCancelar }
    });

    await page.goto("/pages/app/home.html");
    if (modo === "vender") await page.locator('.modo-btn[data-mode="vender"]').click();
    await page.locator(`#pedidosTableBody [data-pedido="${idPedido}"]`).click();
    await expect(page.locator("#modalPedidoTitulo")).toHaveText(`Pedido #${idPedido}`);

    return mock;
}

test("comprador cancela pedido pendente; o fornecedor é avisado pelo chat", async ({ page }) => {
    const { chamadas, errosDaPagina } = await abrirPedido(page, 101);

    const secao = page.locator("#pedidoCancelamento");
    await expect(secao).toBeVisible();
    await expect(secao).toContainText("ainda não respondeu");

    await page.locator("#btnCancelarPedido").click();
    await expect(page.locator(".swal2-popup")).toContainText("Cancelar o pedido #101?");
    await page.locator(".swal2-textarea").fill("Encontrei preço melhor");
    await page.locator(".swal2-confirm").click();

    await expect(page.locator("#pedidoResumo")).toContainText("Cancelado");
    await expect(page.locator("#pedidoResumo")).toContainText("Encontrei preço melhor");
    await expect(secao).toBeHidden(); // pedido cancelado não pode ser cancelado de novo

    const rpc = chamadas.find(c => c.tipo === "rpc" && c.nome === "cancelar_pedido_comprador");
    expect(rpc.corpo).toEqual({ p_id_pedido: 101, p_motivo: "Encontrei preço melhor" });

    await expect.poll(() => chamadas.some(c =>
        c.tabela === "mensagens_pedidos" && c.metodo === "POST" && /cancelado pelo comprador/.test(c.corpo?.texto)
    )).toBe(true);

    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("pedido já confirmado exige motivo de pelo menos 10 caracteres", async ({ page }) => {
    const { chamadas, errosDaPagina } = await abrirPedido(page, 102);

    await expect(page.locator("#cancelamentoAjuda")).toContainText("informe o motivo");
    await page.locator("#btnCancelarPedido").click();

    await page.locator(".swal2-confirm").click();
    await expect(page.locator(".swal2-validation-message")).toContainText("mínimo de 10");
    expect(chamadas.some(c => c.nome === "cancelar_pedido_comprador")).toBe(false);

    await page.locator(".swal2-textarea").fill("O prazo não atende mais");
    await page.locator(".swal2-confirm").click();
    await expect(page.locator("#pedidoResumo")).toContainText("Cancelado");

    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("desistir no diálogo não cancela", async ({ page }) => {
    const { chamadas } = await abrirPedido(page, 101);

    await page.locator("#btnCancelarPedido").click();
    await page.locator(".swal2-cancel").click();

    await expect(page.locator("#pedidoResumo")).toContainText("Pendente");
    expect(chamadas.some(c => c.nome === "cancelar_pedido_comprador")).toBe(false);
});

test("quem vende não vê o cancelamento do comprador", async ({ page }) => {
    await abrirPedido(page, 201, "vender");
    await expect(page.locator("#pedidoCancelamento")).toBeHidden();
    await expect(page.locator("#formStatusPedido")).toBeVisible();
});
