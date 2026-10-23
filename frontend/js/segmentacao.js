// Segmentação (onboarding): perfil e nicho da empresa. Antes era script
// inline com onclick no HTML; a CSP agora proíbe script inline.

"use strict";

// Cliente Supabase (supabaseClient) e utilitários vêm de supabase-client.js e utils.js
const { swalConfig } = window.SERFUtils;

let etapaAtual = 1;
let perfilEscolhido = null;
let nichoEscolhido = null;

// Função para Seleção do Perfil (Passo 1)
function selecionarPerfil(perfil) {
    perfilEscolhido = perfil;

    const cards = {
        Comprador: 'cardComprador',
        Fornecedor: 'cardFornecedor',
        Ambos: 'cardAmbos'
    };

    Object.entries(cards).forEach(([nome, id]) => {
        document.getElementById(id).classList.toggle('selecionado', nome === perfil);
    });

    // Habilita o botão para avançar
    document.getElementById('btnProximo').disabled = false;
}

// Função para Seleção do Nicho (Passo 2)
function selecionarNicho(nicho, elemento) {
    nichoEscolhido = nicho;

    // Remove a classe selecionado de todos os cards de nicho
    const cards = document.querySelectorAll('.card-nicho');
    cards.forEach(c => c.classList.remove('selecionado'));

    // Adiciona ao selecionado
    elemento.classList.add('selecionado');

    document.getElementById('btnProximo').disabled = false;
}

// Navegação: Avançar Passo
function avancarPasso() {
    if (etapaAtual === 1) {
        etapaAtual = 2;
        document.getElementById('etapa1').classList.remove('ativa');
        document.getElementById('etapa2').classList.add('ativa');

        document.getElementById('btnVoltar').classList.remove('invisivel');
        document.getElementById('barraProgresso').style.width = '100%';

        // Só libera o avançar (que virou Concluir) se já escolheu um nicho
        document.getElementById('btnProximo').innerText = 'Concluir';
        if (!nichoEscolhido) {
            document.getElementById('btnProximo').disabled = true;
        }
    } else if (etapaAtual === 2) {
        finalizarCadastroOnboarding();
    }
}

// Navegação: Voltar Passo
function voltarPasso() {
    if (etapaAtual === 2) {
        etapaAtual = 1;
        document.getElementById('etapa2').classList.remove('ativa');
        document.getElementById('etapa1').classList.add('ativa');

        document.getElementById('btnVoltar').classList.add('invisivel');
        document.getElementById('barraProgresso').style.width = '50%';
        document.getElementById('btnProximo').innerText = 'Avançar';
        document.getElementById('btnProximo').disabled = false; // Perfil já está escolhido
    }
}

// Conclusão e Persistência no Banco do Supabase
async function finalizarCadastroOnboarding() {
    const btn = document.getElementById('btnProximo');

    // A empresa é identificada pela sessão do Supabase Auth, nunca pelo localStorage.
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session?.user) {
        Swal.fire({
            ...swalConfig,
            title: 'Sessão Expirada',
            text: 'Faça login novamente para concluir a configuração da empresa.',
            icon: 'warning'
        }).then(() => {
            window.location.replace('login-cadastro.html');
        });
        return;
    }

    // Ativa tela de carregamento do SweetAlert2
    Swal.fire({
        title: 'Salvando suas Preferências...',
        text: 'Configurando o painel B2B para a sua empresa.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    btn.innerText = 'Salvando...';
    btn.disabled = true;

    try {
        // Uma única chamada: o servidor cria/remove os cadastros de comprador e
        // fornecedor e conclui o onboarding numa transação (migration 005).
        const { error: rpcError } = await supabaseClient.rpc('atualizar_segmentacao_usuario', {
            p_perfil: perfilEscolhido,
            p_nicho: nichoEscolhido
        });

        if (rpcError) throw rpcError;

        // Atualiza o token para trazer o metadado segmentacao_concluida = true
        await supabaseClient.auth.refreshSession();

        // Dados SOMENTE para exibição na Home, lidos do cadastro da própria empresa
        const user = session.user;
        const [comprador, fornecedor] = await Promise.all([
            supabaseClient.from('usuarios').select('nome_empresa, cnpj').eq('auth_user_id', user.id).maybeSingle(),
            supabaseClient.from('fornecedores').select('razao_social, cnpj').eq('auth_user_id', user.id).maybeSingle()
        ]);

        const usuarioLogado = {
            razaoSocial: comprador.data?.nome_empresa || fornecedor.data?.razao_social || user.user_metadata?.razao_social,
            cnpj: comprador.data?.cnpj || fornecedor.data?.cnpj || null,
            email: user.email,
            perfil: perfilEscolhido,
            nicho: nichoEscolhido
        };
        localStorage.setItem('usuario_logado', JSON.stringify(usuarioLogado));

        Swal.close();

        const descricaoPerfil = {
            Comprador: 'compradora',
            Fornecedor: 'fornecedora',
            Ambos: 'compradora e fornecedora'
        }[perfilEscolhido];

        Swal.fire({
            ...swalConfig,
            title: 'Onboarding Concluído!',
            text: `Bem-vindo ao S.E.R.F.! Sua empresa foi cadastrada como ${descricaoPerfil} no nicho de ${nichoEscolhido}.`,
            icon: 'success',
            confirmButtonText: 'Acessar Painel'
        }).then(() => {
            window.location.href = '../app/home.html';
        });

    } catch (error) {
        Swal.close();
        console.error('Falha técnica ao salvar preferências:', error);
        Swal.fire({
            ...swalConfig,
            title: 'Erro Crítico',
            text: 'Não foi possível salvar as preferências: ' + error.message,
            icon: 'error',
            confirmButtonColor: '#d33'
        });
        btn.innerText = 'Concluir';
        btn.disabled = false;
    }
}

// A segmentação exige sessão ativa: sem login, volta para a tela de acesso.
supabaseClient.auth.getSession().then(({ data }) => {
    if (!data?.session) {
        window.location.replace('login-cadastro.html');
    }
});

// Eventos (antes eram onclick="..." no HTML; a CSP proíbe script inline)
function aoEscolher(seletor, acao) {
    document.querySelectorAll(seletor).forEach(card => {
        card.addEventListener('click', () => acao(card));
        card.addEventListener('keydown', evento => {
            if (evento.key !== 'Enter' && evento.key !== ' ') return;
            evento.preventDefault();
            acao(card);
        });
    });
}

aoEscolher('[data-perfil]', card => selecionarPerfil(card.dataset.perfil));
aoEscolher('[data-nicho]', card => selecionarNicho(card.dataset.nicho, card));
document.getElementById('btnProximo').addEventListener('click', avancarPasso);
document.getElementById('btnVoltar').addEventListener('click', voltarPasso);
