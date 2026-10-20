/* =========================================================================
   S.E.R.F. — COTAÇÕES (cotacoes.js)
   Cotação reversa (migration 024):
   - Comprador: publica o que precisa, compara as propostas e aceita uma
     (vira pedido).
   - Fornecedor: vê as cotações abertas (filtro por segmento) e envia,
     atualiza ou retira a própria proposta.
   As regras ficam no banco (RPCs); aqui só a tela.
   ?cotacao=ID (links do sino e dos e-mails) abre direto a cotação.
   ========================================================================= */

"use strict";

(function () {

    const { escaparHTML, formatarMoeda, CATEGORIAS_PRODUTO } = window.SERFUtils;
    const dados = () => window.SERFDados.cotacoes;
    const el = id => document.getElementById(id);

    const estado = {
        empresa: null,
        aba: "comprar",
        minhas: [],
        abertas: [],
        minhasPropostas: new Map(),   // id_cotacao → proposta
        produtos: [],
        segmentos: [],
        filtro: "",
        aberta: null,                 // cotação com o formulário de proposta aberto
        alvo: Number(new URLSearchParams(location.search).get("cotacao")) || null
    };

    const UM_DIA = 86400000;

    /* ---------------- FORMATAÇÃO ---------------- */

    function prazoRestante(validaAte) {
        const dias = Math.ceil((new Date(validaAte) - Date.now()) / UM_DIA);
        if (dias <= 0) return "prazo encerrado";
        if (dias === 1) return "fecha em até 1 dia";
        return `fecha em ${dias} dias`;
    }

    const recebendo = c => c.status === "ABERTA" && new Date(c.valida_ate) > Date.now();

    function seloDaCotacao(c) {
        if (c.status === "FECHADA") return ["fechada", "Fechada"];
        if (c.status === "CANCELADA") return ["cancelada", "Cancelada"];
        if (!recebendo(c)) return ["escolher", "Prazo encerrado: escolha uma proposta"];
        return ["aberta", "Recebendo propostas"];
    }

    const quantidade = c => `${c.quantidade.toLocaleString("pt-BR")} ${escaparHTML(c.unidade)}`;

    function resumo(c, { comComprador = false } = {}) {
        return [
            comComprador ? `<strong>${escaparHTML(c.comprador_nome)}</strong>` : null,
            quantidade(c),
            c.preco_alvo ? `preço-alvo ${formatarMoeda(c.preco_alvo)}/un.` : null,
            escaparHTML(prazoRestante(c.valida_ate))
        ].filter(Boolean).join(" · ");
    }

    function cabecalho(c, extras = {}) {
        const [classe, texto] = seloDaCotacao(c);
        return `
            <header class="cot-item-topo">
                <div>
                    <span class="cot-categoria">${escaparHTML(c.categoria)}</span>
                    <h3>${escaparHTML(c.titulo)}</h3>
                    <p class="cot-resumo">${resumo(c, extras)}</p>
                </div>
                <span class="cot-selo ${classe}">${escaparHTML(texto)}</span>
            </header>
            ${c.descricao ? `<p class="cot-descricao">${escaparHTML(c.descricao)}</p>` : ""}`;
    }

    /* ---------------- COMPRADOR ---------------- */

    function propostaDoComprador(c, p, menor) {
        const aceitar = c.status === "ABERTA" && p.status === "ENVIADA";
        const total = p.preco_unitario * c.quantidade;
        const selo = p.status === "ACEITA" ? `<span class="cot-selo fechada">Aceita</span>`
            : p.status === "RECUSADA" ? `<span class="cot-selo cancelada">Não escolhida</span>`
            : p.id_proposta === menor ? `<span class="cot-selo melhor">Menor preço</span>` : "";

        return `
            <li class="cot-proposta${p.status === "RECUSADA" ? " apagada" : ""}">
                <div>
                    <strong>${escaparHTML(p.fornecedor_nome)}</strong> ${selo}
                    <p>${escaparHTML(p.produto_nome)} · entrega em ${p.prazo_entrega_dias} dia${p.prazo_entrega_dias === 1 ? "" : "s"}</p>
                    ${p.observacao ? `<p class="cot-obs">“${escaparHTML(p.observacao)}”</p>` : ""}
                </div>
                <div class="cot-preco">
                    <strong>${formatarMoeda(p.preco_unitario)}/un.</strong>
                    <small>Total ${formatarMoeda(total)}</small>
                    ${aceitar ? `<button type="button" class="btn-primary" data-aceitar="${p.id_proposta}">Aceitar</button>` : ""}
                </div>
            </li>`;
    }

    function cartaoDoComprador(c) {
        const propostas = (c.propostas || [])
            .filter(p => p.status !== "RETIRADA")
            .sort((a, b) => a.preco_unitario - b.preco_unitario);
        const ativas = propostas.filter(p => p.status === "ENVIADA");
        const menor = ativas.length > 1 ? ativas[0].id_proposta : null;

        const lista = propostas.length
            ? `<ol class="cot-propostas">${propostas.map(p => propostaDoComprador(c, p, menor)).join("")}</ol>`
            : `<p class="cot-vazio">${recebendo(c) ? "Nenhuma proposta ainda. Os fornecedores do segmento já foram avisados." : "Nenhuma proposta recebida."}</p>`;

        return `
            <article class="cot-cartao cot-item" id="cot-${c.id_cotacao}" data-cotacao="${c.id_cotacao}">
                ${cabecalho(c)}
                <h4>Propostas (${propostas.length})</h4>
                ${lista}
                ${c.status === "FECHADA" ? `<p class="cot-dica">A proposta aceita virou um pedido: acompanhe em <a href="home.html#pedidos">Pedidos</a>.</p>` : ""}
                ${c.status === "ABERTA" ? `<footer class="cot-rodape"><button type="button" class="btn-secondary" data-cancelar="${c.id_cotacao}">Cancelar cotação</button></footer>` : ""}
            </article>`;
    }

    function renderizarMinhas() {
        el("listaMinhas").innerHTML = estado.minhas.length
            ? estado.minhas.map(cartaoDoComprador).join("")
            : `<p class="cot-vazio">Você ainda não publicou cotações. Use o formulário acima quando não achar o que precisa no catálogo.</p>`;
    }

    async function publicar(evento) {
        evento.preventDefault();
        const erro = el("cotErroForm");
        erro.textContent = "";

        const cotacao = {
            titulo: el("cotTitulo").value.trim(),
            categoria: el("cotCategoria").value,
            quantidade: Number(el("cotQuantidade").value),
            unidade: el("cotUnidade").value,
            precoAlvo: el("cotPrecoAlvo").value.trim() ? Number(el("cotPrecoAlvo").value.replace(/\./g, "").replace(",", ".")) : null,
            dias: Number(el("cotDias").value),
            descricao: el("cotDescricao").value.trim()
        };

        if (cotacao.titulo.length < 3) return mostrarErro(erro, "Descreva o que você precisa.", "cotTitulo");
        if (!cotacao.categoria) return mostrarErro(erro, "Escolha o segmento.", "cotCategoria");
        if (!Number.isInteger(cotacao.quantidade) || cotacao.quantidade < 1) return mostrarErro(erro, "Informe a quantidade (número inteiro).", "cotQuantidade");
        if (cotacao.precoAlvo !== null && !(cotacao.precoAlvo > 0)) return mostrarErro(erro, "Preço-alvo inválido.", "cotPrecoAlvo");

        const botao = el("btnPublicar");
        botao.disabled = true;
        try {
            await dados().publicar(cotacao);
            evento.target.reset();
            window.SERFAvisos?.sucesso("Cotação publicada", "Os fornecedores do segmento foram avisados.");
            await carregarMinhas();
        } catch (falha) {
            erro.textContent = window.SERFUtils.mensagemDeErro(falha);
        } finally {
            botao.disabled = false;
        }
    }

    function mostrarErro(alvo, texto, campo) {
        alvo.textContent = texto;
        el(campo)?.focus();
    }

    async function aceitar(idProposta) {
        const cotacao = estado.minhas.find(c => (c.propostas || []).some(p => p.id_proposta === idProposta));
        const proposta = cotacao?.propostas.find(p => p.id_proposta === idProposta);
        if (!proposta) return;

        const ok = await window.SERFAvisos.confirmar({
            titulo: `Aceitar a proposta de ${proposta.fornecedor_nome}?`,
            texto: `Vira um pedido de ${cotacao.quantidade} ${cotacao.unidade} por ${formatarMoeda(proposta.preco_unitario * cotacao.quantidade)}. As outras propostas serão recusadas.`,
            botao: "Aceitar e criar pedido"
        });
        if (!ok) return;

        try {
            const idPedido = await dados().aceitarProposta(idProposta);
            window.location.href = `home.html?pedido=${encodeURIComponent(idPedido)}`;
        } catch (falha) {
            await window.SERFAvisos.erro("Não foi possível aceitar a proposta", falha);
            await carregarMinhas();
        }
    }

    async function cancelar(idCotacao) {
        const ok = await window.SERFAvisos.confirmar({
            titulo: "Cancelar esta cotação?",
            texto: "Ela sai do ar e as propostas recebidas são recusadas.",
            botao: "Cancelar cotação",
            cancelar: "Manter",
            perigo: true
        });
        if (!ok) return;

        try {
            await dados().cancelar(idCotacao);
            await carregarMinhas();
        } catch (falha) {
            await window.SERFAvisos.erro("Não foi possível cancelar", falha);
        }
    }

    /* ---------------- FORNECEDOR ---------------- */

    function formularioDeProposta(c, minha) {
        const opcoes = estado.produtos.map(p => {
            const falta = p.quantidade_estoque < c.quantidade;
            const selecionado = minha?.id_produto === p.id_produto ? " selected" : "";
            return `<option value="${p.id_produto}"${falta ? " disabled" : ""}${selecionado}>${escaparHTML(p.nome_produto)} — estoque ${p.quantidade_estoque.toLocaleString("pt-BR")}${falta ? " (insuficiente)" : ""}</option>`;
        }).join("");

        if (!estado.produtos.length) {
            return `<p class="cot-vazio">Cadastre um produto no <a href="catalogo.html">catálogo</a> para enviar propostas.</p>`;
        }

        return `
            <form class="cot-form-proposta" data-proposta-form="${c.id_cotacao}" novalidate>
                <div class="cot-grade">
                    <label class="cot-campo cot-campo-largo">
                        <span>Produto do seu catálogo *</span>
                        <select name="produto" required><option value="">Selecione...</option>${opcoes}</select>
                    </label>
                    <label class="cot-campo">
                        <span>Preço por ${escaparHTML(c.unidade)} *</span>
                        <input name="preco" inputmode="decimal" required placeholder="R$" value="${minha ? String(minha.preco_unitario).replace(".", ",") : ""}">
                    </label>
                    <label class="cot-campo">
                        <span>Entrega em (dias) *</span>
                        <input name="prazo" type="number" min="1" max="365" step="1" required value="${minha?.prazo_entrega_dias ?? ""}">
                    </label>
                    <label class="cot-campo cot-campo-largo">
                        <span>Observação (opcional)</span>
                        <input name="observacao" maxlength="500" value="${escaparHTML(minha?.observacao ?? "")}">
                    </label>
                </div>
                <p class="cot-erro" role="alert"></p>
                <div class="cot-acoes">
                    <button type="button" class="btn-secondary" data-fechar-proposta>Voltar</button>
                    <button type="submit" class="btn-primary">${minha?.status === "ENVIADA" ? "Atualizar proposta" : "Enviar proposta"}</button>
                </div>
            </form>`;
    }

    function cartaoDoFornecedor(c) {
        const minha = estado.minhasPropostas.get(c.id_cotacao);
        const enviada = minha?.status === "ENVIADA";
        const aberto = estado.aberta === c.id_cotacao;

        const situacao = enviada
            ? `<p class="cot-minha">Sua proposta: <strong>${formatarMoeda(minha.preco_unitario)}/un.</strong> · entrega em ${minha.prazo_entrega_dias} dia${minha.prazo_entrega_dias === 1 ? "" : "s"} · ${escaparHTML(minha.produto_nome)}</p>`
            : minha?.status === "RETIRADA" ? `<p class="cot-minha">Você retirou sua proposta.</p>` : "";

        const botoes = aberto ? "" : `
            <footer class="cot-rodape">
                ${enviada ? `<button type="button" class="btn-secondary" data-retirar="${c.id_cotacao}">Retirar proposta</button>` : ""}
                <button type="button" class="btn-primary" data-abrir-proposta="${c.id_cotacao}">${enviada ? "Atualizar proposta" : "Enviar proposta"}</button>
            </footer>`;

        return `
            <article class="cot-cartao cot-item" id="cot-${c.id_cotacao}" data-cotacao="${c.id_cotacao}">
                ${cabecalho(c, { comComprador: true })}
                ${situacao}
                ${aberto ? formularioDeProposta(c, minha) : ""}
                ${botoes}
            </article>`;
    }

    function cotacoesVisiveis() {
        // Empresa "Ambos": as próprias cotações ficam na outra aba
        return estado.abertas.filter(c => c.id_usuario !== estado.empresa?.idUsuario);
    }

    function renderizarAbertas() {
        const lista = cotacoesVisiveis();
        el("listaAbertas").innerHTML = lista.length
            ? lista.map(cartaoDoFornecedor).join("")
            : `<p class="cot-vazio">Nenhuma cotação aberta ${estado.filtro ? "neste filtro" : "agora"}. Você é avisado no sino e por e-mail quando surgir uma no seu segmento.</p>`;

        if (estado.aberta) {
            el(`cot-${estado.aberta}`)?.querySelector("select, input")?.focus();
        }
    }

    async function enviarProposta(form) {
        const idCotacao = Number(form.dataset.propostaForm);
        const erro = form.querySelector(".cot-erro");
        const valor = nome => form.elements[nome].value.trim();
        const proposta = {
            idCotacao,
            idProduto: Number(valor("produto")),
            preco: Number(valor("preco").replace(/\./g, "").replace(",", ".")),
            prazo: Number(valor("prazo")),
            observacao: valor("observacao")
        };

        erro.textContent = "";
        if (!proposta.idProduto) return mostrarErroNoForm(form, erro, "Escolha o produto.", "produto");
        if (!(proposta.preco > 0)) return mostrarErroNoForm(form, erro, "Informe o preço por unidade.", "preco");
        if (!Number.isInteger(proposta.prazo) || proposta.prazo < 1 || proposta.prazo > 365) {
            return mostrarErroNoForm(form, erro, "O prazo de entrega vai de 1 a 365 dias.", "prazo");
        }

        const botao = form.querySelector('[type="submit"]');
        botao.disabled = true;
        try {
            const gravada = await dados().enviarProposta(proposta);
            estado.minhasPropostas.set(idCotacao, gravada);
            estado.aberta = null;
            renderizarAbertas();
            window.SERFAvisos?.sucesso("Proposta enviada", "O comprador foi avisado.");
            el(`cot-${idCotacao}`)?.querySelector("[data-abrir-proposta]")?.focus();
        } catch (falha) {
            erro.textContent = window.SERFUtils.mensagemDeErro(falha);
            botao.disabled = false;
        }
    }

    function mostrarErroNoForm(form, alvo, texto, campo) {
        alvo.textContent = texto;
        form.elements[campo]?.focus();
    }

    async function retirar(idCotacao) {
        const ok = await window.SERFAvisos.confirmar({
            titulo: "Retirar sua proposta?",
            texto: "O comprador não poderá mais aceitá-la. Você pode enviar outra enquanto a cotação estiver aberta.",
            botao: "Retirar",
            cancelar: "Manter",
            perigo: true
        });
        if (!ok) return;

        try {
            await dados().retirarProposta(idCotacao);
            await carregarAbertas();
        } catch (falha) {
            await window.SERFAvisos.erro("Não foi possível retirar", falha);
        }
    }

    /* ---------------- CARREGAMENTO ---------------- */

    async function carregarMinhas() {
        if (!estado.empresa?.idUsuario) return;
        estado.minhas = await dados().minhasCotacoes(estado.empresa.idUsuario);
        renderizarMinhas();
    }

    function segmentosDoFiltro() {
        if (estado.filtro === "__meus") return estado.segmentos;
        return estado.filtro ? [estado.filtro] : [];
    }

    async function carregarAbertas() {
        if (!estado.empresa?.idFornecedor) return;
        const [abertas, propostas] = await Promise.all([
            dados().cotacoesAbertas(segmentosDoFiltro()),
            dados().minhasPropostas(estado.empresa.idFornecedor)
        ]);
        estado.abertas = abertas;
        estado.minhasPropostas = new Map(propostas.map(p => [p.id_cotacao, p]));
        renderizarAbertas();
    }

    /* ---------------- ABAS E EVENTOS ---------------- */

    function mostrarAba(aba) {
        estado.aba = aba;
        document.querySelectorAll("#cotAbas [data-aba]").forEach(botao => {
            const ativa = botao.dataset.aba === aba;
            botao.classList.toggle("active", ativa);
            botao.setAttribute("aria-selected", String(ativa));
            botao.tabIndex = ativa ? 0 : -1;
        });
        el("painelComprar").hidden = aba !== "comprar";
        el("painelVender").hidden = aba !== "vender";
    }

    function configurar() {
        const opcoes = CATEGORIAS_PRODUTO.map(c => `<option value="${escaparHTML(c)}">${escaparHTML(c)}</option>`).join("");
        el("cotCategoria").insertAdjacentHTML("beforeend", opcoes);
        el("cotFiltroSegmento").insertAdjacentHTML("beforeend", opcoes);

        el("formCotacao").addEventListener("submit", publicar);

        el("cotAbas").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-aba]");
            if (botao) mostrarAba(botao.dataset.aba);
        });

        // Setas entre as abas (padrão ARIA de tabs)
        el("cotAbas").addEventListener("keydown", evento => {
            if (!["ArrowLeft", "ArrowRight"].includes(evento.key)) return;
            const proxima = estado.aba === "comprar" ? "vender" : "comprar";
            mostrarAba(proxima);
            el(proxima === "comprar" ? "abaComprar" : "abaVender").focus();
        });

        el("listaMinhas").addEventListener("click", evento => {
            const aceitarBotao = evento.target.closest("[data-aceitar]");
            if (aceitarBotao) return aceitar(Number(aceitarBotao.dataset.aceitar));
            const cancelarBotao = evento.target.closest("[data-cancelar]");
            if (cancelarBotao) return cancelar(Number(cancelarBotao.dataset.cancelar));
        });

        el("listaAbertas").addEventListener("click", evento => {
            const abrir = evento.target.closest("[data-abrir-proposta]");
            if (abrir) {
                estado.aberta = Number(abrir.dataset.abrirProposta);
                return renderizarAbertas();
            }
            if (evento.target.closest("[data-fechar-proposta]")) {
                const id = estado.aberta;
                estado.aberta = null;
                renderizarAbertas();
                el(`cot-${id}`)?.querySelector("[data-abrir-proposta]")?.focus();
                return;
            }
            const retirarBotao = evento.target.closest("[data-retirar]");
            if (retirarBotao) return retirar(Number(retirarBotao.dataset.retirar));
        });

        el("listaAbertas").addEventListener("submit", evento => {
            evento.preventDefault();
            enviarProposta(evento.target);
        });

        el("cotFiltroSegmento").addEventListener("change", evento => {
            estado.filtro = evento.target.value;
            carregarAbertas().catch(erro => falhar(erro));
        });
    }

    function falhar(erro) {
        console.error("[SERF:Cotações]", erro);
        el("cotStatus").hidden = false;
        el("cotStatus").textContent = window.SERFUtils.mensagemDeErro(erro);
    }

    // ?cotacao=ID: abre a cotação certa na aba certa
    function abrirAlvo() {
        if (!estado.alvo) return;

        if (estado.minhas.some(c => c.id_cotacao === estado.alvo)) {
            mostrarAba("comprar");
        } else if (estado.abertas.some(c => c.id_cotacao === estado.alvo) && estado.empresa.idFornecedor) {
            mostrarAba("vender");
            estado.aberta = estado.alvo;
            renderizarAbertas();
        } else {
            return;
        }

        const cartao = el(`cot-${estado.alvo}`);
        cartao?.classList.add("destaque");
        cartao?.scrollIntoView({ block: "start" });
    }

    async function iniciar() {
        configurar();
        if (!(await window.serfSessao)) return;

        try {
            estado.empresa = await window.SERFUtils.obterEmpresaLogada();
            const nome = estado.empresa?.nome || "Empresa";
            el("empresaAtiva").textContent = nome;
            document.querySelector(".profile-avatar").textContent = nome.trim().charAt(0).toUpperCase() || "E";
            const comprador = Boolean(estado.empresa?.idUsuario);
            const fornecedor = Boolean(estado.empresa?.idFornecedor);

            if (!comprador && !fornecedor) {
                el("cotStatus").textContent = "Conclua o cadastro da empresa para usar as cotações.";
                return;
            }

            el("cotAbas").hidden = !(comprador && fornecedor);

            const tarefas = [];
            if (comprador) tarefas.push(carregarMinhas());
            if (fornecedor) {
                const segmentos = await window.SERFDados.pendencias.meusSegmentos().catch(() => []);
                estado.segmentos = segmentos;
                if (segmentos.length) {
                    el("cotFiltroSegmento").insertAdjacentHTML("afterbegin",
                        `<option value="__meus">Meus segmentos (${segmentos.length})</option>`);
                    el("cotFiltroSegmento").value = "__meus";
                    estado.filtro = "__meus";
                }
                estado.produtos = await dados().meusProdutosAtivos(estado.empresa.idFornecedor);
                tarefas.push(carregarAbertas());
            }
            await Promise.all(tarefas);

            el("cotStatus").hidden = true;
            mostrarAba(comprador ? "comprar" : "vender");
            abrirAlvo();

            // Propostas chegando / mudando: recarrega a aba visível
            let espera = null;
            dados().assinarPropostas(() => {
                clearTimeout(espera);
                espera = setTimeout(() => {
                    const recarga = estado.aba === "comprar" ? (comprador && carregarMinhas()) : (fornecedor && !estado.aberta && carregarAbertas());
                    Promise.resolve(recarga).catch(() => {});
                }, 400);
            });
        } catch (erro) {
            falhar(erro);
        }
    }

    window.SERFCotacoes = Object.freeze({ recarregar: () => Promise.all([carregarMinhas(), carregarAbertas()]) });

    iniciar();
})();
