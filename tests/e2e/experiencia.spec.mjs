// Experiência do usuário: gestão de produtos, carrinho, botão principal,
// "Precisa da sua ação", radar recolhível e mensagens de erro legíveis.

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

// RPC criar_compra simulada: as regras de verdade estão em tests/banco/carrinho.test.mjs
function rpcCriarCompra(corpo, tabelas) {
    const itens = corpo.p_itens;
    const semEstoque = itens.find(item => {
        const produto = tabelas.produtos.find(p => p.id_produto === item.id_produto);
        return item.quantidade > produto.quantidade_estoque;
    });
    if (semEstoque) {
        const nome = tabelas.produtos.find(p => p.id_produto === semEstoque.id_produto).nome_produto;
        throw new Error(`${nome}: Estoque insuficiente`);
    }
    return itens.map((item, i) => ({ id_pedido: 900 + i, id_produto: item.id_produto, quantidade: item.quantidade, id_compra: "c-1" }));
}

async function abrir(page, caminho, { tabelas = criarTabelas(), rpc = {}, falhas } = {}) {
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas, rpc: { criar_compra: rpcCriarCompra, ...rpc }, falhas });
    await page.goto(caminho);
    return { ...mock, tabelas };
}

test.describe("gestão de produtos (fornecedor)", () => {
    test("editar preço e estoque grava e atualiza o card", async ({ page }) => {
        const { chamadas, errosDaPagina } = await abrir(page, "/pages/app/catalogo.html?modo=vender");

        const card = page.locator('.produto-card[data-id="11"]');
        await expect(card).toContainText("Feijão Carioca");
        await card.locator(".btn-editar-produto").click();

        await expect(page.locator(".swal2-popup")).toContainText("Editar produto");
        await page.locator("#gpPreco").fill("19,90");
        await page.locator("#gpEstoque").fill("300");
        await page.locator(".swal2-confirm").click();

        await expect(card).toContainText("300 em estoque");
        await expect(card).toContainText("19,90");

        const patch = chamadas.find(c => c.tabela === "produtos" && c.metodo === "PATCH");
        expect(patch.corpo).toMatchObject({ preco_atacado: 19.9, quantidade_estoque: 300 });
        expect(patch.parametros).toContainEqual(["id_produto", "eq.11"]);

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("validação do formulário: não grava estoque negativo", async ({ page }) => {
        const { chamadas } = await abrir(page, "/pages/app/catalogo.html?modo=vender");

        await page.locator('.produto-card[data-id="11"] .btn-editar-produto').click();
        await page.locator("#gpEstoque").fill("-5");
        await page.locator(".swal2-confirm").click();

        await expect(page.locator(".swal2-validation-message")).toContainText("estoque");
        expect(chamadas.some(c => c.tabela === "produtos" && c.metodo === "PATCH")).toBe(false);
    });

    test("pausar vendas: confirma, mantém o produto em 'Meus produtos' e permite reativar", async ({ page }) => {
        await abrir(page, "/pages/app/catalogo.html?modo=vender");

        const card = page.locator('.produto-card[data-id="10"]');
        await card.locator(".btn-alternar-produto").click();
        await expect(page.locator(".swal2-popup")).toContainText("Pausar vendas");
        await page.locator(".swal2-confirm").click();

        await expect(card).toHaveClass(/pausado/);
        await expect(card).toContainText("Vendas pausadas");
        await expect(card.locator(".btn-alternar-produto")).toContainText("Reativar");

        await card.locator(".btn-alternar-produto").click();     // reativar não pede confirmação
        await expect(card).not.toHaveClass(/pausado/);
    });

    test("cadastro abre direto por link (?novo=1), como faz o botão da Home", async ({ page }) => {
        await abrir(page, "/pages/app/catalogo.html?modo=vender&novo=1");
        await expect(page.locator("#modalNovoProduto")).toBeVisible();
    });
});

test.describe("carrinho (comprador)", () => {
    test("adiciona de dois fornecedores, ajusta quantidade e envia tudo de uma vez", async ({ page }) => {
        const { chamadas, errosDaPagina } = await abrir(page, "/pages/app/catalogo.html?modo=comprar");

        await page.locator('.produto-card[data-id="20"] .btn-adicionar-carrinho').click();
        await page.locator('.produto-card[data-id="21"] .btn-adicionar-carrinho').click();

        const botao = page.locator("#carrinhoBotao");
        await expect(botao).toContainText("2");
        await botao.click();

        const painel = page.locator("#carrinhoPainel");
        await expect(painel).toBeVisible();
        await expect(painel).toContainText("Açúcar Cristal 2kg");
        await expect(painel).toContainText("Café Torrado 500g");

        // Quantidade abaixo do mínimo é corrigida para o mínimo
        const quantidade = painel.locator('[data-quantidade="20"]');
        await quantidade.fill("3");
        await quantidade.press("Tab");
        await expect(painel.locator('[data-quantidade="20"]')).toHaveValue("10");

        await painel.locator('[data-quantidade="21"]').fill("40");
        await painel.locator('[data-quantidade="21"]').press("Tab");
        await painel.locator("#carrinhoObservacao").fill("Entregar pela manhã");
        await painel.locator("#carrinhoEnviar").click();

        await expect(painel).toBeHidden();
        await expect(botao).toBeHidden();                       // carrinho esvaziado

        const rpc = chamadas.find(c => c.nome === "criar_compra");
        expect(rpc.corpo).toEqual({
            p_itens: [{ id_produto: 20, quantidade: 10 }, { id_produto: 21, quantidade: 40 }],
            p_observacao: "Entregar pela manhã"
        });

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("se um item falha, nada é enviado e o erro diz qual produto", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.produtos.find(p => p.id_produto === 21).quantidade_estoque = 15;

        await abrir(page, "/pages/app/catalogo.html?modo=comprar", { tabelas });
        await page.locator('.produto-card[data-id="21"] .btn-adicionar-carrinho').click();

        // Outra aba esgotou o estoque: força uma quantidade maior que a atual
        await page.evaluate(() => {
            const chave = Object.keys(localStorage).find(k => k.startsWith("serf-carrinho-"));
            const itens = JSON.parse(localStorage.getItem(chave));
            itens[0].estoque = 999;
            localStorage.setItem(chave, JSON.stringify(itens));
        });
        await page.reload();
        await page.locator("#carrinhoBotao").click();
        await page.locator('[data-quantidade="21"]').fill("50");
        await page.locator('[data-quantidade="21"]').press("Tab");
        await page.locator("#carrinhoEnviar").click();

        await expect(page.locator(".swal2-popup")).toContainText("Os pedidos não foram enviados");
        await expect(page.locator(".swal2-popup")).toContainText("Café Torrado 500g: Estoque insuficiente");
        await page.locator(".swal2-confirm").click();
        await expect(page.locator("#carrinhoBotao")).toContainText("1");  // carrinho preservado
    });

    test("o carrinho sobrevive a recarregar a página", async ({ page }) => {
        await abrir(page, "/pages/app/catalogo.html?modo=comprar");
        await page.locator('.produto-card[data-id="20"] .btn-adicionar-carrinho').click();
        await page.reload();
        await expect(page.locator("#carrinhoBotao")).toContainText("1");
    });

    test("produto sem estoque para o mínimo não pode ir ao carrinho", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.produtos.find(p => p.id_produto === 21).quantidade_estoque = 2;
        await abrir(page, "/pages/app/catalogo.html?modo=comprar", { tabelas });
        await expect(page.locator('.produto-card[data-id="21"] .btn-adicionar-carrinho')).toBeDisabled();
    });
});

test.describe("Home", () => {
    test("botão principal no modo Comprar leva ao catálogo (não é mais um aviso)", async ({ page }) => {
        await abrir(page, "/pages/app/home.html");
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

        await page.locator("#btnAcaoPrincipal").click();
        await expect(page).toHaveURL(/catalogo\.html$/);
    });

    test("botão principal no modo Vender abre o cadastro de produto ali mesmo", async ({ page }) => {
        await abrir(page, "/pages/app/home.html");
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

        await page.locator('.modo-btn[data-mode="vender"]').click();
        await page.locator("#btnAcaoPrincipal").click();
        await expect(page.locator("#modalNovoProduto")).toBeVisible();
    });

    test("o catálogo não fica mais na Home (e não é consultado lá)", async ({ page }) => {
        const { chamadas } = await abrir(page, "/pages/app/home.html");
        await expect(page.locator("#totalPedidos")).toHaveText("3 pedidos");

        await expect(page.locator("#listaProdutos")).toHaveCount(0);
        expect(chamadas.some(c => c.tabela === "produtos" && c.metodo === "GET")).toBe(false);
    });

    test("'Precisa da sua ação' mostra urgentes primeiro e abre o pedido sem sair da Home", async ({ page }) => {
        const { errosDaPagina } = await abrir(page, "/pages/app/home.html");

        const lista = page.locator("#acoesLista .acao-item");
        await expect(page.locator("#acoesResumo")).toHaveText("3 pendências, 2 urgentes.");
        await expect(lista).toHaveCount(3);                                  // info não entra
        await expect(lista.first()).toHaveClass(/urgente/);

        await page.locator('#acoesLista [data-pedido="201"]').click();
        await expect(page).toHaveURL(/home\.html/);
        await expect(page.locator("#modalPedidoTitulo")).toHaveText("Pedido #201");

        expect(errosRelevantes(errosDaPagina)).toEqual([]);
    });

    test("sem pendências: 'Tudo em dia'", async ({ page }) => {
        const tabelas = criarTabelas();
        tabelas.alertas = [];
        await abrir(page, "/pages/app/home.html", { tabelas });

        await expect(page.locator("#acoesResumo")).toContainText("Tudo em dia");
        await expect(page.locator("#acoesLista")).toBeHidden();
    });

    test("radar recolhe, para a animação e lembra a escolha", async ({ page }) => {
        await abrir(page, "/pages/app/home.html");
        const radar = page.locator("#radar-oportunidades");
        await expect(radar.locator("#ropTotal")).toHaveText("4");

        await page.locator("#ropRecolher").click();
        await expect(radar).toHaveClass(/recolhido/);
        await expect(radar.locator(".rop-visual")).toBeHidden();
        await expect(page.locator("#ropRecolher")).toHaveAttribute("aria-expanded", "false");
        expect(await page.evaluate(() => window.SERFRadarOportunidades.emMovimento())).toBe(false);

        await page.reload();
        await expect(radar).toHaveClass(/recolhido/);

        await page.locator("#ropRecolher").click();
        await expect(radar.locator(".rop-visual")).toBeVisible();
    });

    test("erro técnico aparece como frase para o usuário", async ({ page }) => {
        await abrir(page, "/pages/app/home.html", {
            rpc: {
                cancelar_pedido_comprador: () => {
                    const erro = new Error('new row violates row-level security policy for table "pedidos"');
                    erro.code = "42501";   // como o Postgres responde
                    throw erro;
                }
            }
        });

        await page.locator('#pedidosTableBody [data-pedido="101"]').click();
        await page.locator("#btnCancelarPedido").click();
        await page.locator(".swal2-confirm").click();

        const popup = page.locator(".swal2-popup");
        await expect(popup).toContainText("Não foi possível cancelar o pedido");
        await expect(popup).not.toContainText("row-level");
    });
});
