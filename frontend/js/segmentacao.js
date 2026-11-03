// Segmentação (onboarding): perfil e nicho da empresa. Antes era script
// inline com onclick no HTML; a CSP agora proíbe script inline.

"use strict";

// Cliente Supabase (supabaseClient) e utilitários vêm de supabase-client.js e utils.js
const { swalConfig } = window.SERFUtils;

let etapaAtual = 1;
let perfilEscolhido = null;
let nichoEscolhido = null;

function normalizarTextoBusca(texto) {
    return String(texto || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function obterNichoPersonalizado() {
    const campo = document.getElementById("outroNichoInput");
    return campo ? campo.value.trim().replace(/\s+/g, " ") : "";
}

function obterNichoFinal() {
    if (!nichoEscolhido) return "";
    if (nichoEscolhido === "Outros") return obterNichoPersonalizado();
    return nichoEscolhido;
}

function atualizarBotaoEtapa2() {
    if (etapaAtual !== 2) return;
    const final = obterNichoFinal();
    const valido = nichoEscolhido === "Outros" ? final.length >= 2 : Boolean(final);
    document.getElementById("btnProximo").disabled = !valido;
}

// Função para Seleção do Perfil (Passo 1)
function selecionarPerfil(perfil) {
    perfilEscolhido = perfil;

    const cards = {
        Comprador: "cardComprador",
        Fornecedor: "cardFornecedor",
        Ambos: "cardAmbos"
    };

    Object.entries(cards).forEach(([nome, id]) => {
        const el = document.getElementById(id);
        const ativo = nome === perfil;
        el.classList.toggle("selecionado", ativo);
        el.setAttribute("aria-checked", String(ativo));
    });

    // Habilita o botão para avançar
    document.getElementById("btnProximo").disabled = false;
}

// Função para Seleção do Nicho (Passo 2)
function selecionarNicho(nicho, elemento) {
    nichoEscolhido = nicho;

    const cards = document.querySelectorAll(".card-nicho");
    cards.forEach(c => {
        const ativo = c === elemento;
        c.classList.toggle("selecionado", ativo);
        c.setAttribute("aria-checked", String(ativo));
    });

    const blocoOutro = document.getElementById("campoOutroNicho");
    const inputOutro = document.getElementById("outroNichoInput");
    const ehOutros = nicho === "Outros";

    if (blocoOutro) {
        blocoOutro.hidden = !ehOutros;
        if (ehOutros && inputOutro) {
            blocoOutro.scrollIntoView({ behavior: "smooth", block: "nearest" });
            inputOutro.focus({ preventScroll: true });
        }
    }

    atualizarBotaoEtapa2();
}

function filtrarNichos() {
    const busca = normalizarTextoBusca(document.getElementById("buscaNicho")?.value);
    const cards = document.querySelectorAll(".card-nicho");
    let encontrados = 0;

    cards.forEach(card => {
        const ehOutros = card.dataset.nicho === "Outros";
        if (!busca || ehOutros) {
            card.hidden = false;
            if (!ehOutros) encontrados += 1;
            return;
        }

        const textoCard = normalizarTextoBusca(card.textContent);
        const casa = textoCard.includes(busca);
        card.hidden = !casa;
        if (casa) encontrados += 1;
    });

    const aviso = document.getElementById("nichoSemResultado");
    if (aviso) aviso.hidden = !busca || encontrados > 0;
}

function aplicarSugestaoCnaeInicial() {
    if (nichoEscolhido) return;
    let sugestao = null;
    try { sugestao = JSON.parse(sessionStorage.getItem("serf-sugestao-cnae") || "null"); } catch { /* sem armazenamento */ }
    if (!sugestao?.nicho) return;

    const card = [...document.querySelectorAll(".card-nicho")].find(c => c.dataset.nicho === sugestao.nicho);
    if (!card) return;

    if (sugestao.nicho === "Outros" && sugestao.outroTexto) {
        const inputOutro = document.getElementById("outroNichoInput");
        if (inputOutro && !inputOutro.value) inputOutro.value = sugestao.outroTexto;
    }

    selecionarNicho(sugestao.nicho, card);
}

// Navegação: Avançar Passo
function avancarPasso() {
    if (etapaAtual === 1) {
        if (!perfilEscolhido) return;
        etapaAtual = 2;
        document.getElementById("etapa1").classList.remove("ativa");
        document.getElementById("etapa2").classList.add("ativa");

        document.getElementById("btnVoltar").classList.remove("invisivel");
        document.getElementById("barraProgresso").style.width = "100%";

        document.getElementById("btnProximo").innerText = "Concluir";
        aplicarSugestaoCnaeInicial();
        atualizarBotaoEtapa2();
        window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (etapaAtual === 2) {
        finalizarCadastroOnboarding();
    }
}

// Navegação: Voltar Passo
function voltarPasso() {
    if (etapaAtual === 2) {
        etapaAtual = 1;
        document.getElementById("etapa2").classList.remove("ativa");
        document.getElementById("etapa1").classList.add("ativa");

        document.getElementById("btnVoltar").classList.add("invisivel");
        document.getElementById("barraProgresso").style.width = "50%";
        document.getElementById("btnProximo").innerText = "Avançar";
        document.getElementById("btnProximo").disabled = false;
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

// Conclusão e Persistência no Banco do Supabase
async function finalizarCadastroOnboarding() {
    const btn = document.getElementById("btnProximo");
    const nichoFinal = obterNichoFinal();

    if (nichoEscolhido === "Outros" && nichoFinal.length < 2) {
        Swal.fire({
            ...swalConfig,
            title: "Especifique o seu nicho",
            text: "Digite ao menos 2 caracteres descrevendo o ramo de atividade da sua empresa.",
            icon: "warning"
        });
        document.getElementById("outroNichoInput")?.focus();
        return;
    }

    if (!nichoFinal) return;

    // A empresa é identificada pela sessão do Supabase Auth, nunca pelo localStorage.
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session?.user) {
        Swal.fire({
            ...swalConfig,
            title: "Sessão Expirada",
            text: "Faça login novamente para concluir a configuração da empresa.",
            icon: "warning"
        }).then(() => {
            window.location.replace("login-cadastro.html");
        });
        return;
    }

    // Ativa tela de carregamento do SweetAlert2
    Swal.fire({
        title: "Salvando suas Preferências...",
        text: "Configurando o painel B2B para a sua empresa.",
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    btn.innerText = "Salvando...";
    btn.disabled = true;

    try {
        // Uma única chamada: o servidor cria/remove os cadastros de comprador e
        // fornecedor e conclui o onboarding numa transação (migrations 005 e 033).
        const { error: rpcError } = await supabaseClient.rpc("atualizar_segmentacao_usuario", {
            p_perfil: perfilEscolhido,
            p_nicho: nichoFinal
        });

        if (rpcError) throw rpcError;

        // Atualiza o token para trazer o metadado segmentacao_concluida = true
        await supabaseClient.auth.refreshSession();

        // Dados SOMENTE para exibição na Home, lidos do cadastro da própria empresa
        const user = session.user;
        const [comprador, fornecedor] = await Promise.all([
            supabaseClient.from("usuarios").select("nome_empresa, cnpj").eq("auth_user_id", user.id).maybeSingle(),
            supabaseClient.from("fornecedores").select("razao_social, cnpj").eq("auth_user_id", user.id).maybeSingle()
        ]);

        const usuarioLogado = {
            razaoSocial: comprador.data?.nome_empresa || fornecedor.data?.razao_social || user.user_metadata?.razao_social,
            cnpj: comprador.data?.cnpj || fornecedor.data?.cnpj || null,
            email: user.email,
            perfil: perfilEscolhido,
            nicho: nichoFinal
        };
        localStorage.setItem("usuario_logado", JSON.stringify(usuarioLogado));

        Swal.close();

        const descricaoPerfil = {
            Comprador: "compradora",
            Fornecedor: "fornecedora",
            Ambos: "compradora e fornecedora"
        }[perfilEscolhido];

        Swal.fire({
            ...swalConfig,
            title: "Onboarding Concluído!",
            text: `Bem-vindo ao S.E.R.F.! Sua empresa foi cadastrada como ${descricaoPerfil} no nicho de ${nichoFinal}.`,
            icon: "success",
            confirmButtonText: "Acessar Painel"
        }).then(() => {
            window.location.href = "../app/home.html";
        });

    } catch (error) {
        Swal.close();
        console.error("Falha técnica ao salvar preferências:", error);
        Swal.fire({
            ...swalConfig,
            title: "Erro Crítico",
            text: "Não foi possível salvar as preferências. " + window.SERFUtils.mensagemDeErro(error),
            icon: "error",
            confirmButtonColor: "#d33"
        });
        btn.innerText = "Concluir";
        atualizarBotaoEtapa2();
    }
}

// A segmentação exige sessão ativa: sem login, volta para a tela de acesso.
supabaseClient.auth.getSession().then(({ data }) => {
    if (!data?.session) {
        window.location.replace("login-cadastro.html");
    }
});

// Eventos (antes eram onclick="..." no HTML; a CSP proíbe script inline)
function aoEscolher(seletor, acao) {
    document.querySelectorAll(seletor).forEach(card => {
        card.addEventListener("click", () => acao(card));
        card.addEventListener("keydown", evento => {
            if (evento.key !== "Enter" && evento.key !== " ") return;
            evento.preventDefault();
            acao(card);
        });
    });
}

aoEscolher("[data-perfil]", card => selecionarPerfil(card.dataset.perfil));
aoEscolher("[data-nicho]", card => selecionarNicho(card.dataset.nicho, card));

document.getElementById("buscaNicho")?.addEventListener("input", filtrarNichos);

const inputOutro = document.getElementById("outroNichoInput");
if (inputOutro) {
    inputOutro.addEventListener("input", atualizarBotaoEtapa2);
    inputOutro.addEventListener("keydown", evento => {
        if (evento.key === "Enter" && !document.getElementById("btnProximo").disabled) {
            evento.preventDefault();
            avancarPasso();
        }
    });
}

document.getElementById("btnProximo").addEventListener("click", avancarPasso);
document.getElementById("btnVoltar").addEventListener("click", voltarPasso);
