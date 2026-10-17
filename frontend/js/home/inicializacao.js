/* ==========================================================
   S.E.R.F. — HOME / INICIALIZACAO.JS
   Cabeçalho da empresa, modos disponíveis, pedido pela URL e
   inicialização da Home (seção 21).

   A Home é dividida em scripts clássicos que compartilham o escopo
   global, carregados nesta ordem (todos com defer):
     estado.js → dashboard.js → eventos.js → chat.js →
     pedido-modal.js → tempo-real.js → inicializacao.js
   Só inicializacao.js executa algo ao carregar (iniciarHome()).
   ========================================================== */

"use strict";


/* ==========================================================
   21 — INICIALIZAÇÃO DA HOME
   Configura a interface e carrega os pedidos do Supabase.
   ========================================================== */

// Exibe o nome e a inicial da empresa no cabeçalho.
function exibirEmpresaAtiva(nome) {
    elementos.empresaAtiva.textContent = nome;

    const avatar = document.querySelector(".profile-avatar");
    if (avatar) {
        avatar.textContent = nome.trim().charAt(0).toUpperCase();
    }
}

// Mostra a chave Comprar/Vender apenas para empresas com perfil "Ambos";
// as demais ficam fixas no único modo que possuem.
function ajustarModosDisponiveis() {

    const comprador = empresaLogada.idUsuario !== null;
    const fornecedor = empresaLogada.idFornecedor !== null;

    // Sem cadastro identificado, mantém a interface como está.
    if (!comprador && !fornecedor) return;

    const ambos = comprador && fornecedor;

    if (elementos.modoSwitch) {
        elementos.modoSwitch.hidden = !ambos;
    }

    if (!ambos) {
        const modoUnico = fornecedor ? "vender" : "comprar";
        if (estado.modo !== modoUnico) {
            alterarModo(modoUnico);
        }
    }
}

// home.html?pedido=ID (ex.: "Último pedido" da página Empresas)
async function abrirPedidoDaUrl() {
    const parametros = new URLSearchParams(window.location.search);
    const idPedido = Number(parametros.get("pedido"));

    if (!idPedido) return;

    // Limpa o parâmetro para um F5 não reabrir o modal
    history.replaceState(null, "", window.location.pathname + window.location.hash);

    await abrirPedidoPorId(idPedido);
}

// Abre o modal de um pedido pelo id (links, alertas, Radar de Oportunidades).
// Busca no servidor se estiver fora do recorte do painel. Retorna false se
// a empresa não participa do pedido.
async function abrirPedidoPorId(idPedido) {
    const pedido = pedidosCache.find(item => item.id === idPedido)
        || await buscarPedidoPorId(idPedido);

    if (!pedido) {
        console.warn(`[SERF:Home] Pedido #${idPedido} não encontrado para esta empresa.`);
        return false;
    }

    // Empresa "Ambos": muda para o modo em que ela participa do pedido
    if (!pedido.modos.includes(estado.modo)) {
        alterarModo(pedido.modos[0]);
    }

    abrirDetalhesPedido(pedido);
    return true;
}

async function recarregarPedidos() {
    try {
        await buscarPedidosSupabase();
        estado.carregamento = "ok";
    } catch (erro) {
        console.error("[SERF:Home] Falha ao buscar pedidos:", erro);
        estado.carregamento = "erro";
        estado.mensagemErro = erro.message || "Erro de comunicação com o Supabase";
    }

    // Conversas dependem dos pedidos carregados; falha aqui não derruba o painel.
    try {
        await buscarConversasSupabase();
    } catch (erro) {
        console.error("[SERF:Home] Falha ao buscar conversas:", erro);
    }

    preencherFiltroEmpresas();
    atualizarDashboard();
}

async function iniciarHome() {

    // Identifica a empresa no cabeçalho pelo cache do login.
    let modoInicial = "comprar";
    let nomeLocal = null;

    try {
        const dados = JSON.parse(localStorage.getItem("usuario_logado") || "null");

        if (dados) {
            nomeLocal = dados.razaoSocial || null;

            if (dados.perfil === "Fornecedor") {
                modoInicial = "vender";
            }
        }
    } catch (erro) {
        console.warn("[SERF:Home] Falha ao ler localStorage usuario_logado:", erro);
    }

    exibirEmpresaAtiva(nomeLocal || "Carregando...");

    // Ativa as interações e mostra o estado de carregamento.
    configurarNavegacao();
    configurarFiltros();
    configurarIndicadores();
    configurarAcoes();
    configurarChat();

    alterarModo(modoInicial);

    // Carrega os pedidos reais e redesenha o painel.
    await recarregarPedidos();

    if (!nomeLocal) {
        exibirEmpresaAtiva(empresaLogada.nome || "Empresa não identificada");
    }

    ajustarModosDisponiveis();

    // Links de outras páginas: home.html?pedido=ID abre o pedido (com o chat)
    await abrirPedidoDaUrl();

    // Pedido criado pelo catálogo (catalogo.js) entra na lista na hora.
    window.addEventListener("serf:pedido-criado", recarregarPedidos);

    // O Realtime precisa do token da sessão (auth-check.js) antes de assinar.
    await window.serfSessao;

    // Status alterado pela outra empresa aparece sem recarregar a página.
    assinarPedidosTempoReal();

    // Novas mensagens atualizam "Conversas recentes" e o contador.
    assinarMensagensTempoReal();

    // Pagamentos (migration 009) atualizam a seção de pagamento ao vivo.
    assinarPagamentosTempoReal();

    // NF-e (migration 010) aparece ao vivo para o comprador.
    assinarNotasTempoReal();

    // Plano B das conversas: recarrega ao voltar para a aba e a cada 30 s.
    const atualizarConversas = async () => {
        if (document.hidden || estado.carregamento !== "ok") return;

        try {
            await buscarConversasSupabase();
            renderizarConversas();
            atualizarIndicadores();
        } catch (erro) {
            console.warn("[SERF:Home] Falha ao atualizar conversas:", erro);
        }
    };

    setInterval(atualizarConversas, 30000);
    document.addEventListener("visibilitychange", atualizarConversas);

    console.info("[SERF] Home inicializada com pedidos do Supabase.");
}

// O script utiliza defer no HTML.
// Portanto, os elementos já estarão disponíveis.
iniciarHome();
