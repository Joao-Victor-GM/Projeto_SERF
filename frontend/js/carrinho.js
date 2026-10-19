/* ==========================================================
   S.E.R.F. — CARRINHO.JS
   O comprador junta produtos de vários fornecedores e envia
   tudo de uma vez (RPC criar_compra, migration 018: um pedido
   por produto, todos na mesma transação).

   O carrinho fica no localStorage do navegador, por usuário
   (sobrevive a recarregar a página; não é dado crítico).

   API: SERFCarrinho.adicionar(produto, quantidade?) · itens()
   Evento: "serf:carrinho" (window) a cada mudança.
   Depende de: utils.js, ui/avisos.js, dados/base.js,
   dados/pedidos.repositorio.js
   ========================================================== */

"use strict";

(function () {

    const { escaparHTML, formatarMoeda } = window.SERFUtils;

    let chave = null;        // "serf-carrinho-<auth uid>"
    let itens = [];          // [{ id_produto, id_fornecedor, nome, fornecedor, preco, minimo, estoque, quantidade }]
    let podeComprar = false; // só empresas com papel de comprador

    /* ---------------- ESTADO ---------------- */

    function ler() {
        try { return JSON.parse(localStorage.getItem(chave) || "[]"); } catch { return []; }
    }

    function salvar() {
        try { localStorage.setItem(chave, JSON.stringify(itens)); } catch { /* modo privado: só na memória */ }
        window.dispatchEvent(new CustomEvent("serf:carrinho", { detail: { quantidade: itens.length } }));
        renderizar();
    }

    const limitar = (valor, item) =>
        Math.min(Math.max(Math.round(Number(valor) || 0), item.minimo), Math.max(item.minimo, item.estoque));

    // produto: linha do catálogo (produtos + fornecedores_publicos)
    function adicionar(produto, quantidade) {
        if (!podeComprar) {
            window.SERFAvisos.info("Carrinho de compras", "Só empresas com perfil de compradora podem fazer pedidos.");
            return false;
        }

        const fornecedor = Array.isArray(produto.fornecedores) ? produto.fornecedores[0] : produto.fornecedores;
        const existente = itens.find(item => item.id_produto === produto.id_produto);

        if (existente) {
            existente.quantidade = limitar(existente.quantidade + existente.minimo, existente);
        } else {
            const item = {
                id_produto: produto.id_produto,
                id_fornecedor: produto.id_fornecedor,
                nome: produto.nome_produto,
                fornecedor: fornecedor?.nome_fantasia || fornecedor?.razao_social || "Fornecedor",
                preco: Number(produto.preco_atacado) || 0,
                minimo: Math.max(1, Number(produto.quantidade_minima) || 1),
                estoque: Number(produto.quantidade_estoque) || 0
            };
            item.quantidade = limitar(quantidade ?? item.minimo, item);
            itens.push(item);
        }

        salvar();
        window.SERFAvisos.sucesso("Adicionado ao carrinho", produto.nome_produto);
        return true;
    }

    function remover(idProduto) {
        itens = itens.filter(item => item.id_produto !== idProduto);
        salvar();
    }

    function definirQuantidade(idProduto, quantidade) {
        const item = itens.find(i => i.id_produto === idProduto);
        if (!item) return;
        item.quantidade = limitar(quantidade, item);
        salvar();
    }

    const total = () => itens.reduce((soma, item) => soma + item.preco * item.quantidade, 0);


    /* ---------------- INTERFACE ---------------- */

    let botao, painel, lista, rodape;

    function criarInterface() {
        botao = document.createElement("button");
        botao.type = "button";
        botao.className = "carrinho-botao";
        botao.id = "carrinhoBotao";
        botao.setAttribute("aria-haspopup", "dialog");
        botao.setAttribute("aria-controls", "carrinhoPainel");
        botao.hidden = true;
        botao.addEventListener("click", abrir);

        painel = document.createElement("aside");
        painel.className = "carrinho-painel";
        painel.id = "carrinhoPainel";
        painel.setAttribute("role", "dialog");
        painel.setAttribute("aria-modal", "true");
        painel.setAttribute("aria-labelledby", "carrinhoTitulo");
        painel.hidden = true;
        painel.innerHTML = `
            <header class="carrinho-cabecalho">
                <h2 id="carrinhoTitulo">Carrinho de compras</h2>
                <button type="button" class="carrinho-fechar" aria-label="Fechar carrinho">×</button>
            </header>
            <div class="carrinho-lista" id="carrinhoLista"></div>
            <footer class="carrinho-rodape" id="carrinhoRodape"></footer>`;

        painel.querySelector(".carrinho-fechar").addEventListener("click", fechar);
        painel.addEventListener("keydown", evento => { if (evento.key === "Escape") fechar(); });

        lista = painel.querySelector("#carrinhoLista");
        rodape = painel.querySelector("#carrinhoRodape");

        lista.addEventListener("change", evento => {
            const campo = evento.target.closest("[data-quantidade]");
            if (campo) definirQuantidade(Number(campo.dataset.quantidade), campo.value);
        });

        lista.addEventListener("click", evento => {
            const remocao = evento.target.closest("[data-remover]");
            if (remocao) remover(Number(remocao.dataset.remover));
        });

        document.body.append(botao, painel);
    }

    function renderizar() {
        if (!botao) return;

        const quantidade = itens.length;
        botao.hidden = !podeComprar || quantidade === 0;
        botao.innerHTML = `🛒 <span>Carrinho</span> <strong>${quantidade}</strong>`;
        botao.setAttribute("aria-label", `Carrinho: ${quantidade} produto${quantidade === 1 ? "" : "s"}`);

        if (quantidade === 0) {
            lista.innerHTML = `<p class="carrinho-vazio">Seu carrinho está vazio. Adicione produtos pelo catálogo.</p>`;
            rodape.innerHTML = "";
            return;
        }

        // Agrupado por fornecedor: cada grupo vira pedidos para aquele fornecedor
        const grupos = new Map();
        itens.forEach(item => {
            if (!grupos.has(item.fornecedor)) grupos.set(item.fornecedor, []);
            grupos.get(item.fornecedor).push(item);
        });

        lista.innerHTML = [...grupos.entries()].map(([fornecedor, doGrupo]) => `
            <section class="carrinho-grupo">
                <h3>${escaparHTML(fornecedor)}</h3>
                ${doGrupo.map(item => `
                    <div class="carrinho-item">
                        <div class="carrinho-item-info">
                            <strong>${escaparHTML(item.nome)}</strong>
                            <small>${escaparHTML(formatarMoeda(item.preco))}/un. · mín. ${item.minimo} · ${item.estoque} em estoque</small>
                        </div>
                        <label class="carrinho-quantidade">
                            <span class="sr-only">Quantidade de ${escaparHTML(item.nome)}</span>
                            <input type="number" min="${item.minimo}" max="${Math.max(item.minimo, item.estoque)}" step="1"
                                   value="${item.quantidade}" data-quantidade="${item.id_produto}">
                        </label>
                        <strong class="carrinho-subtotal">${escaparHTML(formatarMoeda(item.preco * item.quantidade))}</strong>
                        <button type="button" class="carrinho-remover" data-remover="${item.id_produto}"
                                aria-label="Remover ${escaparHTML(item.nome)}">Remover</button>
                    </div>`).join("")}
            </section>`).join("");

        const fornecedores = grupos.size;
        rodape.innerHTML = `
            <label class="carrinho-observacao">
                <span>Observação para os fornecedores (opcional)</span>
                <textarea id="carrinhoObservacao" maxlength="500" rows="2" placeholder="Ex.: entregar pela manhã"></textarea>
            </label>
            <div class="carrinho-total">
                <span>${quantidade} produto${quantidade === 1 ? "" : "s"} · ${fornecedores} fornecedor${fornecedores === 1 ? "" : "es"}</span>
                <strong>${escaparHTML(formatarMoeda(total()))}</strong>
            </div>
            <button type="button" class="btn-primary carrinho-enviar" id="carrinhoEnviar">
                Enviar ${quantidade === 1 ? "pedido" : `${quantidade} pedidos`}
            </button>
            <small class="carrinho-nota">Cada fornecedor confirma o próprio pedido; o pagamento é liberado após a confirmação.</small>`;

        rodape.querySelector("#carrinhoEnviar").addEventListener("click", enviar);
    }

    let focoAnterior = null;

    function abrir() {
        focoAnterior = document.activeElement;
        painel.hidden = false;
        painel.querySelector(".carrinho-fechar").focus();
    }

    function fechar() {
        painel.hidden = true;
        (focoAnterior || botao)?.focus?.();
    }

    async function enviar() {
        const botaoEnviar = rodape.querySelector("#carrinhoEnviar");
        const observacao = rodape.querySelector("#carrinhoObservacao")?.value.trim();

        botaoEnviar.disabled = true;
        botaoEnviar.textContent = "Enviando...";

        try {
            const criados = await window.SERFDados.pedidos.criarCompra(
                itens.map(item => ({ id_produto: item.id_produto, quantidade: item.quantidade })),
                observacao
            );

            const fornecedores = new Set(itens.map(item => item.fornecedor)).size;
            itens = [];
            salvar();
            fechar();

            window.SERFAvisos.sucesso(
                criados.length === 1 ? "Pedido enviado" : `${criados.length} pedidos enviados`,
                `${fornecedores === 1 ? "O fornecedor foi avisado" : `${fornecedores} fornecedores foram avisados`}. Acompanhe na Home.`
            );

            // Home: a lista de pedidos recarrega na hora
            window.dispatchEvent(new CustomEvent("serf:pedido-criado"));
        } catch (erro) {
            // Nada foi criado (transação única); o erro diz qual produto falhou
            await window.SERFAvisos.erro("Os pedidos não foram enviados", erro);
            botaoEnviar.disabled = false;
            renderizar();
        }
    }


    /* ---------------- INÍCIO ---------------- */

    async function iniciar() {
        if (!(await window.serfSessao)) return;

        const empresa = await window.SERFUtils.obterEmpresaLogada().catch(() => null);
        if (!empresa) return;

        chave = `serf-carrinho-${empresa.authUserId}`;
        podeComprar = empresa.idUsuario !== null;
        itens = podeComprar ? ler() : [];

        criarInterface();
        renderizar();
        window.dispatchEvent(new CustomEvent("serf:carrinho-pronto"));
    }

    window.SERFCarrinho = Object.freeze({
        adicionar,
        remover,
        definirQuantidade,
        itens: () => itens.map(item => ({ ...item })),
        podeComprar: () => podeComprar,
        abrir: () => painel && abrir()
    });

    iniciar();
})();
