// Sino de notificações (js/notificacoes.js, migration 023).

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const agora = new Date();
const atras = minutos => new Date(agora.getTime() - minutos * 60000).toISOString();

function tabelasComNotificacoes() {
    const tabelas = criarTabelas();
    tabelas.notificacoes = [
        { id: 1, tipo: "MENSAGEM_NOVA", quantidade: 2, lida_em: null, criada_em: atras(5), atualizada_em: atras(5),
          dados: { id_pedido: 101, remetente: "Distribuidora Sul", trecho: "Chega amanhã" } },
        { id: 2, tipo: "NOVO_PRODUTO_SEGMENTO", quantidade: 1, lida_em: null, criada_em: atras(60), atualizada_em: atras(60),
          dados: { categoria: "Alimentos & Bebidas", itens: [{ produto: "Café", fornecedor: "Sul", preco: 30 }] } },
        { id: 3, tipo: "STATUS_PEDIDO", quantidade: 1, lida_em: atras(100), criada_em: atras(200), atualizada_em: atras(200),
          dados: { id_pedido: 102, produto: "Açúcar", status: "ENVIADO" } }
    ];
    return tabelas;
}

const rpc = {
    marcar_notificacoes_lidas: (_corpo, tabelas) => {
        const novas = tabelas.notificacoes.filter(n => !n.lida_em);
        novas.forEach(n => { n.lida_em = new Date().toISOString(); });
        return novas.length;
    }
};

for (const pagina of ["home", "catalogo", "relatorios"]) {
    test(`${pagina}: sino com contador de não lidas e lista das recentes`, async ({ page }) => {
        const { errosDaPagina } = await simularSupabase(page, { usuario: EMPRESA, tabelas: tabelasComNotificacoes(), rpc });
        await page.goto(`/pages/app/${pagina}.html`);

        const sino = page.locator("#notifSino");
        await expect(sino).toBeVisible();
        await expect(sino.locator(".notif-contador")).toHaveText("2");
        await expect(sino).toHaveAttribute("aria-label", "Notificações: 2 não lidas");

        await sino.click();
        const painel = page.locator("#notifPainel");
        await expect(painel).toBeVisible();
        await expect(painel.locator(".notif-item")).toHaveCount(3);
        await expect(painel.locator(".notif-item").first()).toContainText("2 mensagens de Distribuidora Sul");
        await expect(painel.locator(".notif-item.nao-lida")).toHaveCount(2);

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });
}

test("clicar marca como lida e leva ao destino", async ({ page }) => {
    const tabelas = tabelasComNotificacoes();
    const { chamadas } = await simularSupabase(page, { usuario: EMPRESA, tabelas, rpc });
    await page.goto("/pages/app/relatorios.html");

    await page.locator("#notifSino").click();
    await page.locator("#notifPainel").getByText("Novo em Alimentos & Bebidas: Café").click();

    await expect(page).toHaveURL(/catalogo\.html$/);
    const marcou = chamadas.find(c => c.tabela === "notificacoes" && c.metodo === "PATCH");
    expect(marcou.parametros).toContainEqual(["id", "eq.2"]);
    expect(tabelas.notificacoes.find(n => n.id === 2).lida_em).not.toBeNull();
});

test("marcar todas como lidas zera o contador; Esc fecha e devolve o foco", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: tabelasComNotificacoes(), rpc });
    await page.goto("/pages/app/home.html");

    const sino = page.locator("#notifSino");
    await sino.click();
    await page.getByRole("button", { name: "Marcar todas como lidas" }).click();

    await expect(sino.locator(".notif-contador")).toBeHidden();
    await expect(page.locator("#notifPainel .notif-item.nao-lida")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Marcar todas como lidas" })).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(page.locator("#notifPainel")).toBeHidden();
    await expect(sino).toBeFocused();
});

test("nova notificação aparece ao recarregar (o Realtime chama a mesma recarga)", async ({ page }) => {
    const tabelas = criarTabelas();
    await simularSupabase(page, { usuario: EMPRESA, tabelas, rpc });
    await page.goto("/pages/app/home.html");

    const sino = page.locator("#notifSino");
    await expect(sino).toBeVisible();
    await expect(sino.locator(".notif-contador")).toBeHidden();

    tabelas.notificacoes.push({ id: 9, tipo: "PAGAMENTO_CONFIRMADO", quantidade: 1, lida_em: null,
        criada_em: atras(0), atualizada_em: atras(0), dados: { id_pedido: 201, comprador: "Mercado", valor: 510, metodo: "PIX" } });
    await page.evaluate(() => window.SERFNotificacoes.recarregar());

    await expect(sino.locator(".notif-contador")).toHaveText("1");
    await sino.click();
    await expect(page.locator("#notifPainel")).toContainText("Pagamento recebido: pedido #201");
});

test("sem a migration 023 o sino não aparece e a página segue normal", async ({ page }) => {
    await simularSupabase(page, { usuario: EMPRESA, tabelas: criarTabelas(), falhas: { notificacoes: "relation does not exist" } });
    await page.goto("/pages/app/home.html");

    await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");
    await expect(page.locator("#notifSino")).toBeHidden();
});

test("celular: o painel cabe na tela, sem rolagem lateral", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await simularSupabase(page, { usuario: EMPRESA, tabelas: tabelasComNotificacoes(), rpc });
    await page.goto("/pages/app/home.html");

    await page.locator("#notifSino").click();
    const caixa = await page.locator("#notifPainel").boundingBox();
    expect(caixa.x).toBeGreaterThanOrEqual(0);
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
