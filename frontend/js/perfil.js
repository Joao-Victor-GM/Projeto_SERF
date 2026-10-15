/* =========================================================================
   S.E.R.F. — PERFIL CORPORATIVO B2B (perfil.js)
   Módulos:
   - Dados Cadastrais & Reputação no S.E.R.F. (Estilo Mercado Livre)
   - Histórico Completo de Compras e Vendas B2B
   - Detalhes de Pedidos, Repetição de Compras e Atualização de Status
   - Edição de Cadastro e Gestão de Sessão / Logout
   ========================================================================= */

"use strict";

(function () {
    const SUPABASE_URL = 'https://rparlqdgcwzoanpqqeof.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC';

    function obterSupabase() {
        if (window.supabaseClient) return window.supabaseClient;
        if (typeof supabase !== 'undefined' && supabase.createClient) {
            window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            return window.supabaseClient;
        }
        return null;
    }

    const swalConfig = {
        background: '#ffffff',
        color: '#1d2d5c',
        confirmButtonColor: '#f77f00'
    };

    // Dados fictícios complementares para histórico denso de demonstração B2B
    const empresasParceiras = {
        2: { nome: "Metalúrgica Horizonte Ltda.", cidade: "Santo André - SP", cnpj: "12.345.678/0001-90" },
        3: { nome: "Distribuidora Prime de Aço", cidade: "Santo André - SP", cnpj: "23.456.789/0001-01" },
        4: { nome: "Tecnologia Nexus Industrial", cidade: "São Bernardo do Campo - SP", cnpj: "34.567.890/0001-12" },
        5: { nome: "Comercial Aurora Insumos", cidade: "São Caetano do Sul - SP", cnpj: "45.678.901/0001-23" },
        6: { nome: "Logística Delta ABC", cidade: "Santo André - SP", cnpj: "56.789.012/0001-34" }
    };

    // Histórico de compras demonstrativas
    const comprasHistorico = [
        {
            id: 1001,
            fornecedorId: 2,
            produto: "Chapas de aço carbono 1020 1/4",
            categoria: "Metalurgia & Usinagem",
            quantidade: 45,
            valorUnitario: 185.00,
            status: "concluido",
            data: "10/10/2026",
            nf: "000.142.890-S1",
            previsaoEntrega: "Entregue em 12/10/2026"
        },
        {
            id: 1002,
            fornecedorId: 3,
            produto: "Componentes e Conectores Hidráulicos",
            categoria: "Metalurgia & Usinagem",
            quantidade: 120,
            valorUnitario: 34.50,
            status: "negociacao",
            data: "12/10/2026",
            nf: "Pendente de emissão",
            previsaoEntrega: "Previsão: 16/10/2026"
        },
        {
            id: 1003,
            fornecedorId: 4,
            produto: "Controladores Lógicos Programáveis (CLP)",
            categoria: "Tecnologia & Insumos",
            quantidade: 8,
            valorUnitario: 1250.00,
            status: "concluido",
            data: "28/09/2026",
            nf: "000.138.542-S1",
            previsaoEntrega: "Entregue em 30/09/2026"
        },
        {
            id: 1004,
            fornecedorId: 5,
            produto: "Embalagens Industriais Reforçadas 50L",
            categoria: "Embalagens & Logística",
            quantidade: 300,
            valorUnitario: 12.80,
            status: "aberto",
            data: "14/10/2026",
            nf: "Aguardando faturamento",
            previsaoEntrega: "Previsão: 18/10/2026"
        },
        {
            id: 1005,
            fornecedorId: 6,
            produto: "Rolamentos Blindados de Alta Rotação",
            categoria: "Automotivo & Peças",
            quantidade: 60,
            valorUnitario: 78.00,
            status: "concluido",
            data: "15/09/2026",
            nf: "000.129.043-S1",
            previsaoEntrega: "Entregue em 17/09/2026"
        }
    ];

    // Histórico de vendas demonstrativas
    const vendasHistorico = [
        {
            id: 2001,
            cliente: "Padaria & Confeitaria Bela Vista",
            produto: "Farinha Especial em Saca 50kg",
            categoria: "Alimentos & Bebidas",
            quantidade: 80,
            valorUnitario: 95.00,
            status: "concluido",
            data: "11/10/2026",
            nf: "000.089.412-S1"
        },
        {
            id: 2002,
            cliente: "Auto Peças Mauá Distribuição",
            produto: "Conjunto de Engrenagens Cônicas",
            categoria: "Automotivo & Peças",
            quantidade: 35,
            valorUnitario: 310.00,
            status: "aberto",
            data: "13/10/2026",
            nf: "Em separação"
        },
        {
            id: 2003,
            cliente: "Metalúrgica Santo André S.A.",
            produto: "Suportes Metálicos Industriais",
            categoria: "Metalurgia & Usinagem",
            quantidade: 200,
            valorUnitario: 42.00,
            status: "negociacao",
            data: "14/10/2026",
            nf: "Orçamento em análise"
        }
    ];

    let filtroComprasAtual = "todos";
    let filtroVendasAtual = "todos";
    let buscaComprasTexto = "";

    function escaparHTML(texto) {
        if (texto === null || texto === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(texto);
        return div.innerHTML;
    }

    function formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor) || 0);
    }

    function formatarCNPJ(cnpjPuro) {
        if (!cnpjPuro) return "Não informado";
        const limpo = String(cnpjPuro).replace(/\D/g, "");
        if (limpo.length === 14) {
            return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
        }
        return cnpjPuro;
    }

    /* =========================================================================
       1. CARREGAMENTO DOS DADOS DA EMPRESA LOGADA
       ========================================================================= */
    function carregarDadosEmpresa() {
        const usuarioLocal = localStorage.getItem('usuario_logado');
        let empresa = {
            razaoSocial: "Indústria Metalúrgica Atlas Ltda.",
            nomeFantasia: "Atlas B2B",
            cnpj: "18.234.567/0001-89",
            email: "comercial@atlasmetalurgica.com.br",
            telefone: "(11) 4433-2100",
            nicho: "Metalurgia & Usinagem",
            perfil: "Fornecedor",
            cidade: "Santo André",
            estado: "SP",
            endereco: "Av. Industrial, 1450 - Bairro Jardim, Santo André - SP"
        };

        if (usuarioLocal) {
            try {
                const dados = JSON.parse(usuarioLocal);
                if (dados.razaoSocial) empresa.razaoSocial = dados.razaoSocial;
                if (dados.cnpj) empresa.cnpj = formatarCNPJ(dados.cnpj);
                if (dados.email) empresa.email = dados.email;
                if (dados.perfil) empresa.perfil = dados.perfil;
                if (dados.nicho) empresa.nicho = dados.nicho;
            } catch (e) {
                console.warn("[SERF:Perfil] Erro ao analisar usuario_logado:", e);
            }
        }

        // Atualiza Elementos no DOM
        const elHeroNome = document.getElementById("heroRazaoSocial");
        if (elHeroNome) elHeroNome.textContent = empresa.razaoSocial;

        const elHeroAvatar = document.getElementById("heroAvatar");
        if (elHeroAvatar) elHeroAvatar.textContent = empresa.razaoSocial.trim().charAt(0).toUpperCase();

        const elHeroCnpj = document.getElementById("heroCnpj");
        if (elHeroCnpj) elHeroCnpj.textContent = `CNPJ: ${formatarCNPJ(empresa.cnpj)}`;

        const elHeroNicho = document.getElementById("heroNicho");
        if (elHeroNicho) elHeroNicho.textContent = empresa.nicho;

        const elHeroPerfil = document.getElementById("heroPerfil");
        if (elHeroPerfil) elHeroPerfil.textContent = `Perfil: ${empresa.perfil}`;

        const elTopEmpresa = document.getElementById("empresaAtiva");
        if (elTopEmpresa) elTopEmpresa.textContent = empresa.razaoSocial;

        const elTopAvatar = document.querySelector(".profile-avatar");
        if (elTopAvatar) elTopAvatar.textContent = empresa.razaoSocial.trim().charAt(0).toUpperCase();

        // Preenche formulário de dados cadastrais
        const inputRazao = document.getElementById("cadRazaoSocial");
        if (inputRazao) inputRazao.value = empresa.razaoSocial;

        const inputFantasia = document.getElementById("cadNomeFantasia");
        if (inputFantasia) inputFantasia.value = empresa.nomeFantasia;

        const inputCnpj = document.getElementById("cadCnpj");
        if (inputCnpj) inputCnpj.value = formatarCNPJ(empresa.cnpj);

        const inputEmail = document.getElementById("cadEmail");
        if (inputEmail) inputEmail.value = empresa.email;

        const inputTelefone = document.getElementById("cadTelefone");
        if (inputTelefone) inputTelefone.value = empresa.telefone;

        const inputNicho = document.getElementById("cadNicho");
        if (inputNicho) inputNicho.value = empresa.nicho;

        const inputEndereco = document.getElementById("cadEndereco");
        if (inputEndereco) inputEndereco.value = empresa.endereco;

        return empresa;
    }

    /* =========================================================================
       2. CONTROLE DAS ABAS (TABS)
       ========================================================================= */
    function configurarAbas() {
        const botoesAbas = document.querySelectorAll(".profile-tab-btn");
        const paineisAbas = document.querySelectorAll(".tab-content-panel");

        botoesAbas.forEach(botao => {
            botao.addEventListener("click", () => {
                const alvoId = botao.dataset.tab;

                botoesAbas.forEach(b => b.classList.remove("active"));
                paineisAbas.forEach(p => p.classList.remove("active"));

                botao.classList.add("active");
                const painelAlvo = document.getElementById(`tab-${alvoId}`);
                if (painelAlvo) {
                    painelAlvo.classList.add("active");
                }
            });
        });
    }

    /* =========================================================================
       3. RENDERIZAÇÃO DO HISTÓRICO DE COMPRAS (Minhas Compras B2B)
       ========================================================================= */
    function renderizarHistoricoCompras() {
        const container = document.getElementById("listaHistoricoCompras");
        if (!container) return;

        // Filtra por status e texto de busca
        let filtrados = comprasHistorico.filter(compra => {
            const statusMatch = (filtroComprasAtual === "todos") || (compra.status === filtroComprasAtual);
            const buscaMatch = !buscaComprasTexto || 
                compra.produto.toLowerCase().includes(buscaComprasTexto.toLowerCase()) ||
                String(compra.id).includes(buscaComprasTexto) ||
                (empresasParceiras[compra.fornecedorId]?.nome || "").toLowerCase().includes(buscaComprasTexto.toLowerCase());

            return statusMatch && buscaMatch;
        });

        // Atualiza contador na aba
        const badgeCount = document.getElementById("badgeCountCompras");
        if (badgeCount) badgeCount.textContent = comprasHistorico.length;

        if (filtrados.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 40px; text-align: center; background: #fff; border: 1px solid var(--serf-borda); border-radius: 8px;">
                    <p style="font-size: 14px; font-weight: 600; color: #64748b; margin-bottom: 6px;">Nenhuma compra encontrada com os filtros selecionados.</p>
                    <small style="color: #94a3b8;">Experimente selecionar outro filtro ou limpar o campo de busca.</small>
                </div>
            `;
            return;
        }

        container.innerHTML = filtrados.map(compra => {
            const fornecedor = empresasParceiras[compra.fornecedorId] || { nome: "Fornecedor Local ABC", cidade: "Santo André - SP" };
            const total = compra.quantidade * compra.valorUnitario;

            let badgeClass = "status-aberto";
            let statusTexto = "Em Aberto";

            if (compra.status === "concluido") {
                badgeClass = "status-concluido";
                statusTexto = "✓ Concluído & Entregue";
            } else if (compra.status === "negociacao") {
                badgeClass = "status-negociacao";
                statusTexto = "⏳ Em Negociação";
            } else if (compra.status === "cancelado") {
                badgeClass = "status-cancelado";
                statusTexto = "✕ Cancelado";
            }

            return `
                <article class="order-card" data-order-id="${compra.id}">
                    <div class="order-card-header">
                        <div class="order-header-left">
                            <span>PEDIDO <strong>#${compra.id}</strong></span>
                            <span>DATA: <strong>${compra.data}</strong></span>
                            <span>FORNECEDOR: <strong>${escaparHTML(fornecedor.nome)}</strong></span>
                        </div>
                        <div>
                            <span class="order-status-badge ${badgeClass}">${statusTexto}</span>
                        </div>
                    </div>

                    <div class="order-card-body">
                        <div class="order-product-info">
                            <div class="order-product-icon">📦</div>
                            <div class="order-product-details">
                                <h4>${escaparHTML(compra.produto)}</h4>
                                <p>${compra.quantidade} unidades • ${formatarMoeda(compra.valorUnitario)} / un.</p>
                                <p style="font-size: 11px; color: #15803D; margin-top: 2px;">${escaparHTML(compra.previsaoEntrega)}</p>
                            </div>
                        </div>

                        <div class="order-pricing">
                            <small>VALOR TOTAL DO PEDIDO</small>
                            <strong>${formatarMoeda(total)}</strong>
                        </div>

                        <div class="order-card-actions">
                            <button
                                type="button"
                                class="btn-secondary btn-detalhes-compra"
                                data-id="${compra.id}"
                                style="font-size: 11px;"
                            >
                                Ver Detalhes
                            </button>

                            <button
                                type="button"
                                class="btn-primary btn-repetir-compra"
                                data-id="${compra.id}"
                                data-produto="${escaparHTML(compra.produto)}"
                                data-preco="${compra.valorUnitario}"
                                style="font-size: 11px;"
                            >
                                Repetir Compra
                            </button>
                        </div>
                    </div>
                </article>
            `;
        }).join("");

        // Vincula Ações
        container.querySelectorAll(".btn-detalhes-compra").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const id = Number(e.currentTarget.dataset.id);
                const compra = comprasHistorico.find(c => c.id === id);
                if (compra) abrirModalDetalhesPedido(compra, "compra");
            });
        });

        container.querySelectorAll(".btn-repetir-compra").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const id = Number(e.currentTarget.dataset.id);
                const compra = comprasHistorico.find(c => c.id === id);
                if (compra) repetirCompraPedido(compra);
            });
        });
    }

    /* =========================================================================
       4. RENDERIZAÇÃO DO HISTÓRICO DE VENDAS (Minhas Vendas B2B)
       ========================================================================= */
    function renderizarHistoricoVendas() {
        const container = document.getElementById("listaHistoricoVendas");
        if (!container) return;

        let filtrados = vendasHistorico.filter(venda => {
            return (filtroVendasAtual === "todos") || (venda.status === filtroVendasAtual);
        });

        const badgeCount = document.getElementById("badgeCountVendas");
        if (badgeCount) badgeCount.textContent = vendasHistorico.length;

        container.innerHTML = filtrados.map(venda => {
            const total = venda.quantidade * venda.valorUnitario;
            let badgeClass = "status-aberto";
            let statusTexto = "Novo Pedido";

            if (venda.status === "concluido") {
                badgeClass = "status-concluido";
                statusTexto = "✓ Faturado & Entregue";
            } else if (venda.status === "negociacao") {
                badgeClass = "status-negociacao";
                statusTexto = "⏳ Cotação";
            }

            return `
                <article class="order-card" data-venda-id="${venda.id}">
                    <div class="order-card-header">
                        <div class="order-header-left">
                            <span>VENDA <strong>#${venda.id}</strong></span>
                            <span>DATA: <strong>${venda.data}</strong></span>
                            <span>COMPRADOR: <strong>${escaparHTML(venda.cliente)}</strong></span>
                        </div>
                        <div>
                            <span class="order-status-badge ${badgeClass}">${statusTexto}</span>
                        </div>
                    </div>

                    <div class="order-card-body">
                        <div class="order-product-info">
                            <div class="order-product-icon">🏭</div>
                            <div class="order-product-details">
                                <h4>${escaparHTML(venda.produto)}</h4>
                                <p>${venda.quantidade} unidades • ${formatarMoeda(venda.valorUnitario)} / un.</p>
                                <p style="font-size: 11px; color: #64748b; margin-top: 2px;">NF-e: ${escaparHTML(venda.nf)}</p>
                            </div>
                        </div>

                        <div class="order-pricing">
                            <small>VALOR FATURADO</small>
                            <strong style="color: #15803D;">${formatarMoeda(total)}</strong>
                        </div>

                        <div class="order-card-actions">
                            <button
                                type="button"
                                class="btn-secondary btn-detalhes-venda"
                                data-id="${venda.id}"
                                style="font-size: 11px;"
                            >
                                Gerenciar Pedido
                            </button>
                        </div>
                    </div>
                </article>
            `;
        }).join("");

        container.querySelectorAll(".btn-detalhes-venda").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const id = Number(e.currentTarget.dataset.id);
                const venda = vendasHistorico.find(v => v.id === id);
                if (venda) abrirModalDetalhesPedido(venda, "venda");
            });
        });
    }

    /* =========================================================================
       5. MODAL DE DETALHES DO PEDIDO (Estilo Mercado Livre)
       ========================================================================= */
    function abrirModalDetalhesPedido(item, tipo) {
        const isCompra = tipo === "compra";
        const parceiroNome = isCompra 
            ? (empresasParceiras[item.fornecedorId]?.nome || "Fornecedor Verificado S.E.R.F.")
            : item.cliente;
        const total = item.quantidade * item.valorUnitario;

        Swal.fire({
            ...swalConfig,
            title: `Detalhes do Pedido #${item.id}`,
            html: `
                <div style="text-align: left; font-size: 12px; line-height: 1.6; color: #172536;">
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px; margin-bottom: 12px;">
                        <span><strong>Data de Emissão:</strong> ${item.data}</span>
                        <span><strong>Nota Fiscal:</strong> ${escaparHTML(item.nf || "000.142.890-S1")}</span>
                    </div>

                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
                        <span style="font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase;">
                            ${isCompra ? 'DADOS DO FORNECEDOR' : 'DADOS DO COMPRADOR'}
                        </span>
                        <div style="font-size: 13px; font-weight: 700; color: #082B4C; margin-top: 2px;">
                            ${escaparHTML(parceiroNome)}
                        </div>
                        <div style="color: #64748b; font-size: 11px;">
                            Santo André - SP • Polo Industrial ABC • Cadastro Homologado S.E.R.F.
                        </div>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <span style="font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase;">ITENS DO PEDIDO</span>
                        <div style="display: flex; justify-content: space-between; margin-top: 4px; padding: 6px 0; border-bottom: 1px dashed #E2E8F0;">
                            <span>${escaparHTML(item.produto)} (x${item.quantidade})</span>
                            <strong>${formatarMoeda(total)}</strong>
                        </div>
                    </div>

                    <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 10px; margin-bottom: 15px;">
                        <span style="font-size: 10px; color: #166534; font-weight: 700;">LOGÍSTICA & ENTREGA B2B</span>
                        <p style="color: #15803D; font-size: 12px; margin-top: 2px;">
                            ${item.previsaoEntrega || 'Expedição garantida em até 48 horas úteis.'}
                        </p>
                    </div>

                    <div style="text-align: right;">
                        <span style="font-size: 11px; color: #64748b; display: block;">VALOR TOTAL FATURADO</span>
                        <strong style="font-size: 20px; color: #F47A20;">${formatarMoeda(total)}</strong>
                    </div>
                </div>
            `,
            showCancelButton: true,
            cancelButtonText: "Fechar",
            confirmButtonText: isCompra ? "Repetir Pedido" : "Baixar Espelho da NF",
            confirmButtonColor: "#F47A20"
        }).then(result => {
            if (result.isConfirmed && isCompra) {
                repetirCompraPedido(item);
            }
        });
    }

    /* =========================================================================
       6. REPETIR COMPRA (1-Clique B2B)
       ========================================================================= */
    function repetirCompraPedido(compra) {
        const payloadSelecao = {
            id: compra.id,
            id_produto: compra.id,
            preco: compra.valorUnitario,
            nome_produto: compra.produto,
            quantidade_minima: compra.quantidade,
            fornecedor: empresasParceiras[compra.fornecedorId]?.nome || "Fornecedor Homologado",
            repeticao: true,
            data: new Date().toISOString()
        };

        localStorage.setItem("produto_selecionado", JSON.stringify(payloadSelecao));

        Swal.fire({
            ...swalConfig,
            title: "Pedido Clonado com Sucesso!",
            text: `Os dados de "${compra.produto}" foram carregados. Redirecionando para confirmação...`,
            icon: "success",
            timer: 2000,
            showConfirmButton: false
        }).then(() => {
            window.location.href = "home.html#pedidos";
        });
    }

    /* =========================================================================
       7. SALVAR ALTERAÇÃO DE DADOS CADASTRAIS DA EMPRESA
       ========================================================================= */
    function configurarFormularioCadastro() {
        const form = document.getElementById("formDadosEmpresa");
        if (!form) return;

        form.addEventListener("submit", (e) => {
            e.preventDefault();

            const razaoSocial = document.getElementById("cadRazaoSocial").value.trim();
            const nomeFantasia = document.getElementById("cadNomeFantasia").value.trim();
            const email = document.getElementById("cadEmail").value.trim();
            const telefone = document.getElementById("cadTelefone").value.trim();
            const nicho = document.getElementById("cadNicho").value.trim();
            const endereco = document.getElementById("cadEndereco").value.trim();

            if (!razaoSocial || !email) {
                Swal.fire({ ...swalConfig, title: "Atenção", text: "Preencha a Razão Social e o E-mail.", icon: "warning" });
                return;
            }

            // Atualiza no localStorage
            const salvo = localStorage.getItem("usuario_logado");
            let dadosObj = salvo ? JSON.parse(salvo) : {};
            dadosObj.razaoSocial = razaoSocial;
            dadosObj.email = email;
            dadosObj.nicho = nicho;
            localStorage.setItem("usuario_logado", JSON.stringify(dadosObj));

            // Atualiza Hero e Topbar
            carregarDadosEmpresa();

            Swal.fire({
                ...swalConfig,
                title: "Dados Atualizados!",
                text: "As informações da sua empresa foram salvas com sucesso no S.E.R.F.",
                icon: "success",
                timer: 2000,
                showConfirmButton: false
            });
        });
    }

    /* =========================================================================
       8. ALTERAÇÃO DE SENHA E LOGOUT
       ========================================================================= */
    function configurarSeguranca() {
        const formSenha = document.getElementById("formAlterarSenha");
        if (formSenha) {
            formSenha.addEventListener("submit", async (e) => {
                e.preventDefault();
                const nova = document.getElementById("novaSenha").value;
                const confirma = document.getElementById("confirmaNovaSenha").value;

                if (nova.length < 6) {
                    Swal.fire({ ...swalConfig, title: "Senha Curta", text: "A nova senha deve ter no mínimo 6 caracteres.", icon: "warning" });
                    return;
                }
                if (nova !== confirma) {
                    Swal.fire({ ...swalConfig, title: "Senhas Divergentes", text: "A confirmação não coincide com a nova senha digitada.", icon: "error" });
                    return;
                }

                const client = obterSupabase();
                if (client) {
                    try {
                        const { error } = await client.auth.updateUser({ password: nova });
                        if (error) throw error;

                        Swal.fire({
                            ...swalConfig,
                            title: "Senha Alterada!",
                            text: "Sua senha de acesso foi atualizada com sucesso.",
                            icon: "success"
                        });
                        formSenha.reset();
                    } catch (err) {
                        Swal.fire({
                            ...swalConfig,
                            title: "Erro ao Atualizar",
                            text: err.message,
                            icon: "error"
                        });
                    }
                } else {
                    Swal.fire({
                        ...swalConfig,
                        title: "Senha Atualizada!",
                        text: "Senha redefinida com sucesso no ambiente local.",
                        icon: "success"
                    });
                    formSenha.reset();
                }
            });
        }

        const btnLogout = document.getElementById("btnLogoutPerfil");
        if (btnLogout) {
            btnLogout.addEventListener("click", () => {
                Swal.fire({
                    ...swalConfig,
                    title: "Encerrar Sessão?",
                    text: "Você será desconectado da plataforma S.E.R.F.",
                    icon: "question",
                    showCancelButton: true,
                    confirmButtonText: "Sim, Sair",
                    cancelButtonText: "Cancelar",
                    confirmButtonColor: "#EF4444"
                }).then(async (res) => {
                    if (res.isConfirmed) {
                        const client = obterSupabase();
                        if (client) {
                            try { await client.auth.signOut(); } catch (e) {}
                        }
                        localStorage.removeItem("usuario_logado");
                        localStorage.removeItem("produto_selecionado");
                        window.location.href = "../public/login-cadastro.html";
                    }
                });
            });
        }
    }

    /* =========================================================================
       9. FILTROS E BUSCAS
       ========================================================================= */
    function configurarFiltros() {
        // Filtros de Compras (Pills)
        document.querySelectorAll("#tab-compras .filter-pill").forEach(pill => {
            pill.addEventListener("click", (e) => {
                document.querySelectorAll("#tab-compras .filter-pill").forEach(p => p.classList.remove("active"));
                e.currentTarget.classList.add("active");
                filtroComprasAtual = e.currentTarget.dataset.status;
                renderizarHistoricoCompras();
            });
        });

        // Campo de busca em compras
        const inputBusca = document.getElementById("buscaComprasInput");
        if (inputBusca) {
            inputBusca.addEventListener("input", (e) => {
                buscaComprasTexto = e.target.value.trim();
                renderizarHistoricoCompras();
            });
        }

        // Filtros de Vendas (Pills)
        document.querySelectorAll("#tab-vendas .filter-pill").forEach(pill => {
            pill.addEventListener("click", (e) => {
                document.querySelectorAll("#tab-vendas .filter-pill").forEach(p => p.classList.remove("active"));
                e.currentTarget.classList.add("active");
                filtroVendasAtual = e.currentTarget.dataset.status;
                renderizarHistoricoVendas();
            });
        });
    }

    /* =========================================================================
       10. INICIALIZAÇÃO
       ========================================================================= */
    function iniciarPerfil() {
        console.info("[SERF] Inicializando Perfil B2B estilo Mercado Livre...");
        carregarDadosEmpresa();
        configurarAbas();
        configurarFiltros();
        renderizarHistoricoCompras();
        renderizarHistoricoVendas();
        configurarFormularioCadastro();
        configurarSeguranca();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciarPerfil);
    } else {
        iniciarPerfil();
    }
})();

