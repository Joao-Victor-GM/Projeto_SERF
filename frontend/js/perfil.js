/* =========================================================================
   S.E.R.F. — PERFIL CORPORATIVO B2B (perfil.js)
   Módulos (todos com dados reais do Supabase):
   - Dados cadastrais da empresa logada (usuarios / fornecedores)
   - Histórico de compras e vendas (tabela pedidos)
   - Reputação calculada pelos pedidos finalizados
   - Repetição de compra (novo pedido), edição de cadastro e senha
   ========================================================================= */

"use strict";

(function () {
    // obterSupabase() vem de supabase-client.js; utilitários de utils.js.
    const {
        swalConfig,
        escaparHTML,
        formatarMoeda,
        formatarCNPJ,
        formatarData,
        dataLocalISO,
        statusDoPedido
    } = window.SERFUtils;

    // Cadastros da empresa logada (null se não possuir o papel)
    const empresa = {
        authUserId: null,
        email: null,
        comprador: null,   // linha de 'usuarios'
        fornecedor: null   // linha de 'fornecedores'
    };

    let compras = [];
    let vendas = [];
    let erroPedidos = null;

    let filtroComprasAtual = "todos";
    let filtroVendasAtual = "todos";
    let buscaComprasTexto = "";

    function perfilDaEmpresa() {
        if (empresa.comprador && empresa.fornecedor) return "Ambos";
        if (empresa.fornecedor) return "Fornecedor";
        if (empresa.comprador) return "Comprador";
        return null;
    }

    function definirTexto(id, texto) {
        const elemento = document.getElementById(id);
        if (elemento) elemento.textContent = texto;
    }

    /* =========================================================================
       1. DADOS DA EMPRESA LOGADA
       ========================================================================= */
    async function carregarEmpresa(client) {
        const { data: { session } } = await client.auth.getSession();
        const user = session?.user;
        if (!user) return;

        empresa.authUserId = user.id;
        empresa.email = user.email;

        const [comprador, fornecedor] = await Promise.all([
            client
                .from("usuarios")
                .select("id_usuario, nome_empresa, cnpj, email, telefone, nicho, status_cadastro, data_cadastro")
                .eq("auth_user_id", user.id)
                .maybeSingle(),
            client
                .from("fornecedores")
                .select("id_fornecedor, razao_social, nome_fantasia, cnpj, email, telefone, cidade, estado, nicho, status_cadastro, data_cadastro")
                .eq("auth_user_id", user.id)
                .maybeSingle()
        ]);

        if (comprador.error) console.error("[SERF:Perfil] Erro ao ler usuarios:", comprador.error);
        if (fornecedor.error) console.error("[SERF:Perfil] Erro ao ler fornecedores:", fornecedor.error);

        empresa.comprador = comprador.data || null;
        empresa.fornecedor = fornecedor.data || null;
    }

    function renderizarEmpresa() {
        const c = empresa.comprador;
        const f = empresa.fornecedor;

        const razaoSocial = c?.nome_empresa || f?.razao_social || "Empresa não identificada";
        const cnpj = c?.cnpj || f?.cnpj;
        const nicho = c?.nicho || f?.nicho || "Nicho não definido";
        const perfil = perfilDaEmpresa();
        const inicial = razaoSocial.trim().charAt(0).toUpperCase();

        // Capa e topbar
        definirTexto("heroRazaoSocial", razaoSocial);
        definirTexto("heroAvatar", inicial);
        definirTexto("heroCnpj", `CNPJ: ${formatarCNPJ(cnpj)}`);
        definirTexto("heroNicho", nicho);
        definirTexto("heroPerfil", `Perfil: ${perfil || "pendente"}`);
        definirTexto("empresaAtiva", razaoSocial);

        const avatarTopo = document.querySelector(".profile-avatar");
        if (avatarTopo) avatarTopo.textContent = inicial;

        // "Membro desde": cadastro mais antigo entre os dois papéis
        const datas = [c?.data_cadastro, f?.data_cadastro].filter(Boolean).sort();
        definirTexto(
            "perfilMembroDesde",
            datas.length ? `Membro S.E.R.F. desde ${formatarData(dataLocalISO(datas[0]))}` : "Membro S.E.R.F."
        );

        // Formulário
        const campos = {
            cadRazaoSocial: razaoSocial,
            cadCnpj: formatarCNPJ(cnpj),
            cadEmail: empresa.email || c?.email || f?.email || "",
            cadTelefone: c?.telefone || f?.telefone || "",
            cadNicho: c?.nicho || f?.nicho || "",
            cadNomeFantasia: f?.nome_fantasia || "",
            cadCidade: f?.cidade || "",
            cadEstado: f?.estado || ""
        };

        Object.entries(campos).forEach(([id, valor]) => {
            const campo = document.getElementById(id);
            if (campo) campo.value = valor;
        });

        const camposFornecedor = document.getElementById("camposFornecedor");
        if (camposFornecedor) camposFornecedor.hidden = !f;

        renderizarSelos();
    }

    function renderizarSelos() {
        const lista = document.getElementById("perfilSelos");
        if (!lista) return;

        const selos = [{ ok: true, texto: "CNPJ validado na Receita Federal" }];

        if (empresa.comprador) {
            selos.push({ ok: true, texto: "Compradora na rede S.E.R.F." });
        }

        if (empresa.fornecedor) {
            const homologado = empresa.fornecedor.status_cadastro === "APROVADO";
            selos.push({
                ok: homologado,
                texto: homologado
                    ? "Fornecedora homologada"
                    : `Homologação de fornecedor: ${(empresa.fornecedor.status_cadastro || "pendente").toLowerCase()}`
            });
        }

        if (!perfilDaEmpresa()) {
            selos.push({ ok: false, texto: "Perfil pendente: conclua a segmentação" });
        }

        lista.innerHTML = selos.map(selo => `
            <li>
                <span class="selo-icone ${selo.ok ? "" : "neutro"}">${selo.ok ? "✓" : "•"}</span>
                ${escaparHTML(selo.texto)}
            </li>
        `).join("");
    }

    /* =========================================================================
       2. PEDIDOS DA EMPRESA (compras e vendas)
       ========================================================================= */
    function normalizarPedido(registro) {
        const produto = registro.produtos || {};
        const fornecedor = produto.fornecedores || {};
        const comprador = registro.usuarios || {};
        const status = statusDoPedido(registro.status_pedido);

        return {
            id: registro.id_pedido,
            idUsuario: registro.id_usuario,
            idProduto: registro.id_produto,
            idFornecedor: produto.id_fornecedor ?? null,
            produto: produto.nome_produto || `Produto #${registro.id_produto}`,
            categoria: produto.categoria || "",
            quantidade: registro.quantidade,
            valorUnitario: Number(registro.valor_unitario) || 0,
            valorTotal: Number(registro.valor_total) || 0,
            statusBanco: registro.status_pedido,
            status: status.categoria,
            rotulo: status.rotulo,
            data: dataLocalISO(registro.data_pedido),
            observacao: registro.observacao,
            fornecedorNome: fornecedor.nome_fantasia || fornecedor.razao_social || "Fornecedor",
            compradorNome: comprador.nome_empresa || "Comprador"
        };
    }

    async function buscarPedidos(client) {
        erroPedidos = null;

        // O RLS devolve só os pedidos em que a empresa é compradora ou fornecedora.
        const { data, error } = await client
            .from("pedidos")
            .select(`
                id_pedido,
                id_usuario,
                id_produto,
                quantidade,
                valor_unitario,
                valor_total,
                status_pedido,
                observacao,
                data_pedido,
                produtos (
                    id_produto,
                    nome_produto,
                    categoria,
                    id_fornecedor,
                    fornecedores:fornecedores_publicos (
                        razao_social,
                        nome_fantasia
                    )
                ),
                usuarios (
                    nome_empresa
                )
            `)
            .order("data_pedido", { ascending: false });

        if (error) {
            console.error("[SERF:Perfil] Falha ao buscar pedidos:", error);
            erroPedidos = error.message || "Erro de comunicação com o Supabase";
            compras = [];
            vendas = [];
            return;
        }

        const pedidos = (data || []).map(normalizarPedido);
        const idUsuario = empresa.comprador?.id_usuario ?? null;
        const idFornecedor = empresa.fornecedor?.id_fornecedor ?? null;

        compras = pedidos.filter(p => idUsuario !== null && p.idUsuario === idUsuario);
        vendas = pedidos.filter(p => idFornecedor !== null && p.idFornecedor === idFornecedor);
    }

    /* =========================================================================
       3. CONTROLE DAS ABAS (TABS)
       ========================================================================= */
    function configurarAbas() {
        const botoesAbas = document.querySelectorAll(".profile-tab-btn");
        const paineisAbas = document.querySelectorAll(".tab-content-panel");

        botoesAbas.forEach(botao => {
            botao.addEventListener("click", () => {
                botoesAbas.forEach(b => b.classList.remove("active"));
                paineisAbas.forEach(p => p.classList.remove("active"));

                botao.classList.add("active");
                document.getElementById(`tab-${botao.dataset.tab}`)?.classList.add("active");
            });
        });
    }

    /* =========================================================================
       4. RENDERIZAÇÃO DO HISTÓRICO
       ========================================================================= */
    function estadoVazio(titulo, detalhe, cor = "#64748b") {
        return `
            <div class="empty-state" style="padding: 40px; text-align: center; background: #fff; border: 1px solid var(--serf-borda); border-radius: 8px;">
                <p style="font-size: 14px; font-weight: 600; color: ${cor}; margin-bottom: 6px;">${escaparHTML(titulo)}</p>
                <small style="color: #94a3b8;">${escaparHTML(detalhe)}</small>
            </div>
        `;
    }

    function cardPedido(pedido, tipo) {
        const isCompra = tipo === "compra";
        const parceiro = isCompra ? pedido.fornecedorNome : pedido.compradorNome;

        return `
            <article class="order-card" data-order-id="${pedido.id}">
                <div class="order-card-header">
                    <div class="order-header-left">
                        <span>PEDIDO <strong>#${pedido.id}</strong></span>
                        <span>DATA: <strong>${formatarData(pedido.data)}</strong></span>
                        <span>${isCompra ? "FORNECEDOR" : "COMPRADOR"}: <strong>${escaparHTML(parceiro)}</strong></span>
                    </div>
                    <div>
                        <span class="order-status-badge status-${pedido.status}">${escaparHTML(pedido.rotulo)}</span>
                    </div>
                </div>

                <div class="order-card-body">
                    <div class="order-product-info">
                        <div class="order-product-icon">${isCompra ? "📦" : "🏭"}</div>
                        <div class="order-product-details">
                            <h4>${escaparHTML(pedido.produto)}</h4>
                            <p>${pedido.quantidade} unidades • ${formatarMoeda(pedido.valorUnitario)} / un.</p>
                            ${pedido.observacao ? `<p style="font-size: 11px; margin-top: 2px;">Obs.: ${escaparHTML(pedido.observacao)}</p>` : ""}
                        </div>
                    </div>

                    <div class="order-pricing">
                        <small>${isCompra ? "VALOR TOTAL DO PEDIDO" : "VALOR DA VENDA"}</small>
                        <strong>${formatarMoeda(pedido.valorTotal)}</strong>
                    </div>

                    <div class="order-card-actions">
                        <button type="button" class="btn-secondary" data-acao="detalhes" data-tipo="${tipo}" data-id="${pedido.id}">
                            Ver detalhes
                        </button>
                        ${isCompra ? `
                            <button type="button" class="btn-primary" data-acao="repetir" data-id="${pedido.id}">
                                Repetir compra
                            </button>
                        ` : `
                            <a class="btn-primary" href="home.html#pedidos" style="text-decoration: none;">
                                Gerenciar no painel
                            </a>
                        `}
                    </div>
                </div>
            </article>
        `;
    }

    function renderizarHistoricoCompras() {
        const container = document.getElementById("listaHistoricoCompras");
        if (!container) return;

        definirTexto("badgeCountCompras", compras.length);

        if (erroPedidos) {
            container.innerHTML = estadoVazio("Não foi possível carregar suas compras.", erroPedidos, "#DC2626");
            return;
        }

        if (!empresa.comprador) {
            container.innerHTML = estadoVazio(
                "Sua empresa não possui perfil de compradora.",
                "Para comprar no S.E.R.F., refaça a segmentação escolhendo \"Comprar e Vender\"."
            );
            return;
        }

        const busca = buscaComprasTexto.toLowerCase();
        const filtradas = compras.filter(compra => {
            const statusOk = filtroComprasAtual === "todos" || compra.status === filtroComprasAtual;
            const buscaOk = !busca ||
                compra.produto.toLowerCase().includes(busca) ||
                String(compra.id).includes(busca) ||
                compra.fornecedorNome.toLowerCase().includes(busca);

            return statusOk && buscaOk;
        });

        if (filtradas.length === 0) {
            container.innerHTML = compras.length === 0
                ? estadoVazio("Você ainda não fez nenhuma compra.", "Explore o catálogo e use o botão Negociar para criar seu primeiro pedido.")
                : estadoVazio("Nenhuma compra encontrada com os filtros selecionados.", "Experimente outro filtro ou limpe o campo de busca.");
            return;
        }

        container.innerHTML = filtradas.map(compra => cardPedido(compra, "compra")).join("");
    }

    function renderizarHistoricoVendas() {
        const container = document.getElementById("listaHistoricoVendas");
        if (!container) return;

        definirTexto("badgeCountVendas", vendas.length);

        if (erroPedidos) {
            container.innerHTML = estadoVazio("Não foi possível carregar suas vendas.", erroPedidos, "#DC2626");
            return;
        }

        if (!empresa.fornecedor) {
            container.innerHTML = estadoVazio(
                "Sua empresa não possui perfil de fornecedora.",
                "Para vender no S.E.R.F., refaça a segmentação escolhendo \"Comprar e Vender\"."
            );
            return;
        }

        const filtradas = vendas.filter(venda =>
            filtroVendasAtual === "todos" || venda.status === filtroVendasAtual
        );

        if (filtradas.length === 0) {
            container.innerHTML = vendas.length === 0
                ? estadoVazio("Você ainda não recebeu pedidos.", "Cadastre produtos no catálogo (modo Vender) para receber pedidos.")
                : estadoVazio("Nenhuma venda encontrada com o filtro selecionado.", "Experimente outro filtro.");
            return;
        }

        container.innerHTML = filtradas.map(venda => cardPedido(venda, "venda")).join("");
    }

    // Ações dos cards por delegação (os cards são recriados a cada filtro).
    function configurarAcoesHistorico() {
        ["listaHistoricoCompras", "listaHistoricoVendas"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", evento => {
                const botao = evento.target.closest("[data-acao]");
                if (!botao) return;

                const idPedido = Number(botao.dataset.id);

                if (botao.dataset.acao === "detalhes") {
                    const lista = botao.dataset.tipo === "compra" ? compras : vendas;
                    const pedido = lista.find(p => p.id === idPedido);
                    if (pedido) abrirModalDetalhesPedido(pedido, botao.dataset.tipo);
                }

                if (botao.dataset.acao === "repetir") {
                    const pedido = compras.find(p => p.id === idPedido);
                    if (pedido) repetirCompraPedido(pedido);
                }
            });
        });
    }

    /* =========================================================================
       5. MODAL DE DETALHES DO PEDIDO (Estilo Mercado Livre)
       ========================================================================= */
    function abrirModalDetalhesPedido(pedido, tipo) {
        const isCompra = tipo === "compra";
        const parceiro = isCompra ? pedido.fornecedorNome : pedido.compradorNome;

        Swal.fire({
            ...swalConfig,
            title: `Pedido #${pedido.id}`,
            html: `
                <div style="text-align: left; font-size: 12px; line-height: 1.6; color: #172536;">
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px; margin-bottom: 12px;">
                        <span><strong>Data:</strong> ${formatarData(pedido.data)}</span>
                        <span><strong>Status:</strong> ${escaparHTML(pedido.rotulo)}</span>
                    </div>

                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
                        <span style="font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase;">
                            ${isCompra ? "Fornecedor" : "Comprador"}
                        </span>
                        <div style="font-size: 13px; font-weight: 700; color: #082B4C; margin-top: 2px;">
                            ${escaparHTML(parceiro)}
                        </div>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <span style="font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase;">Itens do pedido</span>
                        <div style="display: flex; justify-content: space-between; margin-top: 4px; padding: 6px 0; border-bottom: 1px dashed #E2E8F0;">
                            <span>${escaparHTML(pedido.produto)} (${pedido.quantidade} × ${formatarMoeda(pedido.valorUnitario)})</span>
                            <strong>${formatarMoeda(pedido.valorTotal)}</strong>
                        </div>
                    </div>

                    ${pedido.observacao ? `
                        <div style="background: #FFF8F1; border: 1px solid #FED7AA; border-radius: 6px; padding: 10px; margin-bottom: 12px;">
                            <span style="font-size: 10px; color: #9A3412; font-weight: 700;">OBSERVAÇÃO</span>
                            <p style="margin-top: 2px;">${escaparHTML(pedido.observacao)}</p>
                        </div>
                    ` : ""}

                    <div style="text-align: right;">
                        <span style="font-size: 11px; color: #64748b; display: block;">VALOR TOTAL</span>
                        <strong style="font-size: 20px; color: #F47A20;">${formatarMoeda(pedido.valorTotal)}</strong>
                    </div>
                </div>
            `,
            showCancelButton: true,
            cancelButtonText: "Fechar",
            confirmButtonText: isCompra ? "Repetir pedido" : "Gerenciar no painel",
            confirmButtonColor: "#F47A20"
        }).then(result => {
            if (!result.isConfirmed) return;

            if (isCompra) {
                repetirCompraPedido(pedido);
            } else {
                window.location.href = "home.html#pedidos";
            }
        });
    }

    /* =========================================================================
       6. REPETIR COMPRA → NOVO PEDIDO REAL
       O preço é recalculado pelo banco (trigger) com o valor atual do produto,
       e estoque/quantidade mínima são validados no servidor.
       ========================================================================= */
    async function repetirCompraPedido(pedido) {
        const confirmacao = await Swal.fire({
            ...swalConfig,
            title: "Repetir esta compra?",
            html: `
                Será criado um novo pedido de <strong>${pedido.quantidade} un.</strong> de
                <strong>${escaparHTML(pedido.produto)}</strong> com
                <strong>${escaparHTML(pedido.fornecedorNome)}</strong>.<br><br>
                <small>O valor segue o preço atual do catálogo.</small>
            `,
            icon: "question",
            showCancelButton: true,
            confirmButtonText: "Criar pedido",
            cancelButtonText: "Cancelar"
        });

        if (!confirmacao.isConfirmed) return;

        const client = obterSupabase();

        try {
            const { data, error } = await client
                .from("pedidos")
                .insert({
                    id_usuario: empresa.comprador.id_usuario,
                    id_produto: pedido.idProduto,
                    quantidade: pedido.quantidade,
                    valor_unitario: pedido.valorUnitario,
                    status_pedido: "PENDENTE",
                    observacao: `Repetição do pedido #${pedido.id}`
                })
                .select("id_pedido, valor_total")
                .single();

            if (error) throw error;

            await Swal.fire({
                ...swalConfig,
                title: `Pedido #${data.id_pedido} criado!`,
                html: `Total: <strong style="color: #f77f00;">${formatarMoeda(data.valor_total)}</strong><br>O fornecedor foi notificado e o pedido aguarda confirmação.`,
                icon: "success"
            });

            await buscarPedidos(client);
            renderizarTudo();
        } catch (erro) {
            console.error("[SERF:Perfil] Falha ao repetir compra:", erro);
            Swal.fire({
                ...swalConfig,
                title: "Não foi possível repetir a compra",
                text: erro.message || "Falha de comunicação com o Supabase.",
                icon: "error",
                confirmButtonColor: "#d33"
            });
        }
    }

    /* =========================================================================
       7. REPUTAÇÃO (termômetro)
       Taxa de conclusão = entregues ÷ (entregues + cancelados).
       Fornecedores são avaliados pelas vendas; compradores, pelas compras.
       ========================================================================= */
    const NIVEIS_REPUTACAO = [
        { minimo: 0.95, nivel: 5, rotulo: "★ Excelente" },
        { minimo: 0.85, nivel: 4, rotulo: "Muito boa" },
        { minimo: 0.70, nivel: 3, rotulo: "Boa" },
        { minimo: 0.50, nivel: 2, rotulo: "Regular" },
        { minimo: 0, nivel: 1, rotulo: "Atenção" }
    ];

    function renderizarReputacao() {
        const comoFornecedor = Boolean(empresa.fornecedor);
        const base = comoFornecedor ? vendas : compras;

        const entregues = base.filter(p => p.statusBanco === "ENTREGUE").length;
        const cancelados = base.filter(p => p.statusBanco === "CANCELADO").length;
        const finalizados = entregues + cancelados;

        const nivelEl = document.getElementById("repNivel");
        const passos = document.querySelectorAll("#repTermometro .thermometer-step");
        passos.forEach(passo => passo.classList.remove("atual"));

        definirTexto("repConcluidos", entregues);
        definirTexto("repCancelados", cancelados);

        if (finalizados === 0) {
            definirTexto("repTaxa", "—");
            definirTexto("repDescricao", "Sem pedidos finalizados ainda. A reputação aparece após as primeiras entregas.");
            if (nivelEl) {
                nivelEl.textContent = "Sem histórico";
                nivelEl.classList.add("sem-historico");
            }
            return;
        }

        const taxa = entregues / finalizados;
        const faixa = NIVEIS_REPUTACAO.find(n => taxa >= n.minimo);

        definirTexto("repTaxa", `${Math.round(taxa * 100)}%`);
        definirTexto(
            "repDescricao",
            `Baseada em ${finalizados} pedido(s) finalizado(s) como ${comoFornecedor ? "fornecedora" : "compradora"}.`
        );

        if (nivelEl) {
            nivelEl.textContent = faixa.rotulo;
            nivelEl.classList.remove("sem-historico");
        }

        passos[faixa.nivel - 1]?.classList.add("atual");
        document.getElementById("repTermometro")
            ?.setAttribute("aria-label", `Nível de reputação: ${faixa.nivel} de 5`);
    }

    /* =========================================================================
       8. EDIÇÃO DOS DADOS CADASTRAIS
       Apenas campos não sensíveis (o banco limita as colunas: migration 006).
       ========================================================================= */
    function configurarFormularioCadastro() {
        const form = document.getElementById("formDadosEmpresa");
        if (!form) return;

        form.addEventListener("submit", async evento => {
            evento.preventDefault();

            const client = obterSupabase();
            const telefone = document.getElementById("cadTelefone").value.trim() || null;
            const nicho = document.getElementById("cadNicho").value || null;
            const nomeFantasia = document.getElementById("cadNomeFantasia").value.trim() || null;
            const cidade = document.getElementById("cadCidade").value.trim() || null;
            const estado = document.getElementById("cadEstado").value.trim().toUpperCase() || null;

            if (estado && !/^[A-Z]{2}$/.test(estado)) {
                Swal.fire({ ...swalConfig, title: "UF inválida", text: "Informe a UF com 2 letras (ex.: SP).", icon: "warning" });
                return;
            }

            const botao = form.querySelector("button[type='submit']");
            botao.disabled = true;

            try {
                const atualizacoes = [];

                if (empresa.comprador) {
                    atualizacoes.push(
                        client.from("usuarios")
                            .update({ telefone, nicho })
                            .eq("id_usuario", empresa.comprador.id_usuario)
                    );
                }

                if (empresa.fornecedor) {
                    atualizacoes.push(
                        client.from("fornecedores")
                            .update({ telefone, nicho, nome_fantasia: nomeFantasia, cidade, estado })
                            .eq("id_fornecedor", empresa.fornecedor.id_fornecedor)
                    );
                }

                const resultados = await Promise.all(atualizacoes);
                const falha = resultados.find(r => r.error);
                if (falha) throw falha.error;

                // Mantém o cache de exibição da Home coerente
                try {
                    const salvo = JSON.parse(localStorage.getItem("usuario_logado") || "{}");
                    localStorage.setItem("usuario_logado", JSON.stringify({ ...salvo, nicho }));
                } catch (e) { /* cache de exibição: pode ser ignorado */ }

                await carregarEmpresa(client);
                renderizarEmpresa();

                Swal.fire({
                    ...swalConfig,
                    title: "Dados atualizados!",
                    text: "As informações da sua empresa foram salvas.",
                    icon: "success",
                    timer: 2000,
                    showConfirmButton: false
                });
            } catch (erro) {
                console.error("[SERF:Perfil] Falha ao salvar cadastro:", erro);
                Swal.fire({ ...swalConfig, title: "Erro ao salvar", text: erro.message, icon: "error" });
            } finally {
                botao.disabled = false;
            }
        });
    }

    /* =========================================================================
       9. ALTERAÇÃO DE SENHA
       O logout é padronizado pelo auth-check.js (botões com data-logout).
       ========================================================================= */
    function configurarSeguranca() {
        const formSenha = document.getElementById("formAlterarSenha");
        if (!formSenha) return;

        formSenha.addEventListener("submit", async evento => {
            evento.preventDefault();

            const nova = document.getElementById("novaSenha").value;
            const confirma = document.getElementById("confirmaNovaSenha").value;

            if (nova.length < 6) {
                Swal.fire({ ...swalConfig, title: "Senha curta", text: "A nova senha deve ter no mínimo 6 caracteres.", icon: "warning" });
                return;
            }
            if (nova !== confirma) {
                Swal.fire({ ...swalConfig, title: "Senhas divergentes", text: "A confirmação não coincide com a nova senha.", icon: "error" });
                return;
            }

            try {
                const { error } = await obterSupabase().auth.updateUser({ password: nova });
                if (error) throw error;

                Swal.fire({ ...swalConfig, title: "Senha alterada!", text: "Sua senha de acesso foi atualizada.", icon: "success" });
                formSenha.reset();
            } catch (erro) {
                Swal.fire({ ...swalConfig, title: "Erro ao atualizar", text: erro.message, icon: "error" });
            }
        });
    }

    /* =========================================================================
       10. FILTROS E BUSCAS
       ========================================================================= */
    function configurarFiltros() {
        document.querySelectorAll("#tab-compras .filter-pill").forEach(pill => {
            pill.addEventListener("click", evento => {
                document.querySelectorAll("#tab-compras .filter-pill").forEach(p => p.classList.remove("active"));
                evento.currentTarget.classList.add("active");
                filtroComprasAtual = evento.currentTarget.dataset.status;
                renderizarHistoricoCompras();
            });
        });

        document.getElementById("buscaComprasInput")?.addEventListener("input", evento => {
            buscaComprasTexto = evento.target.value.trim();
            renderizarHistoricoCompras();
        });

        document.querySelectorAll("#tab-vendas .filter-pill").forEach(pill => {
            pill.addEventListener("click", evento => {
                document.querySelectorAll("#tab-vendas .filter-pill").forEach(p => p.classList.remove("active"));
                evento.currentTarget.classList.add("active");
                filtroVendasAtual = evento.currentTarget.dataset.status;
                renderizarHistoricoVendas();
            });
        });
    }

    /* =========================================================================
       11. INICIALIZAÇÃO
       ========================================================================= */
    function renderizarTudo() {
        renderizarHistoricoCompras();
        renderizarHistoricoVendas();
        renderizarReputacao();
    }

    async function iniciarPerfil() {
        configurarAbas();
        configurarFiltros();
        configurarAcoesHistorico();
        configurarFormularioCadastro();
        configurarSeguranca();

        const client = obterSupabase();
        if (!client) return;

        await carregarEmpresa(client);
        renderizarEmpresa();

        // Empresa só fornecedora abre direto na aba de vendas
        if (empresa.fornecedor && !empresa.comprador) {
            document.querySelector('.profile-tab-btn[data-tab="vendas"]')?.click();
        }

        await buscarPedidos(client);
        renderizarTudo();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciarPerfil);
    } else {
        iniciarPerfil();
    }
})();
