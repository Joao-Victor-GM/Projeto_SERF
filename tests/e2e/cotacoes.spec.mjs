// Cotação reversa (cotacoes.html, migration 024). A EMPRESA de teste é
// "Ambos": compra (id_usuario 1) e vende (id_fornecedor 1).

import { test, expect } from "@playwright/test";
import { simularSupabase, errosRelevantes } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const PAGINA = "/pages/app/cotacoes.html";
const emDias = dias => new Date(Date.now() + dias * 86400000).toISOString();

const proposta = (id, fornecedor, preco, extras = {}) => ({
    id_proposta: id, id_cotacao: 10, id_fornecedor: id + 100, id_produto: id + 200,
    fornecedor_nome: fornecedor, produto_nome: `Chapa de ${fornecedor}`, preco_unitario: preco,
    prazo_entrega_dias: 3, observacao: null, status: "ENVIADA", criada_em: emDias(-1), atualizada_em: emDias(-1), ...extras
});

function tabelasComCotacoes() {
    const tabelas = criarTabelas();
    tabelas.cotacoes = [
        {   // minha (comprador), com 2 propostas
            id_cotacao: 10, id_usuario: 1, comprador_nome: "Atacadão Ambos LTDA", titulo: "Chapa de aço 2mm",
            descricao: "Galvanizada, entrega em Curitiba", categoria: "Metalurgia & Usinagem", quantidade: 20, unidade: "un.",
            preco_alvo: 40, valida_ate: emDias(5), status: "ABERTA", id_proposta_aceita: null, criada_em: emDias(-2),
            propostas: [proposta(1, "Aços Sul", 41.5), proposta(2, "Metalúrgica Norte", 38, { observacao: "Frete incluso" })]
        },
        {   // de outro comprador (eu como fornecedor)
            id_cotacao: 20, id_usuario: 2, comprador_nome: "Mercado Bom Preço", titulo: "Arroz tipo 1",
            descricao: null, categoria: "Alimentos & Bebidas", quantidade: 300, unidade: "kg",
            preco_alvo: null, valida_ate: emDias(2), status: "ABERTA", id_proposta_aceita: null, criada_em: emDias(-1)
        },
        {
            id_cotacao: 30, id_usuario: 3, comprador_nome: "Oficina Central", titulo: "Parafuso M8",
            descricao: null, categoria: "Metalurgia & Usinagem", quantidade: 1000, unidade: "un.",
            preco_alvo: 0.5, valida_ate: emDias(9), status: "ABERTA", id_proposta_aceita: null, criada_em: emDias(-1)
        }
    ];
    return tabelas;
}

function rpc() {
    return {
        publicar_cotacao: (corpo, tabelas) => {
            const nova = { id_cotacao: 99, id_usuario: 1, comprador_nome: "Atacadão Ambos LTDA", titulo: corpo.p_titulo,
                descricao: corpo.p_descricao, categoria: corpo.p_categoria, quantidade: corpo.p_quantidade, unidade: corpo.p_unidade,
                preco_alvo: corpo.p_preco_alvo, valida_ate: emDias(corpo.p_dias_validade), status: "ABERTA", criada_em: new Date().toISOString(), propostas: [] };
            tabelas.cotacoes.unshift(nova);
            return nova;
        },
        aceitar_proposta: () => 777,
        enviar_proposta: (corpo, tabelas) => {
            const gravada = { ...proposta(50, "Atacadão Ambos", corpo.p_preco_unitario), id_cotacao: corpo.p_id_cotacao,
                id_fornecedor: 1, id_produto: corpo.p_id_produto, produto_nome: "Arroz Tipo 1 5kg",
                prazo_entrega_dias: corpo.p_prazo_entrega_dias, observacao: corpo.p_observacao };
            tabelas.propostas.push(gravada);
            return gravada;
        },
        retirar_proposta: (corpo, tabelas) => { tabelas.propostas.forEach(p => { p.status = "RETIRADA"; }); return null; }
    };
}

async function abrir(page, { tabelas = tabelasComCotacoes(), caminho = PAGINA } = {}) {
    const mock = await simularSupabase(page, { usuario: EMPRESA, tabelas, rpc: rpc() });
    await page.goto(caminho);
    await expect(page.locator("#cotStatus")).toBeHidden();
    return { ...mock, tabelas };
}

test("comprador: compara propostas (menor preço em destaque) e aceita → vai ao pedido criado", async ({ page }) => {
    const { chamadas, errosDaPagina } = await abrir(page);

    await expect(page.locator("#cotAbas")).toBeVisible();     // Ambos: as duas abas
    const cartao = page.locator("#cot-10");
    await expect(cartao).toContainText("Recebendo propostas");
    await expect(cartao).toContainText("20 un. · preço-alvo R$");

    const propostas = cartao.locator(".cot-proposta");
    await expect(propostas).toHaveCount(2);
    await expect(propostas.first()).toContainText("Metalúrgica Norte");     // ordenadas por preço
    await expect(propostas.first()).toContainText("Menor preço");
    await expect(propostas.first()).toContainText("Total R$ 760,00");
    await expect(propostas.first()).toContainText("Frete incluso");

    await propostas.first().getByRole("button", { name: "Aceitar" }).click();
    await page.getByRole("button", { name: "Aceitar e criar pedido" }).click();

    await expect(page).toHaveURL(/home\.html\?pedido=777/);
    expect(chamadas.find(c => c.nome === "aceitar_proposta").corpo).toEqual({ p_id_proposta: 2 });
    expect(errosRelevantes(errosDaPagina)).toEqual([]);
});

test("comprador: publicar cotação (validação, segmentos da lista oficial, envio)", async ({ page }) => {
    const { chamadas } = await abrir(page);
    const form = page.locator("#formCotacao");

    await expect(form.locator("#cotCategoria option")).toHaveCount(8);   // "Selecione" + 7 segmentos
    await form.getByRole("button", { name: "Publicar cotação" }).click();
    await expect(page.locator("#cotErroForm")).toHaveText("Descreva o que você precisa.");
    await expect(page.locator("#cotTitulo")).toBeFocused();

    await page.locator("#cotTitulo").fill("Embalagem caixa 30x30");
    await page.locator("#cotCategoria").selectOption("Embalagens & Logística");
    await page.locator("#cotQuantidade").fill("500");
    await page.locator("#cotUnidade").selectOption("cx");
    await page.locator("#cotPrecoAlvo").fill("2,50");
    await page.locator("#cotDias").selectOption("15");
    await form.getByRole("button", { name: "Publicar cotação" }).click();

    await expect(page.locator("#cot-99")).toContainText("Embalagem caixa 30x30");
    await expect(page.locator("#cot-99")).toContainText("Nenhuma proposta ainda");
    expect(chamadas.find(c => c.nome === "publicar_cotacao").corpo).toEqual({
        p_titulo: "Embalagem caixa 30x30", p_categoria: "Embalagens & Logística", p_quantidade: 500, p_unidade: "cx",
        p_descricao: null, p_preco_alvo: 2.5, p_dias_validade: 15
    });
});

test("fornecedor: vê as cotações abertas de OUTROS compradores e envia proposta", async ({ page }) => {
    const { chamadas } = await abrir(page);
    await page.getByRole("tab", { name: "Responder cotações" }).click();

    const lista = page.locator("#listaAbertas");
    await expect(lista.locator(".cot-item")).toHaveCount(2);              // a própria (#10) fica de fora
    await expect(lista).not.toContainText("Chapa de aço 2mm");

    const arroz = page.locator("#cot-20");
    await expect(arroz).toContainText("Mercado Bom Preço · 300 kg");
    await arroz.getByRole("button", { name: "Enviar proposta" }).click();

    // Produto com estoque menor que a quantidade aparece desabilitado
    await expect(arroz.locator('option:has-text("Feijão Carioca 1kg")')).toHaveAttribute("disabled", "");
    await arroz.locator('select[name="produto"]').selectOption({ label: "Arroz Tipo 1 5kg — estoque 500" });
    await arroz.locator('input[name="preco"]').fill("23,90");
    await arroz.locator('input[name="prazo"]').fill("4");
    await arroz.getByRole("button", { name: "Enviar proposta" }).click();

    await expect(arroz).toContainText("Sua proposta: R$ 23,90/un.");
    await expect(arroz.getByRole("button", { name: "Atualizar proposta" })).toBeVisible();
    expect(chamadas.find(c => c.nome === "enviar_proposta").corpo).toEqual({
        p_id_cotacao: 20, p_id_produto: 10, p_preco_unitario: 23.9, p_prazo_entrega_dias: 4, p_observacao: null
    });
});

test("fornecedor: filtro por segmento consulta o servidor", async ({ page }) => {
    const { chamadas } = await abrir(page);
    await page.getByRole("tab", { name: "Responder cotações" }).click();

    await page.locator("#cotFiltroSegmento").selectOption("Metalurgia & Usinagem");
    await expect(page.locator("#listaAbertas .cot-item")).toHaveCount(1);
    await expect(page.locator("#listaAbertas")).toContainText("Parafuso M8");

    const consulta = chamadas.filter(c => c.tabela === "cotacoes").at(-1);
    expect(consulta.parametros).toContainEqual(["categoria", "in.(Metalurgia & Usinagem)"]);
    expect(consulta.parametros).toContainEqual(["status", "eq.ABERTA"]);
});

test("link do sino/e-mail (?cotacao=ID) abre a cotação certa na aba certa", async ({ page }) => {
    await abrir(page, { caminho: `${PAGINA}?cotacao=30` });

    await expect(page.getByRole("tab", { name: "Responder cotações" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#cot-30")).toHaveClass(/destaque/);
    await expect(page.locator('#cot-30 select[name="produto"]')).toBeFocused();
});

test("menu lateral tem 'Cotações' em todas as páginas internas", async ({ page }) => {
    await abrir(page);
    await expect(page.locator('#sidebar a[data-page="cotacoes"]')).toHaveAttribute("aria-current", "page");

    await page.locator('#sidebar a[data-page="relatorios"]').click();
    await expect(page.locator('#sidebar a[data-page="cotacoes"]')).toHaveAttribute("href", "cotacoes.html");
});

test("celular: sem rolagem lateral", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await abrir(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
