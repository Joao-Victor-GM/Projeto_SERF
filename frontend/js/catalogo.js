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
    let listaProdutosCache = []; // Produtos já carregados (todas as páginas)

    // Busca, segmento, ordenação e páginas: tudo no servidor. Antes o
    // catálogo baixava a rede inteira (e a API corta em 1.000 linhas).
    const TAMANHO_PAGINA = 24;
    const filtros = { termo: "", categoria: "", ordem: "recentes", pagina: 0, total: null };
    let buscaEmAndamento = 0;   // descarta respostas de buscas antigas (digitação rápida)

    // A consulta fica na camada de dados (produtos.repositorio.js)
    const limparTermo = termo => window.SERFDados.produtos.limparTermo(termo);

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
    // proximaPagina = true: acrescenta a próxima página à lista atual
    async function buscarProdutos({ proximaPagina = false } = {}) {
        const client = obterSupabase();
        const container = document.getElementById('listaProdutos');

        // Páginas sem a lista (ex.: Home usa só a negociação/cadastro): nada a buscar
        if (!container) return [];

        if (!client) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Erro: Conexão com o banco de dados não estabelecida.</p>';
            }
            return [];
        }

        filtros.pagina = proximaPagina ? filtros.pagina + 1 : 0;
        const minhaBusca = ++buscaEmAndamento;
        const botaoMais = document.getElementById('catalogoMais');
        if (botaoMais) botaoMais.disabled = true;

        if (container && !proximaPagina) {
            container.setAttribute('aria-busy', 'true');
            container.innerHTML = '<p class="empty-state">Carregando catálogo de produtos...</p>';
        }

        try {
            // Sincroniza a visibilidade do botão de cadastro com o modo atual
            atualizarVisibilidadeBotaoCadastro();

            // Detecta se a tela está no modo 'vender' (Painel Meus Produtos)
            const isModoVender = isModoVenderAtivo();

            // "Meus produtos" (vender): só os da empresa, inclusive pausados
            const meusProdutos = isModoVender && fornecedorAtual && fornecedorAtual.id_fornecedor;

            const titulo = document.getElementById('produtosTitulo');
            const subtitulo = document.getElementById('produtosSubtitulo');
            if (meusProdutos) {
                if (titulo) titulo.textContent = 'Meus Produtos (Painel do Vendedor)';
                if (subtitulo) subtitulo.textContent = `Itens cadastrados por ${fornecedorAtual.razao_social}`;
            } else {
                if (titulo) titulo.textContent = 'Catálogo de Produtos';
                if (subtitulo) subtitulo.textContent = 'Explore insumos industriais e mercadorias com preço de atacado';
            }

            let resultado, error = null;
            try {
                resultado = await window.SERFDados.produtos.catalogo({
                    termo: filtros.termo,
                    categoria: filtros.categoria,
                    ordem: filtros.ordem,
                    pagina: filtros.pagina,
                    tamanho: TAMANHO_PAGINA,
                    idFornecedor: meusProdutos ? fornecedorAtual.id_fornecedor : null
                });
            } catch (erroConsulta) {
                error = erroConsulta;
            }

            if (minhaBusca !== buscaEmAndamento) return listaProdutosCache;   // chegou outra busca depois

            if (error) {
                throw error;
            }

            const pagina = resultado.produtos;
            listaProdutosCache = proximaPagina ? [...listaProdutosCache, ...pagina] : pagina;
            filtros.total = resultado.total;

            renderizarProdutos(listaProdutosCache);
            atualizarResumo(pagina.length);
            container.removeAttribute('aria-busy');
            return listaProdutosCache;

        } catch (error) {
            if (minhaBusca !== buscaEmAndamento) return listaProdutosCache;
            container?.removeAttribute('aria-busy');
            console.error('[SERF:Catalogo] Falha ao buscar produtos:', error);
            if (container) {
                container.innerHTML = `
                    <div class="empty-state" data-css="color: #dc2626;">
                        <p><strong>Não foi possível carregar os produtos.</strong></p>
                        <small>${escaparHTML(window.SERFUtils.mensagemDeErro(error))}</small>
                    </div>
                `;
            }
            return [];
        }
    }

    // "Mostrando 24 de 130 produtos" + botão "Carregar mais"
    function atualizarResumo(recebidosNestaPagina) {
        const resumo = document.getElementById('catalogoResumo');
        const botaoMais = document.getElementById('catalogoMais');
        const mostrando = listaProdutosCache.length;
        const haMais = filtros.total !== null ? mostrando < filtros.total : recebidosNestaPagina === TAMANHO_PAGINA;

        if (resumo) {
            resumo.textContent = mostrando === 0 ? ''
                : filtros.total !== null
                    ? `Mostrando ${mostrando} de ${filtros.total} produto${filtros.total === 1 ? '' : 's'}`
                    : `Mostrando ${mostrando} produto${mostrando === 1 ? '' : 's'}`;
        }
        if (botaoMais) {
            botaoMais.hidden = !haMais;
            botaoMais.disabled = false;
        }
    }

    function configurarFiltros() {
        const form = document.getElementById('catalogoFiltros');
        if (!form) return;

        const categoria = document.getElementById('catalogoCategoria');
        (window.SERFUtils.CATEGORIAS_PRODUTO || []).forEach(nome => categoria.add(new Option(nome, nome)));

        let espera = null;
        document.getElementById('catalogoBusca').addEventListener('input', evento => {
            clearTimeout(espera);
            espera = setTimeout(() => { filtros.termo = evento.target.value; buscarProdutos(); }, 300);
        });
        form.addEventListener('submit', evento => {
            evento.preventDefault();
            clearTimeout(espera);
            filtros.termo = document.getElementById('catalogoBusca').value;
            buscarProdutos();
        });
        categoria.addEventListener('change', () => { filtros.categoria = categoria.value; buscarProdutos(); });
        document.getElementById('catalogoOrdem').addEventListener('change', evento => {
            filtros.ordem = evento.target.value;
            buscarProdutos();
        });
        document.getElementById('catalogoMais')?.addEventListener('click', () => buscarProdutos({ proximaPagina: true }));
    }

    /* =========================================================================
       4. RENDERIZAÇÃO DINÂMICA DOS CARDS (#listaProdutos)
       Renderiza: Marca, Categoria, Nome, Descrição, Preço formatado (R$),
       Qtd Mínima, Estoque, Fornecedor e o botão 'Iniciar Negociação'.
       ========================================================================= */
    // Card do PRÓPRIO produto (modo Vender): editar e pausar/reativar.
    // Card de outro fornecedor: detalhes, carrinho e negociação.
    function rodapeDoCard(prod, nomeFornecedor) {
        const meu = isModoVenderAtivo() && fornecedorAtual && prod.id_fornecedor === fornecedorAtual.id_fornecedor;

        if (meu) {
            const pausado = prod.ativo === false;
            return `
                    <div class="produto-card-footer produto-card-gestao">
                        <button type="button" class="btn-secondary btn-editar-produto" data-id="${prod.id_produto}">
                            ✎ Editar preço e estoque
                        </button>
                        <button type="button" class="btn-secondary btn-alternar-produto" data-id="${prod.id_produto}">
                            ${pausado ? '▶ Reativar' : '❚❚ Pausar vendas'}
                        </button>
                    </div>`;
        }

        const semEstoque = (Number(prod.quantidade_estoque) || 0) < (Number(prod.quantidade_minima) || 1);

        return `
                    <div class="produto-card-footer" data-css="display: flex; gap: 8px;">
                        <button
                            type="button"
                            class="btn-secondary btn-ver-detalhes"
                            data-id="${prod.id_produto}"
                            title="Visualizar todos os detalhes deste produto"
                            data-css="flex: 0 0 auto; min-height: 38px; padding: 0 12px; font-size: 11px;"
                        >
                            Ver mais
                        </button>
                        <button
                            type="button"
                            class="btn-secondary btn-adicionar-carrinho"
                            data-id="${prod.id_produto}"
                            ${semEstoque ? 'disabled title="Sem estoque para o pedido mínimo"' : 'title="Adicionar ao carrinho"'}
                            data-css="flex: 0 0 auto; min-height: 38px; padding: 0 12px; font-size: 11px;"
                        >
                            <svg class="serf-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg> Adicionar
                        </button>
                        <button
                            type="button"
                            class="btn-iniciar-negociacao"
                            data-id="${prod.id_produto}"
                            data-preco="${prod.preco_atacado}"
                            data-nome="${escaparHTML(prod.nome_produto)}"
                            data-fornecedor="${escaparHTML(nomeFornecedor)}"
                            data-css="flex: 1;"
                        >
                            <span>Negociar →</span>
                        </button>
                    </div>`;
    }

    function renderizarProdutos(produtos) {
        const container = document.getElementById('listaProdutos');
        if (!container) return;

        if (!produtos || produtos.length === 0) {
            const filtrando = Boolean(limparTermo(filtros.termo) || filtros.categoria);
            container.innerHTML = `
                <div class="empty-state catalogo-vazio" data-css="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
                    <p class="catalogo-vazio-titulo">
                        ${filtrando ? 'Nenhum produto encontrado com esses filtros.' : 'Nenhum produto disponível no momento.'}
                    </p>
                    <small>
                        ${filtrando
                            ? 'Tente outro nome ou segmento — ou <a href="cotacoes.html">peça uma cotação</a> e receba propostas dos fornecedores.'
                            : 'Novas ofertas aparecem aqui assim que os fornecedores da rede cadastram.'}
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

            const pausado = prod.ativo === false;

            return `
                <article class="produto-card${pausado ? ' pausado' : ''}" data-id="${prod.id_produto}">
                    <div class="produto-card-header">
                        <div class="produto-tags">
                            <span class="produto-badge categoria">${escaparHTML(prod.categoria || 'Geral')}</span>
                            <span class="produto-badge marca">${escaparHTML(prod.marca || 'Original')}</span>
                            ${pausado ? '<span class="produto-selo-pausado">Vendas pausadas</span>' : ''}
                        </div>
                        <div class="produto-fornecedor" title="${escaparHTML(nomeFornecedor)}">
                            <span class="fornecedor-icone" aria-hidden="true"><svg class="serf-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/></svg></span>
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

                    ${rodapeDoCard(prod, nomeFornecedor)}
                </article>
            `;
        }).join('');

        const produtoDo = botao => listaProdutosCache.find(p => p.id_produto === Number(botao.dataset.id));

        // Gestão do próprio produto (produtos-gestao.js)
        container.querySelectorAll('.btn-editar-produto').forEach(botao => {
            botao.addEventListener('click', () => {
                const prod = produtoDo(botao);
                if (prod) window.SERFGestaoProdutos.editar(prod, () => buscarProdutos());
            });
        });

        container.querySelectorAll('.btn-alternar-produto').forEach(botao => {
            botao.addEventListener('click', () => {
                const prod = produtoDo(botao);
                if (prod) window.SERFGestaoProdutos.alternarAtivo(prod, () => buscarProdutos());
            });
        });

        // Carrinho (carrinho.js)
        container.querySelectorAll('.btn-adicionar-carrinho').forEach(botao => {
            botao.addEventListener('click', () => {
                const prod = produtoDo(botao);
                if (prod && window.SERFCarrinho) window.SERFCarrinho.adicionar(prod);
            });
        });

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
            // titleText: o nome vem de outro fornecedor e não pode virar HTML
            titleText: prod.nome_produto,
            html: `
                <div data-css="text-align: left; font-size: 13px; line-height: 1.6; color: #172536; padding: 6px 0;">
                    <div data-css="display: flex; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                        <span><strong>Marca:</strong> ${escaparHTML(prod.marca || '-')}</span>
                        <span><strong>Categoria:</strong> ${escaparHTML(prod.categoria || '-')}</span>
                    </div>

                    <div data-css="margin-bottom: 12px;">
                        <strong>Fornecedor:</strong> ${escaparHTML(nomeFornecedor)} ${localFornecedor ? `(${escaparHTML(localFornecedor)})` : ''}
                    </div>

                    <div data-css="margin-bottom: 12px;">
                        <strong>Descrição Técnica:</strong><br>
                        <p data-css="color: #64748b; margin-top: 4px; white-space: pre-wrap;">${escaparHTML(prod.descricao || 'Sem descrição adicional cadastrada.')}</p>
                    </div>

                    <div data-css="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f8fafc; padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #edf2f7;">
                        <div>
                            <span data-css="font-size: 10px; color: #64748b; font-weight: 700;">QUANTIDADE MÍNIMA</span><br>
                            <strong>${prod.quantidade_minima || 1} unidades</strong>
                        </div>
                        <div>
                            <span data-css="font-size: 10px; color: #64748b; font-weight: 700;">ESTOQUE DISPONÍVEL</span><br>
                            <strong data-css="color: ${prod.quantidade_estoque > 0 ? '#15803D' : '#B91C1C'};">${prod.quantidade_estoque || 0} unidades</strong>
                        </div>
                    </div>

                    <div data-css="text-align: right; margin-top: 15px;">
                        <span data-css="font-size: 10px; color: #64748b; display: block; font-weight: 700;">PREÇO DE ATACADO</span>
                        <strong data-css="font-size: 22px; color: #AD5309;">${formatarMoedaBRL(prod.preco_atacado)}</strong>
                    </div>
                </div>
            `,
            showCancelButton: true,
            cancelButtonText: 'Fechar',
            confirmButtonText: 'Iniciar negociação →',
            confirmButtonColor: '#B4570B',
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
                    Total: <strong data-css="color: #AD5309;">${formatarMoedaBRL(pedido.valor_total)}</strong><br><br>
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
                text: window.SERFUtils.mensagemDeErro(error),
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
    let abrirCadastro = () => {};

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

        abrirCadastro = abrirModal;

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
        const ncm = (document.getElementById('prodNcm')?.value || '').replace(/\D/g, '');

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
        if (ncm && ncm.length !== 8) {
            Swal.fire({ ...swalConfig, title: 'NCM Inválido', text: 'O NCM tem 8 números (ex.: 7208.51.00).', icon: 'warning' });
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
                ativo: true,
                // Só com valor: sem a migration 027 a coluna não existe
                ...(ncm && { ncm })
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
                text: window.SERFUtils.mensagemDeErro(error),
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
        if (window.SERFHome) return;

        const modoSwitch = document.getElementById('modoSwitch');
        if (!modoSwitch) return;

        const comprador = await obterCompradorAutenticado();
        const fornecedor = fornecedorAtual;

        if (!comprador && !fornecedor) return;

        const ambos = Boolean(comprador && fornecedor);
        modoSwitch.hidden = !ambos;

        // catalogo.html?modo=vender abre direto em "Meus Produtos" (ex.: alertas de estoque)
        const modoPedido = new URLSearchParams(window.location.search).get('modo');

        let modoInicial = null;
        if (!ambos) modoInicial = fornecedor ? 'vender' : 'comprar';
        else if (modoPedido === 'vender' || modoPedido === 'comprar') modoInicial = modoPedido;

        if (modoInicial) {
            document.querySelectorAll('.modo-btn').forEach(botao => {
                const ativo = botao.dataset.mode === modoInicial;
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
        configurarFiltros();
        configurarObservadorDeModo();
        atualizarVisibilidadeBotaoCadastro();
        await buscarProdutos();

        // catalogo.html?modo=vender&novo=1 → já abre o cadastro de produto
        if (new URLSearchParams(window.location.search).get('novo') === '1' && isModoVenderAtivo()) {
            abrirCadastro();
        }
    }

    // Exporta API pública do catálogo para o escopo global
    window.CatalogoModule = {
        buscarProdutos,
        renderizarProdutos,
        verificarFornecedorAutenticado,
        atualizarVisibilidadeBotaoCadastro,
        isModoVenderAtivo,
        abrirModalNegociacao,
        abrirCadastroProduto: () => abrirCadastro(),
        getFornecedorAtual: () => fornecedorAtual
    };

    // Auto-inicialização quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializarCatalogo);
    } else {
        inicializarCatalogo();
    }
})();

