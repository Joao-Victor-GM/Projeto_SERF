/* =========================================================================
   S.E.R.F. — RADAR DE OPORTUNIDADES (radar-oportunidades.js)
   Seção de destaque da Home: um radar que "detecta" oportunidades de
   negócio e as anuncia uma a uma, como notificações em tempo real.

   O conteúdo é REAL (view "oportunidades", migration 016): produtos novos,
   menor preço, recompra, fornecedores do nicho e novas demandas. Só a
   apresentação é cadenciada. Sem dados, o radar segue "escaneando" — nunca
   exibe negócios inventados.

   Movimento sob controle do usuário (WCAG 2.2.2): botão Pausar, pausa
   automática fora da tela / aba oculta / mouse sobre os cartões, e
   prefers-reduced-motion começa parado.

   Depende de: utils.js; na Home, usa abrirPedidoPorId() (js/home/) e
   CatalogoModule.abrirModalNegociacao() (catalogo.js) quando disponíveis.
   ========================================================================= */

"use strict";

(function () {

    const { formatarMoeda, tempoRelativo } = window.SERFUtils;

    const raiz = document.getElementById("radar-oportunidades");
    if (!raiz) return;

    const el = seletor => raiz.querySelector(seletor);
    const elementos = {
        radar: el(".rop-radar"),
        pontos: el("#ropPontos"),
        conexoes: el("#ropConexoes"),
        cartoes: el("#ropCartoes"),
        feed: el("#ropFeed"),
        total: el("#ropTotal"),
        chips: el("#ropChips"),
        status: el("#ropStatus"),
        btnPausar: el("#ropPausar")
    };

    const INTERVALO_PING_MS = 3600;      // um novo "sinal" a cada 3,6 s
    const DURACAO_CARTAO_MS = 6500;      // tempo de cada notificação flutuante
    const MAX_CARTOES = 2;               // notificações simultâneas sobre o radar
    const MAX_FEED = 5;                  // últimos sinais na lista lateral
    const MAX_PONTOS = 24;               // pontos desenhados no radar
    const RECARGA_MS = 120000;           // busca novas oportunidades a cada 2 min

    const preco = valor => formatarMoeda(valor);
    const local = o => [o.cidade, o.estado].filter(Boolean).join("/");

    // tipo → apresentação e ação
    const TIPOS = {
        NOVA_DEMANDA: {
            rotulo: () => "Nova demanda",
            icone: "⚡",
            titulo: o => `${o.parceiro_nome || "Um comprador"} quer ${o.quantidade} un. de ${o.produto_nome}`,
            meta: o => `${preco(o.valor)} · ${tempoRelativo(o.referencia)}`,
            acao: "Responder"
        },
        RECOMPRA: {
            rotulo: () => "Hora de repor",
            icone: "↻",
            titulo: o => `${o.produto_nome} disponível`,
            meta: o => `${o.fornecedor_nome} · ${preco(o.preco)}/un. · última compra ${tempoRelativo(o.referencia)}`,
            acao: "Recomprar"
        },
        NOVO_PRODUTO: {
            rotulo: o => (o.detalhe === "seu nicho" ? "Novo no seu nicho" : "Novo produto"),
            icone: "✦",
            titulo: o => o.produto_nome,
            meta: o => `${o.fornecedor_nome}${local(o) ? ` (${local(o)})` : ""} · ${preco(o.preco)}/un. · mín. ${o.quantidade_minima} un.`,
            acao: "Negociar"
        },
        MENOR_PRECO: {
            rotulo: () => "Menor preço",
            icone: "↓",
            titulo: o => `${o.produto_nome} por ${preco(o.preco)}/un.`,
            meta: o => `Melhor entre ${o.detalhe} ofertas de ${o.categoria} · ${o.fornecedor_nome}`,
            acao: "Negociar"
        },
        FORNECEDOR_NICHO: {
            rotulo: () => "Fornecedor do seu nicho",
            icone: "◈",
            titulo: o => o.fornecedor_nome,
            meta: o => `${o.detalhe} produto${o.detalhe === "1" ? "" : "s"} ativo${o.detalhe === "1" ? "" : "s"}${local(o) ? ` · ${local(o)}` : ""}${o.preco ? ` · a partir de ${preco(o.preco)}` : ""}`,
            acao: "Conhecer"
        }
    };

    const TIPOS_DE_PRODUTO = ["RECOMPRA", "NOVO_PRODUTO", "MENOR_PRECO"];

    const estado = {
        oportunidades: [],
        proximo: 0,
        timer: null,
        pausadoPeloUsuario: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
        pausas: new Set(),   // "oculto" | "fora-da-tela" | "foco"
        carregamento: "carregando"
    };


    /* =====================================================================
       1. DADOS
       ===================================================================== */

    // Identidade da oportunidade: o produto, o pedido ou o fornecedor
    function chaveDe(o) {
        if (TIPOS_DE_PRODUTO.includes(o.tipo)) return `p-${o.id_produto}`;
        return o.tipo === "NOVA_DEMANDA" ? `d-${o.id_pedido}` : `f-${o.id_fornecedor}`;
    }

    // Um produto pode ser "novo" e "menor preço" ao mesmo tempo: fica a
    // oportunidade mais relevante (a lista já vem ordenada).
    function semRepeticao(lista) {
        const vistos = new Set();

        return lista.filter(o => {
            const chave = chaveDe(o);

            if (vistos.has(chave)) return false;
            vistos.add(chave);
            return true;
        });
    }

    async function carregar() {
        const lista = await window.SERFDados.pendencias.listarOportunidades(40);

        estado.oportunidades = semRepeticao(lista.filter(o => TIPOS[o.tipo]));
        estado.proximo = 0;
    }


    /* =====================================================================
       2. POSIÇÃO NO RADAR
       Relevância alta = mais perto do centro (a empresa). O ângulo usa o
       ângulo áureo, que espalha os pontos sem sobreposição.
       ===================================================================== */

    const RAIO_POR_RELEVANCIA = { 4: 0.3, 3: 0.48, 2: 0.66, 1: 0.84 };

    function posicao(indice, oportunidade) {
        const angulo = indice * 2.39996 - Math.PI / 2;
        const raio = (RAIO_POR_RELEVANCIA[oportunidade.relevancia] || 0.75) + ((indice % 3) - 1) * 0.04;

        return {
            x: 50 + Math.cos(angulo) * raio * 46,
            y: 50 + Math.sin(angulo) * raio * 46
        };
    }


    /* =====================================================================
       3. DESENHO
       Tudo com textContent/createElement: dados do banco nunca viram HTML.
       ===================================================================== */

    function criar(tag, classe, texto) {
        const elemento = document.createElement(tag);
        if (classe) elemento.className = classe;
        if (texto !== undefined) elemento.textContent = texto;
        return elemento;
    }

    function desenharPontos() {
        elementos.pontos.replaceChildren();
        elementos.conexoes.replaceChildren();

        estado.oportunidades.slice(0, MAX_PONTOS).forEach((o, indice) => {
            const { x, y } = posicao(indice, o);
            const ponto = criar("span", `rop-ponto tipo-${o.tipo.toLowerCase()}`);

            ponto.style.left = `${x}%`;
            ponto.style.top = `${y}%`;
            ponto.style.animationDelay = `${(indice % 7) * 0.35}s`;
            ponto.dataset.indice = String(indice);

            elementos.pontos.appendChild(ponto);
        });
    }

    function conteudoDoSinal(o, classe) {
        const tipo = TIPOS[o.tipo];
        const botao = criar("button", classe);
        botao.type = "button";
        botao.dataset.tipo = o.tipo;

        const icone = criar("span", "rop-icone", tipo.icone);
        icone.setAttribute("aria-hidden", "true");

        const texto = criar("span", "rop-texto");
        texto.append(
            criar("small", "rop-rotulo", tipo.rotulo(o)),
            criar("strong", null, tipo.titulo(o)),
            criar("span", "rop-meta", tipo.meta(o))
        );

        botao.append(icone, texto, criar("span", "rop-acao", `${tipo.acao} →`));
        botao.addEventListener("click", () => agir(o));
        return botao;
    }

    function linhaAte(x, y, tipo) {
        const linha = document.createElementNS("http://www.w3.org/2000/svg", "line");
        linha.setAttribute("x1", "50");
        linha.setAttribute("y1", "50");
        linha.setAttribute("x2", x.toFixed(2));
        linha.setAttribute("y2", y.toFixed(2));
        linha.setAttribute("class", `rop-linha tipo-${tipo.toLowerCase()}`);
        elementos.conexoes.appendChild(linha);
        setTimeout(() => linha.remove(), DURACAO_CARTAO_MS);
    }

    // Coloca o cartão ao lado do ponto (x, y em %), SEMPRE dentro da área do
    // radar: tenta à direita, depois à esquerda; se não couber em nenhum
    // lado, centraliza sob (ou sobre) o ponto.
    function posicionarCartao(cartao, x, y) {
        const DISTANCIA = 14;
        const largura = elementos.cartoes.clientWidth;
        const altura = elementos.cartoes.clientHeight;
        const w = cartao.offsetWidth;
        const h = cartao.offsetHeight;
        const px = (x / 100) * largura;
        const py = (y / 100) * altura;
        const limitar = (valor, maximo) => Math.min(Math.max(valor, 0), Math.max(0, maximo));

        let esquerda;
        let topo = limitar(py - h / 2, altura - h);

        if (px + DISTANCIA + w <= largura) {
            esquerda = px + DISTANCIA;
        } else if (px - DISTANCIA - w >= 0) {
            esquerda = px - DISTANCIA - w;
        } else {
            esquerda = limitar(px - w / 2, largura - w);
            topo = py + DISTANCIA + h <= altura ? py + DISTANCIA : limitar(py - DISTANCIA - h, altura - h);
        }

        cartao.style.left = `${Math.round(esquerda)}px`;
        cartao.style.top = `${Math.round(topo)}px`;
    }

    // Compara as posições FINAIS (left/top definidos em posicionarCartao), não as
    // da tela: durante a animação de entrada o cartão ainda está deslocado.
    function caixaFinal(cartao) {
        const esquerda = parseFloat(cartao.style.left) || 0;
        const topo = parseFloat(cartao.style.top) || 0;
        return { esquerda, topo, direita: esquerda + cartao.offsetWidth, base: topo + cartao.offsetHeight };
    }

    function seSobrepoem(a, b) {
        const ra = caixaFinal(a);
        const rb = caixaFinal(b);
        return ra.esquerda < rb.direita && rb.esquerda < ra.direita && ra.topo < rb.base && rb.topo < ra.base;
    }

    function retirarCartao(cartao) {
        if (cartao.classList.contains("saindo")) return;
        cartao.classList.add("saindo");
        setTimeout(() => cartao.remove(), 400);
    }

    // Cartões visíveis (os que estão saindo não contam)
    const cartoesAtivos = () => [...elementos.cartoes.children].filter(c => !c.classList.contains("saindo"));

    function cartaoFlutuante(o, x, y) {
        const cartao = conteudoDoSinal(o, `rop-cartao tipo-${o.tipo.toLowerCase()}`);

        const ativos = cartoesAtivos();
        ativos.slice(0, Math.max(0, ativos.length - MAX_CARTOES + 1)).forEach(retirarCartao);

        elementos.cartoes.appendChild(cartao);
        posicionarCartao(cartao, x, y);

        // A notificação nova nunca fica sobreposta: a anterior que colidir sai já.
        cartoesAtivos().forEach(anterior => {
            if (anterior !== cartao && seSobrepoem(anterior, cartao)) retirarCartao(anterior);
        });

        setTimeout(() => retirarCartao(cartao), DURACAO_CARTAO_MS);
    }

    // Lista de itens únicos: uma oportunidade detectada de novo sobe ao topo.
    function adicionarAoFeed(o) {
        const chave = chaveDe(o);
        [...elementos.feed.children].forEach(existente => {
            if (existente.dataset.chave === chave) existente.remove();
        });

        const item = criar("li", "rop-feed-item");
        item.dataset.chave = chave;
        item.appendChild(conteudoDoSinal(o, `rop-sinal tipo-${o.tipo.toLowerCase()}`));

        elementos.feed.prepend(item);
        while (elementos.feed.children.length > MAX_FEED) elementos.feed.lastElementChild.remove();
    }

    function renderizarResumo() {
        const n = estado.oportunidades.length;
        elementos.total.textContent = String(n);

        const contagem = {};
        estado.oportunidades.forEach(o => {
            const rotulo = TIPOS[o.tipo].rotulo(o);
            contagem[rotulo] = (contagem[rotulo] || 0) + 1;
        });

        elementos.chips.replaceChildren(...Object.entries(contagem).map(([rotulo, total]) =>
            criar("li", "rop-chip", `${total} · ${rotulo}`)));

        if (estado.carregamento === "erro") {
            elementos.status.textContent = "Radar indisponível no momento.";
        } else if (n === 0) {
            elementos.status.textContent = "Nenhuma oportunidade agora. O radar continua escaneando.";
        } else {
            elementos.status.textContent = `${n} oportunidade${n === 1 ? "" : "s"} detectada${n === 1 ? "" : "s"} para a sua empresa.`;
        }

        raiz.classList.toggle("vazio", n === 0);
    }


    /* =====================================================================
       4. CICLO DE SINAIS
       ===================================================================== */

    function pingar() {
        const lista = estado.oportunidades;
        if (lista.length === 0) return null;

        const indice = estado.proximo % lista.length;
        const o = lista[indice];
        estado.proximo += 1;

        const indicePonto = indice % MAX_PONTOS;
        const { x, y } = posicao(indicePonto, o);

        const ponto = elementos.pontos.querySelector(`[data-indice="${indicePonto}"]`);
        if (ponto) {
            ponto.classList.remove("detectado");
            void ponto.offsetWidth; // reinicia a animação
            ponto.classList.add("detectado");
        }

        linhaAte(x, y, o.tipo);
        cartaoFlutuante(o, x, y);
        adicionarAoFeed(o);
        return o;
    }

    const emMovimento = () => !estado.pausadoPeloUsuario && estado.pausas.size === 0;

    function sincronizarCiclo() {
        const deveRodar = emMovimento() && estado.oportunidades.length > 0;

        raiz.classList.toggle("pausado", !emMovimento());
        elementos.btnPausar.textContent = estado.pausadoPeloUsuario ? "▶ Retomar" : "❚❚ Pausar";
        elementos.btnPausar.setAttribute("aria-pressed", String(estado.pausadoPeloUsuario));

        if (deveRodar && !estado.timer) {
            estado.timer = setInterval(pingar, INTERVALO_PING_MS);
        } else if (!deveRodar && estado.timer) {
            clearInterval(estado.timer);
            estado.timer = null;
        }
    }

    function pausa(motivo, ativa) {
        if (ativa) estado.pausas.add(motivo);
        else estado.pausas.delete(motivo);
        sincronizarCiclo();
    }


    /* =====================================================================
       5. AÇÕES
       ===================================================================== */

    function produtoParaNegociacao(o) {
        return {
            id_produto: o.id_produto,
            id_fornecedor: o.id_fornecedor,
            nome_produto: o.produto_nome,
            categoria: o.categoria,
            preco_atacado: o.preco,
            quantidade_minima: o.quantidade_minima,
            quantidade_estoque: o.quantidade_estoque,
            fornecedores: {
                id_fornecedor: o.id_fornecedor,
                razao_social: o.fornecedor_nome,
                nome_fantasia: o.fornecedor_nome,
                cidade: o.cidade,
                estado: o.estado
            }
        };
    }

    async function agir(o) {
        if (o.tipo === "NOVA_DEMANDA") {
            if (typeof abrirPedidoPorId === "function") {
                await abrirPedidoPorId(o.id_pedido);
            } else {
                window.location.href = `home.html?pedido=${encodeURIComponent(o.id_pedido)}`;
            }
            return;
        }

        if (TIPOS_DE_PRODUTO.includes(o.tipo)) {
            if (window.CatalogoModule?.abrirModalNegociacao) {
                window.CatalogoModule.abrirModalNegociacao(produtoParaNegociacao(o));
            } else {
                window.location.href = "catalogo.html";
            }
            return;
        }

        window.location.href = "empresas.html";
    }


    /* =====================================================================
       6. INICIALIZAÇÃO
       ===================================================================== */

    // Identidade do conteúdo: se a recarga trouxer o mesmo, nada é redesenhado
    const assinatura = () => `${estado.carregamento}|${estado.oportunidades
        .map(o => `${chaveDe(o)}:${o.tipo}:${o.relevancia}:${o.preco}:${o.quantidade}:${o.referencia}:${o.detalhe}`).join(",")}`;

    let ultimaAssinatura = null;

    async function recarregar() {
        try {
            await carregar();
            estado.carregamento = "ok";
        } catch (erro) {
            // Sem a migration 016 a Home segue funcionando; o radar só avisa.
            console.warn("[SERF:Radar] Oportunidades indisponíveis:", erro.message || erro);
            estado.carregamento = "erro";
            estado.oportunidades = [];
        }

        const atual = assinatura();
        if (atual === ultimaAssinatura) return;   // mesmo conteúdo: mantém pontos, lista e ciclo
        ultimaAssinatura = atual;

        desenharPontos();
        renderizarResumo();

        // Lista lateral nunca começa vazia: mostra as mais relevantes já
        elementos.feed.replaceChildren();
        estado.oportunidades.slice(0, MAX_FEED).reverse().forEach(adicionarAoFeed);
        estado.proximo = Math.min(MAX_FEED, estado.oportunidades.length) % Math.max(1, estado.oportunidades.length);

        if (emMovimento()) pingar();
        sincronizarCiclo();
    }

    function configurar() {
        elementos.btnPausar.addEventListener("click", () => {
            estado.pausadoPeloUsuario = !estado.pausadoPeloUsuario;
            sincronizarCiclo();
        });

        // Lendo/clicando um cartão: não troca o conteúdo debaixo do cursor.
        // (Só cartões e lista: o foco no botão Pausar não pode travar o ciclo.)
        [elementos.cartoes, elementos.feed].forEach(area => {
            area.addEventListener("mouseenter", () => pausa("foco", true));
            area.addEventListener("mouseleave", () => pausa("foco", false));
            area.addEventListener("focusin", () => pausa("foco", true));
            area.addEventListener("focusout", () => pausa("foco", false));
        });

        document.addEventListener("visibilitychange", () => pausa("oculto", document.hidden));

        if ("IntersectionObserver" in window) {
            new IntersectionObserver(([entrada]) => pausa("fora-da-tela", !entrada.isIntersecting))
                .observe(raiz);
        }

        // Só busca de novo se alguém pode ver o radar (aba visível e na tela)
        setInterval(() => {
            if (!estado.pausas.has("oculto") && !estado.pausas.has("fora-da-tela")) recarregar();
        }, RECARGA_MS);
    }

    async function iniciar() {
        configurar();
        sincronizarCiclo();

        if (!(await window.serfSessao)) return;
        await recarregar();
    }

    // Controle externo (testes e outras telas)
    window.SERFRadarOportunidades = Object.freeze({
        pingar,
        recarregar,
        quantidade: () => estado.oportunidades.length,
        emMovimento
    });

    iniciar();
})();
