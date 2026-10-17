/* =========================================================================
   S.E.R.F. — CATÁLOGO B2B & GESTÃO DE PRODUTOS (catalogo.js)
   Módulos:
   - Catálogo de Produtos B2B com Chave Estrangeira de Fornecedores
   - Painel do Vendedor: "Meus Produtos" do Fornecedor Autenticado
   - Negociação Instantânea e Cadastro Direto no Supabase
   ========================================================================= */

"use strict";

(function () {
    // 1. DEPENDÊNCIAS COMPARTILHADAS
    // obterSupabase() vem de supabase-client.js; utilitários de utils.js.
    const {
        swalConfig,
        escaparHTML,
        formatarMoeda: formatarMoedaBRL
    } = window.SERFUtils;

    // Estado local do módulo
    let fornecedorAtual = null; // Armazena dados se o usuário for fornecedor
    let listaProdutosCache = []; // Cache dos produtos em memória

    /* =========================================================================
       2. VERIFICAÇÃO DE FORNECEDOR (Painel do Vendedor)
       Verifica na tabela 'fornecedores' se o usuário autenticado (auth_user_id)
       é um fornecedor cadastrado.
       ========================================================================= */
    async function verificarFornecedorAutenticado() {
        // Consulta compartilhada com Home/empresas.js (cache em utils.js).
        // Identidade vem só da sessão do Supabase Auth (validada pelo auth-check.js).
        try {
            const empresa = await window.SERFUtils.obterEmpresaLogada();

            fornecedorAtual = empresa?.fornecedor || null;

            if (!empresa) {
                console.info('[SERF:Catalogo] Usuário anônimo ou sem ID de autenticação.');
            } else if (fornecedorAtual) {
                console.info(`[SERF:Catalogo] Fornecedor autenticado: ${fornecedorAtual.razao_social} (ID: ${fornecedorAtual.id_fornecedor})`);
            }
        } catch (err) {
            console.error('[SERF:Catalogo] Erro ao consultar tabela fornecedores:', err);
            fornecedorAtual = null;
        }

        atualizarVisibilidadeBotaoCadastro();
        return fornecedorAtual;
    }

    // Verifica se o modo ativo atual na interface é 'vender'
    function isModoVenderAtivo() {
        const botaoModoVender = document.querySelector('.modo-btn[data-mode="vender"].active');
        return Boolean(botaoModoVender);
    }

    // Controla a exibição do botão #btnNovoProduto conforme o perfil e o modo ativo
    // REGRA DE NEGÓCIO: No modo 'comprar' NUNCA é permitido adicionar produtos (botão oculto)
    function atualizarVisibilidadeBotaoCadastro() {
        const btnNovo = document.getElementById('btnNovoProduto');
        if (!btnNovo) return;

        const isVender = isModoVenderAtivo();

        // O botão de novo produto SÓ é exibido se for Fornecedor E estiver no modo 'vender'
        if (fornecedorAtual && isVender) {
            btnNovo.style.display = 'inline-flex';
        } else {
            btnNovo.style.display = 'none';
        }
    }

    /* =========================================================================
       3. BUSCA DE PRODUTOS NO SUPABASE (Chave Estrangeira com 'fornecedores')
       Busca produtos onde ativo = true, trazendo os dados da empresa fornecedora.
       Se o usuário for fornecedor no modo de gestão, filtra por seu id_fornecedor.
       ========================================================================= */
    async function buscarProdutos() {
        const client = obterSupabase();
        const container = document.getElementById('listaProdutos');

        if (!client) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Erro: Conexão com o banco de dados não estabelecida.</p>';
            }
            return [];
        }

        if (container) {
            container.innerHTML = '<p class="empty-state">Carregando catálogo de produtos...</p>';
        }

        try {
            // Sincroniza a visibilidade do botão de cadastro com o modo atual
            atualizarVisibilidadeBotaoCadastro();

            // Detecta se a tela está no modo 'vender' (Painel Meus Produtos)
            const isModoVender = isModoVenderAtivo();

            // Monta query no Supabase com join relacional da chave estrangeira fk_produtos_fornecedores
            let query = client
                .from('produtos')
                .select(`
                    id_produto,
                    id_fornecedor,
                    nome_produto,
                    descricao,
                    categoria,
                    marca,
                    preco_atacado,
                    quantidade_minima,
                    quantidade_estoque,
                    ativo,
                    data_cadastro,
                    fornecedores:fornecedores_publicos (
                        id_fornecedor,
                        razao_social,
                        nome_fantasia,
                        cidade,
                        estado
                    )
                `)
                .eq('ativo', true)
                .order('id_produto', { ascending: false });

            // Se for fornecedor e estiver no modo "vender" (Meus Produtos), filtra pelo seu id_fornecedor
            if (isModoVender && fornecedorAtual && fornecedorAtual.id_fornecedor) {
                query = query.eq('id_fornecedor', fornecedorAtual.id_fornecedor);

                const titulo = document.getElementById('produtosTitulo');
                const subtitulo = document.getElementById('produtosSubtitulo');
                if (titulo) titulo.textContent = 'Meus Produtos (Painel do Vendedor)';
                if (subtitulo) subtitulo.textContent = `Itens cadastrados por ${fornecedorAtual.razao_social}`;
            } else {
                const titulo = document.getElementById('produtosTitulo');
                const subtitulo = document.getElementById('produtosSubtitulo');
                if (titulo) titulo.textContent = 'Catálogo de Produtos B2B';
                if (subtitulo) subtitulo.textContent = 'Explore insumos industriais e mercadorias com preço de atacado';
            }

            const { data, error } = await query;

            if (error) {
                throw error;
            }

            listaProdutosCache = data || [];
            renderizarProdutos(listaProdutosCache);
            return listaProdutosCache;

        } catch (error) {
            console.error('[SERF:Catalogo] Falha ao buscar produtos:', error);
            if (container) {
                container.innerHTML = `
                    <div class="empty-state" style="color: #dc2626;">
                        <p><strong>Não foi possível carregar os produtos.</strong></p>
                        <small>${escaparHTML(error.message || 'Erro de comunicação com o Supabase')}</small>
                    </div>
                `;
            }
            return [];
        }
    }

    /* =========================================================================
       4. RENDERIZAÇÃO DINÂMICA DOS CARDS (#listaProdutos)
       Renderiza: Marca, Categoria, Nome, Descrição, Preço formatado (R$),
       Qtd Mínima, Estoque, Fornecedor e o botão 'Iniciar Negociação'.
       ========================================================================= */
    function renderizarProdutos(produtos) {
        const container = document.getElementById('listaProdutos');
        if (!container) return;

        if (!produtos || produtos.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <p style="font-size: 15px; font-weight: 600; color: #64748b; margin-bottom: 8px;">
                        Nenhum produto disponível no momento.
                    </p>
                    <small style="color: #94a3b8;">
                        Novas ofertas e insumos são atualizados em tempo real pelos fornecedores da rede.
                    </small>
                </div>
            `;
            return;
        }

        container.innerHTML = produtos.map(prod => {
            // Trata o relacionamento de chave estrangeira com fornecedores
            const fornecedor = Array.isArray(prod.fornecedores) ? prod.fornecedores[0] : prod.fornecedores;
            const nomeFornecedor = fornecedor?.razao_social || fornecedor?.nome_fantasia || 'Fornecedor Cadastrado';
            const cidadeFornecedor = fornecedor?.cidade ? ` • ${fornecedor.cidade}` : '';

            const estoque = Number(prod.quantidade_estoque) || 0;
            const statusEstoqueClass = estoque > 0 ? 'em-estoque' : 'sem-estoque';
            const statusEstoqueTexto = estoque > 0 ? `${estoque} em estoque` : 'Sem estoque';

            return `
                <article class="produto-card" data-id="${prod.id_produto}">
                    <div class="produto-card-header">
                        <div class="produto-tags">
                            <span class="produto-badge categoria">${escaparHTML(prod.categoria || 'Geral')}</span>
                            <span class="produto-badge marca">${escaparHTML(prod.marca || 'Original')}</span>
                        </div>
                        <div class="produto-fornecedor" title="${escaparHTML(nomeFornecedor)}">
                            <span class="fornecedor-icone">🏭</span>
                            <span class="fornecedor-nome">${escaparHTML(nomeFornecedor)}${escaparHTML(cidadeFornecedor)}</span>
                        </div>
                    </div>

                    <div class="produto-card-body">
                        <h3 class="produto-nome">${escaparHTML(prod.nome_produto)}</h3>
                        <p class="produto-descricao">${escaparHTML(prod.descricao || 'Sem descrição cadastrada pelo fornecedor.')}</p>

                        <div class="produto-detalhes">
                            <div class="detalhe-item">
                                <span class="detalhe-label">Qtd. Mínima</span>
                                <strong class="detalhe-valor">${prod.quantidade_minima || 1} un.</strong>
                            </div>
                            <div class="detalhe-item">
                                <span class="detalhe-label">Disponibilidade</span>
                                <strong class="detalhe-valor ${statusEstoqueClass}">${statusEstoqueTexto}</strong>
                            </div>
                        </div>

                        <div class="produto-preco-container">
                            <span class="preco-label">Preço de Atacado</span>
                            <span class="produto-preco">${formatarMoedaBRL(prod.preco_atacado)}</span>
                        </div>
                    </div>

                    <div class="produto-card-footer" style="display: flex; gap: 8px;">
                        <button
                            type="button"
                            class="btn-secondary btn-ver-detalhes"
                            data-id="${prod.id_produto}"
                            title="Visualizar todos os detalhes deste produto"
                            style="flex: 0 0 auto; min-height: 38px; padding: 0 12px; font-size: 11px;"
                        >
                            Ver mais
                        </button>
                        <button
                            type="button"
                            class="btn-iniciar-negociacao"
                            data-id="${prod.id_produto}"
                            data-preco="${prod.preco_atacado}"
                            data-nome="${escaparHTML(prod.nome_produto)}"
                            data-fornecedor="${escaparHTML(nomeFornecedor)}"
                            style="flex: 1;"
                        >
                            <span>🤝 Negociar</span>
                        </button>
                    </div>
                </article>
            `;
        }).join('');

        // Vincula o evento de 'Ver mais' (detalhes do produto)
        container.querySelectorAll('.btn-ver-detalhes').forEach(botao => {
            botao.addEventListener('click', (evento) => {
                const id = Number(evento.currentTarget.dataset.id);
                const prod = listaProdutosCache.find(p => p.id_produto === id);
                if (prod) {
                    abrirModalDetalhesProduto(prod);
                }
            });
        });

        // Vincula o evento de Iniciar Negociação em todos os botões gerados
        container.querySelectorAll('.btn-iniciar-negociacao').forEach(botao => {
            botao.addEventListener('click', (evento) => {
                const id = Number(evento.currentTarget.dataset.id);
                const prod = listaProdutosCache.find(p => p.id_produto === id);
                if (prod) {
                    abrirModalNegociacao(prod);
                }
            });
        });
    }

    // Modal com exibição aprofundada de detalhes do produto
    function abrirModalDetalhesProduto(prod) {
        const fornecedor = Array.isArray(prod.fornecedores) ? prod.fornecedores[0] : prod.fornecedores;
        const nomeFornecedor = fornecedor?.razao_social || fornecedor?.nome_fantasia || 'Fornecedor Parceiro';
        const localFornecedor = [fornecedor?.cidade, fornecedor?.estado].filter(Boolean).join(' - ');

        Swal.fire({
            ...swalConfig,
            title: prod.nome_produto,
            html: `
                <div style="text-align: left; font-size: 13px; line-height: 1.6; color: #172536; padding: 6px 0;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                        <span><strong>Marca:</strong> ${escaparHTML(prod.marca || '-')}</span>
                        <span><strong>Categoria:</strong> ${escaparHTML(prod.categoria || '-')}</span>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <strong>Fornecedor:</strong> ${escaparHTML(nomeFornecedor)} ${localFornecedor ? `(${escaparHTML(localFornecedor)})` : ''}
                    </div>

                    <div style="margin-bottom: 12px;">
                        <strong>Descrição Técnica:</strong><br>
                        <p style="color: #64748b; margin-top: 4px; white-space: pre-wrap;">${escaparHTML(prod.descricao || 'Sem descrição adicional cadastrada.')}</p>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f8fafc; padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #edf2f7;">
                        <div>
                            <span style="font-size: 10px; color: #64748b; font-weight: 700;">QUANTIDADE MÍNIMA</span><br>
                            <strong>${prod.quantidade_minima || 1} unidades</strong>
                        </div>
                        <div>
                            <span style="font-size: 10px; color: #64748b; font-weight: 700;">ESTOQUE DISPONÍVEL</span><br>
                            <strong style="color: ${prod.quantidade_estoque > 0 ? '#16A34A' : '#DC2626'};">${prod.quantidade_estoque || 0} unidades</strong>
                        </div>
                    </div>

                    <div style="text-align: right; margin-top: 15px;">
                        <span style="font-size: 10px; color: #64748b; display: block; font-weight: 700;">PREÇO DE ATACADO</span>
                        <strong style="font-size: 22px; color: #f77f00;">${formatarMoedaBRL(prod.preco_atacado)}</strong>
                    </div>
                </div>
            `,
            showCancelButton: true,
            cancelButtonText: 'Fechar',
            confirmButtonText: '🤝 Iniciar Negociação',
            confirmButtonColor: '#f77f00',
            cancelButtonColor: '#94a3b8'
        }).then((result) => {
            if (result.isConfirmed) {
                abrirModalNegociacao(prod);
            }
        });
    }

    /* =========================================================================
       5. NEGOCIAÇÃO → CRIAÇÃO DO PEDIDO
       O botão 'Negociar' abre um modal com Quantidade e Observação.
       Ao confirmar, insere o pedido na tabela 'pedidos' com status PENDENTE.
       O modal é criado por este script porque o catálogo aparece tanto na
       home.html quanto na catalogo.html.
       ========================================================================= */
    let compradorAtual = null;     // Registro da empresa em 'usuarios'
    let produtoNegociacao = null;  // Produto com o modal aberto

    // Localiza a empresa compradora (tabela 'usuarios') da sessão ativa.
    // O pedido exige sessão real, pois o RLS valida auth.uid().
    async function obterCompradorAutenticado() {
        if (compradorAtual) return compradorAtual;

        try {
            const empresa = await window.SERFUtils.obterEmpresaLogada();
            compradorAtual = empresa?.comprador || null;
            return compradorAtual;
        } catch (err) {
            console.error('[SERF:Catalogo] Falha ao identificar empresa compradora:', err);
            return null;
        }
    }

    function garantirModalNegociacao() {
        if (document.getElementById('modalNegociacao')) return;

        const modal = document.createElement('div');
        modal.id = 'modalNegociacao';
        modal.className = 'modal-serf';
        modal.style.display = 'none';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'negociacaoTitulo');

        modal.innerHTML = `
            <div class="modal-serf-conteudo">
                <div class="modal-serf-header">
                    <h3 id="negociacaoTitulo">Fazer Pedido</h3>
                    <button type="button" class="btn-fechar-modal" data-fechar-negociacao aria-label="Fechar">
                        &times;
                    </button>
                </div>

                <form id="formNegociacao" novalidate>
                    <div class="modal-serf-corpo">

                        <div class="negociacao-produto">
                            <strong id="negociacaoProdutoNome"></strong>
                            <span id="negociacaoFornecedor"></span>
                            <span id="negociacaoPreco" class="negociacao-preco"></span>
                        </div>

                        <div class="linha-dupla">
                            <div class="campo-form">
                                <label for="negociacaoQuantidade">Quantidade *</label>
                                <input type="number" id="negociacaoQuantidade" step="1" required>
                                <small id="negociacaoLimites" class="campo-ajuda"></small>
                            </div>

                            <div class="campo-form">
                                <label>Valor total estimado</label>
                                <strong id="negociacaoTotal" class="negociacao-total">R$ 0,00</strong>
                            </div>
                        </div>

                        <div class="campo-form">
                            <label for="negociacaoObservacao">Observação</label>
                            <textarea
                                id="negociacaoObservacao"
                                rows="3"
                                maxlength="500"
                                placeholder="Prazo desejado, condições de entrega, frete, forma de pagamento..."
                            ></textarea>
                        </div>

                    </div>

                    <div class="modal-serf-footer">
                        <button type="button" class="btn-secondary" data-fechar-negociacao>Cancelar</button>
                        <button type="submit" class="btn-primary" id="btnConfirmarNegociacao">Confirmar Pedido</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelectorAll('[data-fechar-negociacao]').forEach(btn => {
            btn.addEventListener('click', fecharModalNegociacao);
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) fecharModalNegociacao();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                fecharModalNegociacao();
            }
        });

        document.getElementById('negociacaoQuantidade').addEventListener('input', atualizarTotalNegociacao);
        document.getElementById('formNegociacao').addEventListener('submit', confirmarNegociacao);
    }

    async function abrirModalNegociacao(prod) {
        const comprador = await obterCompradorAutenticado();

        if (!comprador) {
            Swal.fire({
                ...swalConfig,
                title: 'Acesso de Comprador Necessário',
                text: 'Faça login com uma empresa compradora para realizar pedidos.',
                icon: 'warning'
            });
            return;
        }

        if (fornecedorAtual && prod.id_fornecedor === fornecedorAtual.id_fornecedor) {
            Swal.fire({
                ...swalConfig,
                title: 'Produto Próprio',
                text: 'Não é possível fazer pedido de um produto da sua própria empresa.',
                icon: 'info'
            });
            return;
        }

        const estoque = Number(prod.quantidade_estoque) || 0;
        const minimo = Math.max(1, Number(prod.quantidade_minima) || 1);

        if (estoque < minimo) {
            Swal.fire({
                ...swalConfig,
                title: 'Sem Estoque',
                text: 'Este produto não possui estoque suficiente para a quantidade mínima de pedido.',
                icon: 'warning'
            });
            return;
        }

        garantirModalNegociacao();
        produtoNegociacao = prod;

        const fornecedor = Array.isArray(prod.fornecedores) ? prod.fornecedores[0] : prod.fornecedores;
        const nomeFornecedor = fornecedor?.razao_social || fornecedor?.nome_fantasia || 'Fornecedor Parceiro';

        document.getElementById('negociacaoProdutoNome').textContent = prod.nome_produto;
        document.getElementById('negociacaoFornecedor').textContent = `Fornecedor: ${nomeFornecedor}`;
        document.getElementById('negociacaoPreco').textContent = `${formatarMoedaBRL(prod.preco_atacado)} / unidade`;

        const inputQtd = document.getElementById('negociacaoQuantidade');
        inputQtd.min = String(minimo);
        inputQtd.max = String(estoque);
        inputQtd.value = String(minimo);

        document.getElementById('negociacaoLimites').textContent =
            `Mínimo: ${minimo} un. • Disponível: ${estoque} un.`;
        document.getElementById('negociacaoObservacao').value = '';

        atualizarTotalNegociacao();

        document.getElementById('modalNegociacao').style.display = 'flex';
        inputQtd.focus();
        inputQtd.select();
    }

    function fecharModalNegociacao() {
        const modal = document.getElementById('modalNegociacao');
        if (modal) modal.style.display = 'none';
        produtoNegociacao = null;
    }

    function atualizarTotalNegociacao() {
        if (!produtoNegociacao) return;

        const quantidade = parseInt(document.getElementById('negociacaoQuantidade').value, 10) || 0;
        const total = quantidade * (Number(produtoNegociacao.preco_atacado) || 0);

        document.getElementById('negociacaoTotal').textContent = formatarMoedaBRL(total);
    }

    // Insert real na tabela 'pedidos'.
    // O valor unitário é recalculado pelo trigger do banco a partir do produto,
    // impedindo que o navegador altere o preço.
    async function criarPedido(prod, quantidade, observacao) {
        const client = obterSupabase();
        if (!client) throw new Error('Conexão com o banco de dados não estabelecida.');

        const { data, error } = await client
            .from('pedidos')
            .insert({
                id_usuario: compradorAtual.id_usuario,
                id_produto: prod.id_produto,
                quantidade: quantidade,
                valor_unitario: Number(prod.preco_atacado),
                status_pedido: 'PENDENTE',
                observacao: observacao || null
            })
            .select('id_pedido, quantidade, valor_total, status_pedido')
            .single();

        if (error) throw error;

        return data;
    }

    async function confirmarNegociacao(evento) {
        evento.preventDefault();

        const prod = produtoNegociacao;
        if (!prod) return;

        const quantidade = parseInt(document.getElementById('negociacaoQuantidade').value, 10);
        const observacao = document.getElementById('negociacaoObservacao').value.trim();
        const minimo = Math.max(1, Number(prod.quantidade_minima) || 1);
        const estoque = Number(prod.quantidade_estoque) || 0;

        if (isNaN(quantidade) || quantidade < minimo) {
            Swal.fire({ ...swalConfig, title: 'Quantidade Inválida', text: `A quantidade mínima para este produto é ${minimo} unidades.`, icon: 'warning' });
            return;
        }
        if (quantidade > estoque) {
            Swal.fire({ ...swalConfig, title: 'Estoque Insuficiente', text: `O fornecedor possui ${estoque} unidades disponíveis.`, icon: 'warning' });
            return;
        }

        const btn = document.getElementById('btnConfirmarNegociacao');
        btn.disabled = true;
        btn.textContent = 'Enviando pedido...';

        try {
            const pedido = await criarPedido(prod, quantidade, observacao);

            fecharModalNegociacao();

            // Avisa a Home para recarregar a lista de pedidos e as métricas
            window.dispatchEvent(new CustomEvent('serf:pedido-criado', { detail: pedido }));

            await Swal.fire({
                ...swalConfig,
                title: `Pedido #${pedido.id_pedido} Enviado!`,
                html: `
                    <strong>${escaparHTML(prod.nome_produto)}</strong> (x${pedido.quantidade})<br>
                    Total: <strong style="color: #f77f00;">${formatarMoedaBRL(pedido.valor_total)}</strong><br><br>
                    O fornecedor foi notificado e o pedido aguarda confirmação.
                `,
                icon: 'success',
                confirmButtonText: 'Ver meus pedidos'
            });

            const painelPedidos = document.getElementById('pedidos');
            if (painelPedidos) {
                painelPedidos.scrollIntoView({ behavior: 'smooth' });
            } else {
                window.location.href = 'home.html#pedidos';
            }
        } catch (error) {
            console.error('[SERF:Catalogo] Falha ao criar pedido:', error);
            Swal.fire({
                ...swalConfig,
                title: 'Erro ao Criar Pedido',
                text: error.message || 'Falha de comunicação com o Supabase.',
                icon: 'error',
                confirmButtonColor: '#d33'
            });
        } finally {
            btn.disabled = false;
            btn.textContent = 'Confirmar Pedido';
        }
    }

    /* =========================================================================
       6. CADASTRO DE NOVO PRODUTO (Modal / Formulário Supabase)
       Insere nome_produto, descricao, categoria, marca, preco_atacado,
       quantidade_minima, quantidade_estoque e id_fornecedor diretamente na tabela.
       ========================================================================= */
    function configurarModalNovoProduto() {
        const modal = document.getElementById('modalNovoProduto');
        const btnAbrir = document.getElementById('btnNovoProduto');
        const btnFechar = document.getElementById('btnFecharModalProduto');
        const btnCancelar = document.getElementById('btnCancelarModalProduto');
        const form = document.getElementById('formNovoProduto');

        function abrirModal() {
            // Regra estrita: No modo 'comprar' NÃO é permitido adicionar produtos
            if (!isModoVenderAtivo()) {
                Swal.fire({
                    ...swalConfig,
                    title: 'Modo Comprar Ativo',
                    text: 'No modo "Comprar" não é permitido adicionar produtos. Alterne para o modo "Vender" no topo da página para gerenciar o catálogo.',
                    icon: 'warning'
                });
                return;
            }

            if (!fornecedorAtual || !fornecedorAtual.id_fornecedor) {
                Swal.fire({
                    ...swalConfig,
                    title: 'Acesso Restrito ao Fornecedor',
                    text: 'Apenas empresas fornecedoras cadastradas podem adicionar produtos ao catálogo.',
                    icon: 'warning'
                });
                return;
            }

            if (modal) {
                modal.style.display = 'flex';
                const inputNome = document.getElementById('prodNome');
                if (inputNome) inputNome.focus();
            }
        }

        function fecharModal() {
            if (modal) {
                modal.style.display = 'none';
            }
            if (form) {
                form.reset();
            }
        }

        // Abre o modal ao clicar no botão #btnNovoProduto
        if (btnAbrir) {
            btnAbrir.addEventListener('click', (e) => {
                e.preventDefault();
                abrirModal();
            });
        }

        // Integração com o botão da Topbar (+ Cadastrar produto no modo Vender)
        const btnAcaoPrincipal = document.getElementById('btnAcaoPrincipal');
        if (btnAcaoPrincipal) {
            btnAcaoPrincipal.addEventListener('click', (e) => {
                const modoVender = document.querySelector('.modo-btn[data-mode="vender"].active');
                if (modoVender && fornecedorAtual) {
                    e.stopImmediatePropagation();
                    abrirModal();
                }
            }, true);
        }

        if (btnFechar) btnFechar.addEventListener('click', fecharModal);
        if (btnCancelar) btnCancelar.addEventListener('click', fecharModal);

        // Fecha ao clicar fora do conteúdo
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) fecharModal();
            });
        }

        // Fecha com tecla ESC
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
                fecharModal();
            }
        });

        // Envio do formulário
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await submeterCadastroProduto(fecharModal);
            });
        }
    }

    async function submeterCadastroProduto(fecharModalCallback) {
        const client = obterSupabase();
        if (!client) return;

        // Validação de segurança: Impede gravação se estiver no modo Comprar
        if (!isModoVenderAtivo()) {
            Swal.fire({
                ...swalConfig,
                title: 'Operação Bloqueada',
                text: 'Não é permitido cadastrar produtos enquanto estiver no modo Comprar.',
                icon: 'error'
            });
            return;
        }

        if (!fornecedorAtual || !fornecedorAtual.id_fornecedor) {
            Swal.fire({
                ...swalConfig,
                title: 'Fornecedor não identificado',
                text: 'Não foi possível associar o produto ao seu cadastro de fornecedor.',
                icon: 'error'
            });
            return;
        }

        // Captura e sanitiza os campos do formulário
        const nomeProduto = document.getElementById('prodNome')?.value.trim();
        const categoria = document.getElementById('prodCategoria')?.value.trim();
        const marca = document.getElementById('prodMarca')?.value.trim();
        const descricao = document.getElementById('prodDescricao')?.value.trim() || '';
        const precoAtacado = parseFloat(document.getElementById('prodPreco')?.value);
        const qtdMinima = parseInt(document.getElementById('prodQtdMinima')?.value, 10);
        const estoque = parseInt(document.getElementById('prodEstoque')?.value, 10) || 0;

        // Validações de integridade conforme banco de dados
        if (!nomeProduto) {
            Swal.fire({ ...swalConfig, title: 'Campo Obrigatório', text: 'Informe o nome do produto.', icon: 'warning' });
            return;
        }
        if (!categoria) {
            Swal.fire({ ...swalConfig, title: 'Campo Obrigatório', text: 'Selecione uma categoria.', icon: 'warning' });
            return;
        }
        if (!marca) {
            Swal.fire({ ...swalConfig, title: 'Campo Obrigatório', text: 'Informe a marca ou fabricante.', icon: 'warning' });
            return;
        }
        if (isNaN(precoAtacado) || precoAtacado <= 0) {
            Swal.fire({ ...swalConfig, title: 'Preço Inválido', text: 'O preço de atacado deve ser maior que zero.', icon: 'warning' });
            return;
        }
        if (isNaN(qtdMinima) || qtdMinima <= 0) {
            Swal.fire({ ...swalConfig, title: 'Quantidade Inválida', text: 'A quantidade mínima de pedido deve ser de no mínimo 1.', icon: 'warning' });
            return;
        }

        const btnSalvar = document.getElementById('btnSalvarProduto');
        if (btnSalvar) {
            btnSalvar.disabled = true;
            btnSalvar.textContent = 'Salvando no Banco...';
        }

        Swal.fire({
            title: 'Gravando Produto...',
            text: 'Inserindo especificações na tabela de produtos do Supabase.',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            // Objeto de inserção com as colunas oficiais da migration 001_estrutura_inicial.sql
            const novoProduto = {
                id_fornecedor: fornecedorAtual.id_fornecedor,
                nome_produto: nomeProduto,
                descricao: descricao,
                categoria: categoria,
                marca: marca,
                preco_atacado: precoAtacado,
                quantidade_minima: qtdMinima,
                quantidade_estoque: estoque,
                ativo: true
            };

            const { data, error } = await client
                .from('produtos')
                .insert([novoProduto])
                .select();

            if (error) {
                throw error;
            }

            Swal.close();

            Swal.fire({
                ...swalConfig,
                title: 'Produto Cadastrado!',
                text: `"${nomeProduto}" foi adicionado com sucesso ao catálogo do S.E.R.F.`,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });

            if (typeof fecharModalCallback === 'function') {
                fecharModalCallback();
            }

            // Recarrega os produtos atualizados imediatamente
            await buscarProdutos();

        } catch (error) {
            Swal.close();
            console.error('[SERF:Catalogo] Falha ao inserir produto no Supabase:', error);
            Swal.fire({
                ...swalConfig,
                title: 'Erro ao Cadastrar',
                text: 'Falha técnica ao gravar no Supabase: ' + (error.message || error.details || 'Verifique as permissões de acesso.'),
                icon: 'error',
                confirmButtonColor: '#d33'
            });
        } finally {
            if (btnSalvar) {
                btnSalvar.disabled = false;
                btnSalvar.textContent = 'Salvar Produto';
            }
        }
    }

    /* =========================================================================
       7. INTEGRAÇÃO COM MUDANÇA DE MODO (COMPRAR / VENDER)
       ========================================================================= */
    function configurarObservadorDeModo() {
        document.querySelectorAll('.modo-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Em páginas como catalogo.html onde a Home (js/home/) não gerencia o switch,
                // atualiza visualmente os botões
                document.querySelectorAll('.modo-btn').forEach(b => {
                    const ativo = b === e.currentTarget;
                    b.classList.toggle('active', ativo);
                    b.setAttribute('aria-pressed', String(ativo));
                });

                // Atualiza a visibilidade do botão de cadastro imediatamente
                atualizarVisibilidadeBotaoCadastro();

                // Pequeno atraso para sincronização e recarregamento dos dados
                setTimeout(() => {
                    atualizarVisibilidadeBotaoCadastro();
                    buscarProdutos();
                }, 50);
            });
        });
    }

    /* =========================================================================
       8. INICIALIZAÇÃO DO MÓDULO
       ========================================================================= */
    // Na catalogo.html (sem os scripts da Home), a chave Comprar/Vender só aparece para
    // empresas com perfil "Ambos". Na Home, js/home/ faz esse controle.
    async function ajustarModosCatalogo() {
        if (typeof window.alterarModo === 'function') return;

        const modoSwitch = document.getElementById('modoSwitch');
        if (!modoSwitch) return;

        const comprador = await obterCompradorAutenticado();
        const fornecedor = fornecedorAtual;

        if (!comprador && !fornecedor) return;

        const ambos = Boolean(comprador && fornecedor);
        modoSwitch.hidden = !ambos;

        if (!ambos) {
            const modoUnico = fornecedor ? 'vender' : 'comprar';
            document.querySelectorAll('.modo-btn').forEach(botao => {
                const ativo = botao.dataset.mode === modoUnico;
                botao.classList.toggle('active', ativo);
                botao.setAttribute('aria-pressed', String(ativo));
            });
        }
    }

    async function inicializarCatalogo() {
        console.info('[SERF] Inicializando módulo catalogo.js...');
        await verificarFornecedorAutenticado();
        await ajustarModosCatalogo();
        configurarModalNovoProduto();
        configurarObservadorDeModo();
        atualizarVisibilidadeBotaoCadastro();
        await buscarProdutos();
    }

    // Exporta API pública do catálogo para o escopo global
    window.CatalogoModule = {
        buscarProdutos,
        renderizarProdutos,
        verificarFornecedorAutenticado,
        atualizarVisibilidadeBotaoCadastro,
        isModoVenderAtivo,
        abrirModalNegociacao,
        getFornecedorAtual: () => fornecedorAtual
    };

    // Auto-inicialização quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializarCatalogo);
    } else {
        inicializarCatalogo();
    }
})();

