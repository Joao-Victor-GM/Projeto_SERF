/* =========================================================================
   S.E.R.F. — EMPRESAS (empresas.js)

   Aba 1 · Encontrar fornecedores: diretório com reputação agregada
           (view fornecedores_vitrine, migration 011), filtros, favoritos
           e vitrine de produtos com o botão "Negociar" do catálogo.
   Aba 2 · Meus parceiros: empresas com quem você já negociou (seus
           fornecedores e/ou seus clientes), com volume, pedidos em aberto,
           pagamentos pendentes e atalhos para o pedido e o chat.
   ========================================================================= */

"use strict";

(function () {
    const {
        escaparHTML,
        formatarMoeda,
        formatarData,
        dataLocalISO,
        tempoRelativo
    } = window.SERFUtils;

    const STATUS_EM_ABERTO = ["PENDENTE", "CONFIRMADO", "EM_SEPARACAO", "ENVIADO"];

    // Mesma régua de reputação do Perfil (taxa de entrega)
    const NIVEIS = [
        { minimo: 0.95, nivel: 5, rotulo: "Excelente" },
        { minimo: 0.85, nivel: 4, rotulo: "Muito boa" },
        { minimo: 0.70, nivel: 3, rotulo: "Boa" },
        { minimo: 0.50, nivel: 2, rotulo: "Regular" },
        { minimo: 0, nivel: 1, rotulo: "Atenção" }
    ];

    const empresa = { idUsuario: null, idFornecedor: null, nome: null };

    let fornecedores = [];
    let favoritos = new Set();
    let vitrineCompleta = true;      // false = migration 011 ausente (sem métricas)
    let favoritosDisponiveis = true;
    let pedidos = [];
    let pagamentosPorPedido = new Map();

    const estado = {
        aba: "diretorio",
        busca: "",
        nicho: "",
        local: "",
        ordem: "reputacao",
        soFavoritos: false,
        perspectiva: "fornecedores"
    };

    const el = id => document.getElementById(id);


    /* =====================================================================
       1. CARGA
       ===================================================================== */

    async function carregarEmpresa() {
        // Consulta compartilhada com catalogo.js (cache em utils.js)
        const logada = await window.SERFUtils.obterEmpresaLogada();

        empresa.idUsuario = logada?.idUsuario ?? null;
        empresa.idFornecedor = logada?.idFornecedor ?? null;
        empresa.nome = logada?.nome ?? null;
    }

    async function carregarDiretorio(client) {
        const { buscarTodasAsPaginas } = window.SERFUtils;
        const resposta = await buscarTodasAsPaginas(() => client.from("fornecedores_vitrine").select("*").order("id_fornecedor"));

        if (!resposta.error) {
            fornecedores = resposta.data || [];
            vitrineCompleta = true;
            return;
        }

        // Sem a migration 011: diretório básico, sem reputação
        console.warn("[SERF:Empresas] Vitrine indisponível, usando dados públicos:", resposta.error.message);
        vitrineCompleta = false;

        const basico = await buscarTodasAsPaginas(() => client
            .from("fornecedores_publicos")
            .select("id_fornecedor, razao_social, nome_fantasia, cidade, estado, nicho")
            .order("id_fornecedor"));

        if (basico.error) throw basico.error;

        fornecedores = (basico.data || []).map(f => ({
            ...f, homologado: false, produtos_ativos: null, categorias: [],
            pedidos_entregues: 0, pedidos_cancelados: 0, clientes_atendidos: 0,
            taxa_entrega: null, tempo_resposta_horas: null, prazo_entrega_dias: null
        }));
    }

    async function carregarFavoritos(client) {
        const { data, error } = await client.from("favoritos_fornecedores").select("id_fornecedor");

        if (error) {
            favoritosDisponiveis = false;
            return;
        }

        favoritos = new Set((data || []).map(f => f.id_fornecedor));
    }

    async function carregarPedidos(client) {
        // View pedidos_painel (migration 014): uma linha por pedido, com nomes
        // e os papéis da empresa logada já calculados pelo banco.
        const { buscarTodasAsPaginas } = window.SERFUtils;
        const { data, error } = await buscarTodasAsPaginas(() => client
            .from("pedidos_painel")
            .select(`
                id_pedido, id_usuario, id_fornecedor, valor_total, status_pedido, data_pedido,
                fornecedor_razao_social, fornecedor_nome_fantasia, fornecedor_cidade, fornecedor_estado,
                comprador_nome, sou_comprador, sou_fornecedor
            `)
            .order("data_pedido", { ascending: false })
            .order("id_pedido", { ascending: false }));

        if (error) throw error;
        pedidos = data || [];

        // Pagamentos (migration 009): opcional
        const pagamentos = await buscarTodasAsPaginas(() => client
            .from("pagamentos").select("id_pedido, status, metodo, valor, vencimento").order("id_pedido"));
        pagamentosPorPedido = new Map((pagamentos.data || []).map(p => [p.id_pedido, p]));
    }


    /* =====================================================================
       2. REPUTAÇÃO E FORMATAÇÃO
       ===================================================================== */

    function reputacao(f) {
        const finalizados = (f.pedidos_entregues || 0) + (f.pedidos_cancelados || 0);

        if (!finalizados || f.taxa_entrega === null || f.taxa_entrega === undefined) {
            return { nivel: 0, rotulo: "Sem histórico", detalhe: "ainda sem pedidos finalizados" };
        }

        const faixa = NIVEIS.find(n => Number(f.taxa_entrega) >= n.minimo);
        return {
            nivel: faixa.nivel,
            rotulo: faixa.rotulo,
            detalhe: `${f.pedidos_entregues} entrega(s) · ${f.clientes_atendidos} cliente(s)`
        };
    }

    function horas(valor) {
        if (valor === null || valor === undefined) return "—";
        const h = Number(valor);
        if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
        if (h < 48) return `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
        return `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
    }

    function dias(valor) {
        if (valor === null || valor === undefined) return "—";
        return `${Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
    }

    function nomeDe(f) {
        return f.nome_fantasia || f.razao_social || "Fornecedor";
    }

    function localDe(f) {
        return [f.cidade, f.estado].filter(Boolean).join(" - ");
    }

    function inicial(nome) {
        return (nome || "?").trim().charAt(0).toUpperCase();
    }


    /* =====================================================================
       3. ABA 1 · DIRETÓRIO
       ===================================================================== */

    function preencherFiltros() {
        const nichos = [...new Set(fornecedores.map(f => f.nicho).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
        const locais = [...new Set(fornecedores.map(localDe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));

        el("filtroNicho").innerHTML = `<option value="">Todos</option>` +
            nichos.map(n => `<option value="${escaparHTML(n)}">${escaparHTML(n)}</option>`).join("");
        el("filtroLocal").innerHTML = `<option value="">Todas</option>` +
            locais.map(l => `<option value="${escaparHTML(l)}">${escaparHTML(l)}</option>`).join("");

        el("filtroFavoritos").closest(".emp-check").hidden = !favoritosDisponiveis;
    }

    function fornecedoresFiltrados() {
        const busca = estado.busca.toLowerCase();

        const lista = fornecedores.filter(f => {
            if (f.id_fornecedor === empresa.idFornecedor) return false; // não lista a própria empresa
            if (estado.nicho && f.nicho !== estado.nicho) return false;
            if (estado.local && localDe(f) !== estado.local) return false;
            if (estado.soFavoritos && !favoritos.has(f.id_fornecedor)) return false;

            if (busca) {
                const texto = [nomeDe(f), f.razao_social, f.nicho, localDe(f), ...(f.categorias || [])]
                    .join(" ").toLowerCase();
                if (!texto.includes(busca)) return false;
            }

            return true;
        });

        const ordenadores = {
            reputacao: (a, b) => reputacao(b).nivel - reputacao(a).nivel ||
                (Number(b.taxa_entrega) || 0) - (Number(a.taxa_entrega) || 0) ||
                (b.pedidos_entregues || 0) - (a.pedidos_entregues || 0),
            resposta: (a, b) => (a.tempo_resposta_horas ?? Infinity) - (b.tempo_resposta_horas ?? Infinity),
            produtos: (a, b) => (b.produtos_ativos || 0) - (a.produtos_ativos || 0),
            recentes: (a, b) => new Date(b.data_cadastro || 0) - new Date(a.data_cadastro || 0),
            nome: (a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt-BR")
        };

        return lista.sort(ordenadores[estado.ordem] || ordenadores.reputacao);
    }

    function cardFornecedor(f) {
        const rep = reputacao(f);
        const favorito = favoritos.has(f.id_fornecedor);
        const produtos = f.produtos_ativos;
        const nome = nomeDe(f);

        return `
            <article class="emp-card" data-fornecedor="${f.id_fornecedor}">
                ${favoritosDisponiveis ? `
                    <button type="button" class="emp-favorito" data-acao="favoritar"
                            aria-pressed="${favorito}" aria-label="${favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}"
                            title="${favorito ? "Remover dos favoritos" : "Favoritar"}">★</button>
                ` : ""}

                <div class="emp-card-topo">
                    <div class="emp-avatar" aria-hidden="true">${escaparHTML(inicial(nome))}</div>
                    <div>
                        <h3 class="emp-nome">${escaparHTML(nome)}</h3>
                        <p class="emp-local">${escaparHTML(localDe(f) || "Localização não informada")}</p>
                    </div>
                </div>

                <div class="emp-chips">
                    ${f.nicho ? `<span class="emp-chip">${escaparHTML(f.nicho)}</span>` : ""}
                    ${f.homologado ? `<span class="emp-chip homologado">✓ Homologado</span>` : ""}
                    ${(f.categorias || []).filter(c => c !== f.nicho).slice(0, 2).map(c => `<span class="emp-chip">${escaparHTML(c)}</span>`).join("")}
                </div>

                ${vitrineCompleta ? `
                    <div class="emp-reputacao">
                        <span class="emp-nivel">${escaparHTML(rep.rotulo)}<small>${escaparHTML(rep.detalhe)}</small></span>
                        <span class="emp-termometro n${rep.nivel}" role="img" aria-label="Reputação ${rep.nivel} de 5">
                            <span></span><span></span><span></span><span></span><span></span>
                        </span>
                    </div>

                    <div class="emp-metricas">
                        <div class="emp-metrica"><strong>${f.taxa_entrega === null ? "—" : `${Math.round(Number(f.taxa_entrega) * 100)}%`}</strong><small>entregas concluídas</small></div>
                        <div class="emp-metrica"><strong>${escaparHTML(horas(f.tempo_resposta_horas))}</strong><small>tempo de resposta</small></div>
                        <div class="emp-metrica"><strong>${escaparHTML(dias(f.prazo_entrega_dias))}</strong><small>prazo de entrega</small></div>
                    </div>
                ` : ""}

                <div class="emp-card-acoes">
                    <button type="button" class="btn-primary" data-acao="vitrine" ${produtos === 0 ? "disabled" : ""}>
                        ${produtos === null ? "Ver produtos" : produtos === 0 ? "Sem produtos ativos" : `Ver produtos (${produtos})`}
                    </button>
                </div>
            </article>
        `;
    }

    function renderizarDiretorio() {
        const lista = fornecedoresFiltrados();
        const total = fornecedores.filter(f => f.id_fornecedor !== empresa.idFornecedor).length;

        el("contagemDiretorio").textContent =
            `${lista.length} de ${total} fornecedor(es)` +
            (vitrineCompleta ? "" : " · reputação indisponível (rode a migration 011)");

        el("gradeFornecedores").innerHTML = lista.length
            ? lista.map(cardFornecedor).join("")
            : `<p class="rel-vazio">${estado.soFavoritos
                ? "Você ainda não favoritou fornecedores (toque na ★ de um cartão)."
                : "Nenhum fornecedor encontrado com esses filtros."}</p>`;
    }

    async function alternarFavorito(idFornecedor, botao) {
        const client = obterSupabase();
        const eraFavorito = favoritos.has(idFornecedor);

        botao.disabled = true;

        try {
            const { error } = eraFavorito
                ? await client.from("favoritos_fornecedores").delete().eq("id_fornecedor", idFornecedor)
                : await client.from("favoritos_fornecedores").insert({ id_fornecedor: idFornecedor });

            if (error) throw error;

            if (eraFavorito) favoritos.delete(idFornecedor);
            else favoritos.add(idFornecedor);

            renderizarDiretorio();
        } catch (erro) {
            console.error("[SERF:Empresas] Falha ao favoritar:", erro);
            Swal.fire({ ...window.SERFUtils.swalConfig, title: "Não foi possível salvar", text: window.SERFUtils.mensagemDeErro(erro), icon: "error" });
            botao.disabled = false;
        }
    }


    /* =====================================================================
       4. VITRINE (produtos do fornecedor + Negociar)
       ===================================================================== */

    async function abrirVitrine(idFornecedor) {
        const f = fornecedores.find(item => item.id_fornecedor === idFornecedor);
        if (!f) return;

        const modal = el("modalVitrine");
        const corpo = el("vitrineCorpo");
        const rep = reputacao(f);

        el("vitrineTitulo").textContent = nomeDe(f);
        el("vitrineSubtitulo").textContent = [localDe(f), f.nicho, vitrineCompleta ? `Reputação: ${rep.rotulo}` : ""]
            .filter(Boolean).join(" · ");
        corpo.innerHTML = `<p class="rel-vazio">Carregando produtos...</p>`;
        modal.style.display = "flex";

        const { data, error } = await obterSupabase()
            .from("produtos")
            .select(`
                id_produto, id_fornecedor, nome_produto, descricao, categoria, marca,
                preco_atacado, quantidade_minima, quantidade_estoque, ativo,
                fornecedores:fornecedores_publicos ( id_fornecedor, razao_social, nome_fantasia, cidade, estado )
            `)
            .eq("id_fornecedor", idFornecedor)
            .eq("ativo", true)
            .order("nome_produto");

        if (error) {
            corpo.innerHTML = `<p class="rel-vazio">Não foi possível carregar os produtos: ${escaparHTML(window.SERFUtils.mensagemDeErro(error))}</p>`;
            return;
        }

        const produtos = data || [];
        const podeNegociar = empresa.idUsuario !== null && window.CatalogoModule?.abrirModalNegociacao;

        corpo.innerHTML = produtos.length ? `
            ${!podeNegociar ? `<p class="emp-contagem">Para fazer pedidos, sua empresa precisa ter perfil de compradora.</p>` : ""}
            <div class="emp-vitrine-produtos">
                ${produtos.map(p => {
                    const semEstoque = (Number(p.quantidade_estoque) || 0) < (Number(p.quantidade_minima) || 1);
                    return `
                        <article class="emp-produto">
                            <h4>${escaparHTML(p.nome_produto)}</h4>
                            <p>${escaparHTML([p.categoria, p.marca].filter(Boolean).join(" · "))}</p>
                            <span class="emp-produto-preco">${escaparHTML(formatarMoeda(p.preco_atacado))}</span>
                            <p>Mín. ${p.quantidade_minima} un. · ${semEstoque ? "sem estoque" : `${p.quantidade_estoque} em estoque`}</p>
                            ${podeNegociar ? `
                                <button type="button" class="btn-primary" data-negociar="${p.id_produto}" ${semEstoque ? "disabled" : ""}>
                                    🤝 Negociar
                                </button>
                            ` : ""}
                        </article>
                    `;
                }).join("")}
            </div>
        ` : `<p class="rel-vazio">Este fornecedor não tem produtos ativos no momento.</p>`;

        corpo.onclick = evento => {
            const botao = evento.target.closest("[data-negociar]");
            if (!botao) return;

            const produto = produtos.find(p => p.id_produto === Number(botao.dataset.negociar));
            if (produto) window.CatalogoModule.abrirModalNegociacao(produto);
        };
    }

    function fecharVitrine() {
        el("modalVitrine").style.display = "none";
    }


    /* =====================================================================
       5. ABA 2 · MEUS PARCEIROS
       ===================================================================== */

    // Pedido com cobrança em aberto: confirmado sem pagamento, ou fatura a prazo a pagar
    function pagamentoPendente(pedido) {
        if (["PENDENTE", "CANCELADO"].includes(pedido.status_pedido)) return false;

        const pagamento = pagamentosPorPedido.get(pedido.id_pedido);
        if (!pagamento) return ["CONFIRMADO", "EM_SEPARACAO"].includes(pedido.status_pedido);

        return pagamento.status !== "PAGO" &&
            !["CANCELADO", "ESTORNADO"].includes(pagamento.status);
    }

    function agruparParceiros() {
        const comoComprador = estado.perspectiva === "fornecedores";

        const relevantes = pedidos.filter(p => (comoComprador ? p.sou_comprador : p.sou_fornecedor));

        const grupos = new Map();

        relevantes.forEach(p => {
            const fornecedor = {
                razao_social: p.fornecedor_razao_social,
                nome_fantasia: p.fornecedor_nome_fantasia,
                cidade: p.fornecedor_cidade,
                estado: p.fornecedor_estado
            };
            const chave = comoComprador ? `f-${p.id_fornecedor}` : `u-${p.id_usuario}`;
            const grupo = grupos.get(chave) || {
                chave,
                idFornecedor: comoComprador ? p.id_fornecedor : null,
                nome: comoComprador
                    ? (fornecedor.nome_fantasia || fornecedor.razao_social || "Fornecedor")
                    : (p.comprador_nome || "Cliente"),
                local: comoComprador ? localDe(fornecedor) : "",
                pedidos: 0,
                abertos: 0,
                total: 0,
                pendenteQtd: 0,
                pendenteValor: 0,
                ultimo: null
            };

            grupo.pedidos += 1;
            if (STATUS_EM_ABERTO.includes(p.status_pedido)) grupo.abertos += 1;
            if (p.status_pedido !== "CANCELADO") grupo.total += Number(p.valor_total) || 0;

            if (pagamentoPendente(p)) {
                grupo.pendenteQtd += 1;
                grupo.pendenteValor += Number(p.valor_total) || 0;
            }

            // Lista vem do mais recente para o mais antigo
            if (!grupo.ultimo) grupo.ultimo = p;

            grupos.set(chave, grupo);
        });

        return [...grupos.values()].sort((a, b) => b.total - a.total);
    }

    function renderizarParceiros() {
        const comoComprador = estado.perspectiva === "fornecedores";
        const parceiros = agruparParceiros();
        const lista = el("listaParceiros");
        const insight = el("insightParceirosEmp");

        if (!parceiros.length) {
            insight.innerHTML = "";
            lista.innerHTML = `<p class="rel-vazio">${comoComprador
                ? "Você ainda não comprou de nenhum fornecedor. Explore a aba “Encontrar fornecedores”."
                : "Você ainda não recebeu pedidos de clientes."}</p>`;
            return;
        }

        const total = parceiros.reduce((t, p) => t + p.total, 0);
        const top = parceiros.slice(0, 3);
        const fatia = total ? top.reduce((t, p) => t + p.total, 0) / total : 0;
        const comPendencia = parceiros.filter(p => p.pendenteQtd > 0).length;

        insight.innerHTML = `
            <strong>${parceiros.length}</strong> ${comoComprador ? "fornecedor(es)" : "cliente(s)"} ·
            ${parceiros.length > 3
                ? `os ${top.length} principais somam <strong>${Math.round(fatia * 100)}%</strong> do valor negociado`
                : `valor negociado de <strong>${escaparHTML(formatarMoeda(total))}</strong>`}
            ${comPendencia ? ` · <strong>${comPendencia}</strong> com pagamento pendente` : ""}.
        `;

        lista.innerHTML = parceiros.map(p => {
            const temVitrine = comoComprador && fornecedores.some(f => f.id_fornecedor === p.idFornecedor);

            return `
                <article class="emp-parceiro">
                    <div class="emp-parceiro-id">
                        <div class="emp-avatar" aria-hidden="true">${escaparHTML(inicial(p.nome))}</div>
                        <div>
                            <strong title="${escaparHTML(p.nome)}">${escaparHTML(p.nome)}</strong>
                            <span class="emp-local">${escaparHTML(p.local || `Último pedido ${tempoRelativo(p.ultimo.data_pedido)}`)}</span>
                        </div>
                    </div>

                    <div class="emp-dado"><small>Pedidos</small><strong>${p.pedidos}</strong></div>
                    <div class="emp-dado"><small>Em aberto</small><strong>${p.abertos}</strong></div>
                    <div class="emp-dado"><small>Negociado</small><strong>${escaparHTML(formatarMoeda(p.total))}</strong></div>
                    <div class="emp-dado">
                        <small>${comoComprador ? "A pagar" : "A receber"}</small>
                        <strong class="${p.pendenteQtd ? "alerta" : ""}">${p.pendenteQtd ? escaparHTML(formatarMoeda(p.pendenteValor)) : "—"}</strong>
                    </div>

                    <div class="emp-parceiro-acoes">
                        ${temVitrine ? `<button type="button" class="btn-secondary" data-vitrine="${p.idFornecedor}">Produtos</button>` : ""}
                        <a class="btn-primary" style="text-decoration:none"
                           href="home.html?pedido=${p.ultimo.id_pedido}"
                           title="Abre o pedido #${p.ultimo.id_pedido} com o chat">
                            Último pedido · ${escaparHTML(formatarData(dataLocalISO(p.ultimo.data_pedido)))}
                        </a>
                    </div>
                </article>
            `;
        }).join("");
    }


    /* =====================================================================
       6. EVENTOS E INICIALIZAÇÃO
       ===================================================================== */

    function selecionarSegmento(grupo, ativo, atributo = "aria-pressed") {
        grupo.querySelectorAll(".rel-segmento").forEach(botao => {
            const sim = botao === ativo;
            botao.classList.toggle("active", sim);
            botao.setAttribute(atributo, String(sim));
        });
    }

    function mostrarAba(aba) {
        estado.aba = aba;
        selecionarSegmento(document.querySelector(".emp-abas"), document.querySelector(`[data-aba="${aba}"]`), "aria-selected");
        el("abaDiretorio").hidden = aba !== "diretorio";
        el("abaParceiros").hidden = aba !== "parceiros";
        history.replaceState(null, "", aba === "parceiros" ? "#parceiros" : "#");
    }

    function configurarEventos() {
        document.querySelector(".emp-abas").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-aba]");
            if (botao) mostrarAba(botao.dataset.aba);
        });

        el("filtroBuscaEmp").addEventListener("input", e => { estado.busca = e.target.value.trim(); renderizarDiretorio(); });
        el("filtroNicho").addEventListener("change", e => { estado.nicho = e.target.value; renderizarDiretorio(); });
        el("filtroLocal").addEventListener("change", e => { estado.local = e.target.value; renderizarDiretorio(); });
        el("filtroOrdem").addEventListener("change", e => { estado.ordem = e.target.value; renderizarDiretorio(); });
        el("filtroFavoritos").addEventListener("change", e => { estado.soFavoritos = e.target.checked; renderizarDiretorio(); });

        el("gradeFornecedores").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-acao]");
            if (!botao) return;

            const id = Number(botao.closest("[data-fornecedor]").dataset.fornecedor);
            if (botao.dataset.acao === "favoritar") alternarFavorito(id, botao);
            if (botao.dataset.acao === "vitrine") abrirVitrine(id);
        });

        el("listaParceiros").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-vitrine]");
            if (botao) abrirVitrine(Number(botao.dataset.vitrine));
        });

        el("perspectivaParceiros").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-perspectiva]");
            if (!botao) return;

            estado.perspectiva = botao.dataset.perspectiva;
            selecionarSegmento(el("perspectivaParceiros"), botao);
            renderizarParceiros();
        });

        const modal = el("modalVitrine");
        modal.addEventListener("click", evento => {
            if (evento.target === modal || evento.target.closest("[data-fechar-vitrine]")) fecharVitrine();
        });
        window.addEventListener("keydown", evento => {
            if (evento.key === "Escape" && modal.style.display === "flex" && !document.querySelector("#modalNegociacao[style*='flex']")) {
                fecharVitrine();
            }
        });

        // Menu lateral em telas menores: js/ui/layout.js
    }

    function exibirEmpresa() {
        const nome = empresa.nome || "Empresa";
        el("empresaAtiva").textContent = nome;
        const avatar = document.querySelector(".profile-avatar");
        if (avatar) avatar.textContent = inicial(nome);
    }

    async function iniciar() {
        configurarEventos();
        if (location.hash === "#parceiros") mostrarAba("parceiros");

        // empresas.html?busca=Nome (sugestões da busca da Home): já abre filtrado
        const buscaDaUrl = new URLSearchParams(location.search).get("busca");
        if (buscaDaUrl) {
            estado.busca = buscaDaUrl.trim();
            el("filtroBuscaEmp").value = estado.busca;
        }

        const client = obterSupabase();

        try {
            await carregarEmpresa();
            exibirEmpresa();

            const comprador = empresa.idUsuario !== null;
            const fornecedor = empresa.idFornecedor !== null;

            // "Meus parceiros": seletor só para empresas "Ambos"
            estado.perspectiva = comprador ? "fornecedores" : "clientes";
            el("perspectivaParceirosGrupo").hidden = !(comprador && fornecedor);
            el("parceirosFiltros").hidden = !(comprador && fornecedor);
            selecionarSegmento(
                el("perspectivaParceiros"),
                el("perspectivaParceiros").querySelector(`[data-perspectiva="${estado.perspectiva}"]`)
            );

            await Promise.all([
                carregarDiretorio(client),
                carregarFavoritos(client),
                carregarPedidos(client)
            ]);

            preencherFiltros();
            renderizarDiretorio();
            renderizarParceiros();
        } catch (erro) {
            console.error("[SERF:Empresas] Falha ao carregar:", erro);
            el("gradeFornecedores").innerHTML = `<p class="rel-vazio">Não foi possível carregar as empresas: ${escaparHTML(window.SERFUtils.mensagemDeErro(erro))}</p>`;
            el("listaParceiros").innerHTML = "";
        }
    }

    // Pedido criado pela vitrine: atualiza "Meus parceiros"
    window.addEventListener("serf:pedido-criado", async () => {
        try {
            await carregarPedidos(obterSupabase());
            renderizarParceiros();
        } catch (e) { /* atualiza na próxima visita */ }
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar);
    } else {
        iniciar();
    }
})();
