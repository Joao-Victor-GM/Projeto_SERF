/* =========================================================================
   S.E.R.F. — CATÁLOGO B2B & GESTÃO DE PRODUTOS (catalogo.js)
   Módulos:
   - Catálogo de Produtos B2B com Chave Estrangeira de Fornecedores
   - Painel do Vendedor: "Meus Produtos" do Fornecedor Autenticado
   - Negociação Instantânea e Cadastro Direto no Supabase
   ========================================================================= */

"use strict";

(function () {
    // 1. CONFIGURAÇÕES DE CONEXÃO AO SUPABASE
    const SUPABASE_URL = 'https://rparlqdgcwzoanpqqeof.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC';

    // Garante que window.supabaseClient esteja disponível
    function obterSupabase() {
        if (window.supabaseClient) {
            return window.supabaseClient;
        }
        if (typeof supabase !== 'undefined' && supabase.createClient) {
            window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            return window.supabaseClient;
        }
        console.error('[SERF:Catalogo] Biblioteca do Supabase JS não foi carregada no documento.');
        return null;
    }

    // Configuração de Estilo do SweetAlert2 (Identidade Visual SERF)
    const swalConfig = {
        background: '#ffffff',
        color: '#1d2d5c',
        confirmButtonColor: '#f77f00'
    };

    // Estado local do módulo
    let fornecedorAtual = null; // Armazena dados se o usuário for fornecedor
    let listaProdutosCache = []; // Cache dos produtos em memória

    // Utilitário para escapar caracteres HTML prevenindo XSS
    function escaparHTML(texto) {
        if (texto === null || texto === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(texto);
        return div.innerHTML;
    }

    // Utilitário para formatar moeda brasileira (R$)
    function formatarMoedaBRL(valor) {
        const numero = Number(valor) || 0;
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(numero);
    }

    /* =========================================================================
       2. VERIFICAÇÃO DE FORNECEDOR (Painel do Vendedor)
       Verifica na tabela 'fornecedores' se o usuário autenticado (auth_user_id)
       é um fornecedor cadastrado.
       ========================================================================= */
    async function verificarFornecedorAutenticado() {
        const client = obterSupabase();
        if (!client) return null;

        let authUserId = null;

        // A) Tenta ler usuário na sessão ativa do Supabase Auth
        try {
            const { data: { session } } = await client.auth.getSession();
            if (session?.user?.id) {
                authUserId = session.user.id;
            }
        } catch (err) {
            console.warn('[SERF:Catalogo] Verificação de sessão Supabase:', err);
        }

        // B) Fallback: se não recuperado pela sessão, busca no cache local de login
        if (!authUserId) {
            try {
                const salvo = localStorage.getItem('usuario_logado');
                if (salvo) {
                    const parsed = JSON.parse(salvo);
                    if (parsed.uid) authUserId = parsed.uid;
                }
            } catch (e) {
                console.warn('[SERF:Catalogo] Falha ao ler localStorage usuario_logado:', e);
            }
        }

        if (!authUserId) {
            console.info('[SERF:Catalogo] Usuário anônimo ou sem ID de autenticação.');
            atualizarVisibilidadeBotaoCadastro(false);
            return null;
        }

        // C) Consulta a tabela fornecedores usando o auth_user_id
        try {
            const { data, error } = await client
                .from('fornecedores')
                .select('id_fornecedor, auth_user_id, razao_social, nome_fantasia, cnpj, email, status_cadastro')
                .eq('auth_user_id', authUserId)
                .maybeSingle();

            if (error) {
                console.error('[SERF:Catalogo] Erro ao consultar tabela fornecedores:', error);
                atualizarVisibilidadeBotaoCadastro(false);
                return null;
            }

            if (data && data.id_fornecedor) {
                fornecedorAtual = data;
                console.info(`[SERF:Catalogo] Fornecedor autenticado: ${data.razao_social} (ID: ${data.id_fornecedor})`);
                atualizarVisibilidadeBotaoCadastro(true);
                return data;
            } else {
                fornecedorAtual = null;
                atualizarVisibilidadeBotaoCadastro(false);
                return null;
            }

        } catch (err) {
            console.error('[SERF:Catalogo] Erro inesperado na verificação de fornecedor:', err);
            atualizarVisibilidadeBotaoCadastro(false);
            return null;
        }
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
                    fornecedores (
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

                    <div class="produto-card-footer">
                        <button
                            type="button"
                            class="btn-iniciar-negociacao"
                            data-id="${prod.id_produto}"
                            data-preco="${prod.preco_atacado}"
                            data-nome="${escaparHTML(prod.nome_produto)}"
                            data-fornecedor="${escaparHTML(nomeFornecedor)}"
                        >
                            <span>🤝 Iniciar Negociação</span>
                        </button>
                    </div>
                </article>
            `;
        }).join('');

        // Vincula o evento de Iniciar Negociação em todos os botões gerados
        container.querySelectorAll('.btn-iniciar-negociacao').forEach(botao => {
            botao.addEventListener('click', (evento) => {
                const btn = evento.currentTarget;
                const idProduto = btn.dataset.id;
                const preco = Number(btn.dataset.preco) || 0;
                const nome = btn.dataset.nome || 'Produto';
                const fornecedor = btn.dataset.fornecedor || 'Fornecedor';

                iniciarNegociacao(idProduto, preco, nome, fornecedor);
            });
        });
    }

    /* =========================================================================
       5. BOTÃO "INICIAR NEGOCIAÇÃO"
       Salva ID e Preço no localStorage (produto_selecionado) e redireciona
       para a tela de pagamento / pedidos.
       ========================================================================= */
    function iniciarNegociacao(idProduto, preco, nome, fornecedor) {
        // Grava no localStorage sob a chave 'produto_selecionado'
        const payloadSelecao = {
            id: Number(idProduto),
            id_produto: Number(idProduto),
            preco: preco,
            preco_atacado: preco,
            nome_produto: nome,
            fornecedor: fornecedor,
            selecionado_em: new Date().toISOString()
        };

        localStorage.setItem('produto_selecionado', JSON.stringify(payloadSelecao));
        console.info('[SERF:Catalogo] Produto selecionado para negociação:', payloadSelecao);

        // Feedback profissional com SweetAlert2
        Swal.fire({
            ...swalConfig,
            title: 'Negociação Iniciada!',
            html: `
                Você selecionou: <strong>${escaparHTML(nome)}</strong><br>
                Fornecedor: <strong>${escaparHTML(fornecedor)}</strong><br>
                Preço Atacado: <strong style="color: #f77f00;">${formatarMoedaBRL(preco)}</strong><br><br>
                Redirecionando para a área de pedidos e pagamento...
            `,
            icon: 'success',
            timer: 2000,
            showConfirmButton: false
        }).then(() => {
            // Redireciona para o painel de pedidos / pagamento
            const painelPedidos = document.getElementById('pedidos');
            if (painelPedidos) {
                window.location.hash = '#pedidos';
                painelPedidos.scrollIntoView({ behavior: 'smooth' });

                // Destaca o link de pedidos no menu lateral se houver
                document.querySelectorAll('.nav-item').forEach(item => {
                    item.classList.remove('active');
                    if (item.getAttribute('href') === '#pedidos') {
                        item.classList.add('active');
                    }
                });
            } else {
                window.location.href = 'home.html#pedidos';
            }
        });
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
                // Em páginas como catalogo.html onde home.js não gerencia o switch,
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
    async function inicializarCatalogo() {
        console.info('[SERF] Inicializando módulo catalogo.js...');
        await verificarFornecedorAutenticado();
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
        iniciarNegociacao,
        getFornecedorAtual: () => fornecedorAtual
    };

    // Auto-inicialização quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializarCatalogo);
    } else {
        inicializarCatalogo();
    }
})();

