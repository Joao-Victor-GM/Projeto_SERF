// Benchmark da Home com volume realista (não roda no CI):
//   npm run test:desempenho
// Mede o tempo de CPU no navegador das interações mais frequentes. Os números
// variam por máquina: compare sempre antes x depois na mesma máquina.

import { test, expect } from "@playwright/test";
import { simularSupabase } from "../e2e/supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "../e2e/dados.mjs";

const PEDIDOS = 3000;
const MENSAGENS = 2000;
const DIA = 86400000;
const STATUS = ["PENDENTE", "CONFIRMADO", "EM_SEPARACAO", "ENVIADO", "ENTREGUE", "CANCELADO"];

function volume() {
    const tabelas = criarTabelas();
    const modelo = tabelas.pedidos_painel[0];

    tabelas.pedidos_painel = Array.from({ length: PEDIDOS }, (_, i) => {
        const data = new Date(Date.now() - (i % 85) * DIA - i * 1000).toISOString();
        const venda = i % 2 === 0;
        return {
            ...modelo,
            id_pedido: 10000 + i,
            id_usuario: venda ? 2 + (i % 40) : 1,
            id_fornecedor: venda ? 1 : 2 + (i % 40),
            status_pedido: STATUS[i % STATUS.length],
            data_pedido: data,
            data_atualizacao: data,
            nome_produto: `Produto ${i % 300}`,
            fornecedor_razao_social: `Fornecedor ${i % 40}`,
            fornecedor_nome_fantasia: `Fornecedor ${i % 40}`,
            comprador_nome: `Cliente ${i % 40}`,
            sou_comprador: !venda,
            sou_fornecedor: venda
        };
    });

    tabelas.mensagens_pedidos = Array.from({ length: MENSAGENS }, (_, i) => ({
        id: `m${i}`,
        id_pedido: 10000 + (i % 600),
        id_remetente: i % 3 === 0 ? EMPRESA.id : "00000000-0000-0000-0000-0000000000cc",
        texto: `Mensagem ${i}`,
        lida: i % 4 !== 0,
        data_envio: new Date(Date.now() - i * 60000).toISOString()
    }));

    tabelas.oportunidades = [];
    return tabelas;
}

// Mede o trabalho síncrono disparado por uma função dentro da página
async function medir(page, rotulo, acao, repeticoes = 5) {
    const tempos = [];
    for (let i = 0; i < repeticoes; i++) {
        tempos.push(await page.evaluate(acao));
    }
    tempos.sort((a, b) => a - b);
    const mediana = tempos[Math.floor(tempos.length / 2)];
    console.log(`${rotulo.padEnd(46)} mediana ${mediana.toFixed(1).padStart(7)} ms`);
    return mediana;
}

test("Home com 3.000 pedidos e 2.000 mensagens", async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await simularSupabase(page, { usuario: EMPRESA, tabelas: volume() });

    const inicio = Date.now();
    await page.goto("/pages/app/home.html");
    await expect(page.locator("#pedidosTableBody tr").first()).toContainText("#");
    console.log(`\n${"carga inicial (até a tabela aparecer)".padEnd(46)} total   ${String(Date.now() - inicio).padStart(7)} ms`);

    await page.locator("#filtroPeriodo").selectOption("90");

    // Soma o trabalho síncrono das 10 teclas + o que roda depois (debounce),
    // para comparar de forma justa com a versão sem debounce.
    await medir(page, "busca: digitar 10 caracteres (10 eventos)", async () => {
        // A Home é ES module: as funções internas vêm do próprio módulo
        // (mesma URL = mesma instância que a página está usando)
        const { atualizarListagem } = await import(new URL("../../js/home/dashboard.js", location.href).href);
        const campo = document.getElementById("buscaGlobal");
        const esperar = ms => new Promise(resolver => setTimeout(resolver, ms));

        const t0 = performance.now();
        for (const parcial of ["p", "pr", "pro", "prod", "produ", "produt", "produto", "produto ", "produto 1", "produto 12"]) {
            campo.value = parcial;
            campo.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const sincrono = performance.now() - t0;
        await esperar(400);

        // o trabalho que o debounce faz uma vez, com o termo final
        const t1 = performance.now();
        atualizarListagem();
        const adiado = performance.now() - t1;

        campo.value = "";
        campo.dispatchEvent(new Event("input", { bubbles: true }));
        await esperar(400);

        return sincrono + adiado;
    });

    await medir(page, "filtro de status (1 troca)", () => {
        const select = document.getElementById("filtroStatus");
        const t0 = performance.now();
        select.value = select.value === "todos" ? "aberto" : "todos";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return performance.now() - t0;
    });

    await medir(page, "alternar modo Comprar/Vender (ida e volta)", () => {
        const t0 = performance.now();
        document.querySelector('.modo-btn[data-mode="vender"]').click();
        document.querySelector('.modo-btn[data-mode="comprar"]').click();
        return performance.now() - t0;
    });

    await medir(page, "evento Realtime: status de 1 pedido mudou", async () => {
        const { pedidosCache, aplicarStatusPedido } = await import(new URL("../../js/home/estado.js", location.href).href);
        const { atualizarDashboard } = await import(new URL("../../js/home/dashboard.js", location.href).href);
        const t0 = performance.now();
        // mesmo caminho do canal "pedidos-painel" (tempo-real.js)
        const pedido = pedidosCache.find(item => item.id === 10001);
        aplicarStatusPedido(pedido, { status_pedido: "CONFIRMADO", data_atualizacao: new Date().toISOString() });
        atualizarDashboard();
        return performance.now() - t0;
    });

    await medir(page, "chat: 300 mensagens chegando uma a uma", async () => {
        const { pedidosCache } = await import(new URL("../../js/home/estado.js", location.href).href);
        const { chat, adicionarMensagens } = await import(new URL("../../js/home/chat.js", location.href).href);
        chat.pedido = pedidosCache.find(item => item.id === 10000);
        chat.mensagens = new Map();
        const t0 = performance.now();
        for (let i = 0; i < 300; i++) {
            adicionarMensagens([{ id: `x${i}`, id_pedido: 10000, id_remetente: "outro", texto: `oi ${i}`, lida: false, data_envio: new Date(Date.now() + i * 1000).toISOString() }]);
        }
        const t = performance.now() - t0;
        chat.mensagens = new Map();
        return t;
    }, 3);
});
