// =========================================================================
// S.E.R.F. - ONBOARDING (SCRUM-8 + SCRUM-10)
// Fluxo em 3 etapas, busca de CEP via BrasilAPI e UPDATE no Supabase.
// =========================================================================

const db = window.SERF.db;
const PAGINAS = window.SERF.PAGINAS;
const NICHOS = window.SERF.NICHOS;
const traduzirErro = window.SERF.traduzirErro;

const PAGINA_LOGIN = PAGINAS.LOGIN;
const PAGINA_HOME = PAGINAS.HOME;

// Estado da sessão em memória: quem é o usuário e em quais tabelas ele existe.
const contexto = {
  userId: null,
  email: null,
  empresa: null,
  tabelas: [], // ex.: ['usuarios'] ou ['usuarios', 'fornecedores']
  passo: 1
};

const TOTAL_PASSOS = 3;


// ---------------------------------------------------------------- elementos
const form = document.getElementById('formOnboarding');
const btnAvancar = document.getElementById('btnAvancar');
const btnVoltar = document.getElementById('btnVoltar');
const btnConcluir = document.getElementById('btnConcluir');
const btnSair = document.getElementById('btnSair');
const aviso = document.getElementById('aviso');
const trilhaPreenchida = document.getElementById('trilhaPreenchida');
const itensTrilha = document.querySelectorAll('.trilha-item');
const etapas = document.querySelectorAll('.etapa');
const statusCep = document.getElementById('statusCep');
const contadorNichos = document.getElementById('contadorNichos');

const campoCep = document.getElementById('cep');
const campoTelefone = document.getElementById('telefone');
const campoIE = document.getElementById('inscricaoEstadual');
const checkIsento = document.getElementById('isentoIE');

// =========================================================================
// 1. SESSÃO: descobre quem está logado e quais tabelas atualizar
// =========================================================================
async function iniciar() {
  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    window.location.replace(PAGINA_LOGIN);
    return;
  }

  contexto.userId = session.user.id;
  contexto.email = session.user.email;

  const [comprador, fornecedor] = await Promise.all([
    db.from('usuarios')
      .select('nome_empresa, onboarding_completo')
      .eq('auth_user_id', contexto.userId)
      .maybeSingle(),
    db.from('fornecedores')
      .select('razao_social, onboarding_completo')
      .eq('auth_user_id', contexto.userId)
      .maybeSingle()
  ]);

  if (comprador.data) {
    contexto.tabelas.push('usuarios');
    contexto.empresa = comprador.data.nome_empresa;
  }

  if (fornecedor.data) {
    contexto.tabelas.push('fornecedores');
    contexto.empresa = contexto.empresa || fornecedor.data.razao_social;
  }

  if (contexto.tabelas.length === 0) {
    mostrarAviso('Não encontramos o cadastro desta conta. Entre em contato com o suporte do SERF.');
    btnAvancar.disabled = true;
    return;
  }

  // Onboarding já concluído em todos os perfis: não faz sentido repetir.
  const jaConcluido =
    (!comprador.data || comprador.data.onboarding_completo === true) &&
    (!fornecedor.data || fornecedor.data.onboarding_completo === true);

  if (jaConcluido) {
    window.location.replace(PAGINA_HOME);
    return;
  }

  document.getElementById('saudacao').textContent = contexto.empresa
    ? `Conta de ${contexto.empresa}`
    : `Conta ${contexto.email}`;

  montarNichos();
}

// A etapa 3 monta um bloco de nichos por papel da conta. No perfil "Ambos"
// isso evita gravar a mesma lista nas duas tabelas, misturando o que a
// empresa compra com o que ela vende.
function gruposDeNichos() {
  const compra = contexto.tabelas.includes('usuarios');
  const venda = contexto.tabelas.includes('fornecedores');
  const grupos = [];

  if (compra) {
    grupos.push({
      tabela: 'usuarios',
      titulo: venda ? 'O que sua empresa compra' : 'Quais categorias sua empresa costuma comprar?'
    });
  }

  if (venda) {
    grupos.push({
      tabela: 'fornecedores',
      titulo: compra ? 'O que sua empresa vende' : 'Quais categorias sua empresa fornece?'
    });
  }

  return grupos;
}

function montarNichos() {
  const container = document.getElementById('blocosNichos');

  container.innerHTML = gruposDeNichos()
    .map(
      (grupo) => `
      <div class="bloco-nichos">
        <p class="pergunta-nichos" id="titulo-${grupo.tabela}">${grupo.titulo}</p>
        <div class="nichos" role="group" aria-labelledby="titulo-${grupo.tabela}">
          ${NICHOS.map(
            (nicho, i) => `
            <label class="nicho">
              <input type="checkbox" data-tabela="${grupo.tabela}" value="${nicho}"
                     id="nicho-${grupo.tabela}-${i}" />
              <span>${nicho}</span>
            </label>`
          ).join('')}
        </div>
      </div>`
    )
    .join('');

  container.addEventListener('change', atualizarContadorNichos);
}

// Sem argumento, devolve todos os selecionados; com tabela, só os daquele bloco.
function nichosSelecionados(tabela) {
  const seletor = tabela
    ? `#blocosNichos input[data-tabela="${tabela}"]:checked`
    : '#blocosNichos input:checked';

  return Array.from(document.querySelectorAll(seletor)).map((c) => c.value);
}

// Toda tabela da conta precisa de ao menos um nicho, senão a CHECK
// ck_*_onboarding_completo rejeita o UPDATE no banco.
function tabelaSemNicho() {
  return contexto.tabelas.find((tabela) => nichosSelecionados(tabela).length === 0);
}

function atualizarContadorNichos() {
  const total = nichosSelecionados().length;
  contadorNichos.textContent =
    total === 0 ? 'Escolha ao menos uma categoria.' : `${total} categoria(s) selecionada(s).`;
  contadorNichos.classList.remove('erro');
}

// =========================================================================
// 2. NAVEGAÇÃO ENTRE ETAPAS
// =========================================================================
function irPara(passo) {
  contexto.passo = passo;

  etapas.forEach((e) => e.classList.toggle('ativa', Number(e.dataset.passo) === passo));

  itensTrilha.forEach((item) => {
    const n = Number(item.dataset.passo);
    item.classList.toggle('ativa', n === passo);
    item.classList.toggle('concluida', n < passo);
  });

  trilhaPreenchida.style.width = `${(passo / TOTAL_PASSOS) * 100}%`;

  btnVoltar.hidden = passo === 1;
  btnAvancar.hidden = passo === TOTAL_PASSOS;
  btnConcluir.hidden = passo !== TOTAL_PASSOS;

  esconderAviso();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

btnAvancar.addEventListener('click', () => {
  if (!validarPasso(contexto.passo)) return;
  irPara(contexto.passo + 1);
});

btnVoltar.addEventListener('click', () => irPara(contexto.passo - 1));

btnSair.addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.replace(PAGINA_LOGIN);
});

// Enter não deve pular etapas nem enviar o formulário antes da hora.
form.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && contexto.passo < TOTAL_PASSOS) {
    e.preventDefault();
    btnAvancar.click();
  }
});

// =========================================================================
// 3. VALIDAÇÃO POR ETAPA
// =========================================================================
function marcarErro(elemento, mensagem) {
  elemento.classList.add('invalido');
  elemento.focus();
  mostrarAviso(mensagem);
  return false;
}

function limparErros(passo) {
  document
    .querySelector(`.etapa[data-passo="${passo}"]`)
    .querySelectorAll('.invalido')
    .forEach((el) => el.classList.remove('invalido'));
}

function validarPasso(passo) {
  limparErros(passo);
  esconderAviso();

  if (passo === 1) {
    const ie = campoIE.value.replace(/\D/g, '');
    if (!checkIsento.checked && ie.length < 8) {
      return marcarErro(campoIE, 'Informe a inscrição estadual ou marque a opção de isenta.');
    }

    const tel = campoTelefone.value.replace(/\D/g, '');
    if (tel.length < 10) {
      return marcarErro(campoTelefone, 'O telefone precisa ter DDD e número completo.');
    }

    const responsavel = document.getElementById('responsavel');
    if (responsavel.value.trim().length < 3) {
      return marcarErro(responsavel, 'Escreva o nome de quem responde pela conta.');
    }
  }

  if (passo === 2) {
    const cep = campoCep.value.replace(/\D/g, '');
    if (cep.length !== 8) {
      return marcarErro(campoCep, 'O CEP precisa ter 8 dígitos.');
    }

    const obrigatorios = [
      ['logradouro', 'Preencha a rua.'],
      ['numero', 'Preencha o número.'],
      ['bairro', 'Preencha o bairro.'],
      ['cidade', 'Preencha a cidade.'],
      ['estado', 'Preencha a UF com 2 letras.']
    ];

    for (const [id, mensagem] of obrigatorios) {
      const el = document.getElementById(id);
      if (!el.value.trim()) return marcarErro(el, mensagem);
    }

    if (document.getElementById('estado').value.trim().length !== 2) {
      return marcarErro(document.getElementById('estado'), 'A UF precisa ter 2 letras. Ex.: SP.');
    }
  }

  if (passo === 3) {
    const faltando = tabelaSemNicho();
    if (faltando) {
      contadorNichos.classList.add('erro');
      mostrarAviso(
        faltando === 'usuarios'
          ? 'Escolha ao menos uma categoria que sua empresa compra.'
          : 'Escolha ao menos uma categoria que sua empresa fornece.'
      );
      return false;
    }
  }

  return true;
}

function mostrarAviso(texto) {
  aviso.textContent = texto;
  aviso.hidden = false;
}

function esconderAviso() {
  aviso.hidden = true;
}

// =========================================================================
// 4. MÁSCARAS E BUSCA DE CEP (BrasilAPI)
// =========================================================================
campoTelefone.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 10) v = v.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  else if (v.length > 6) v = v.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
  else if (v.length > 2) v = v.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
  e.target.value = v;
});

checkIsento.addEventListener('change', () => {
  campoIE.disabled = checkIsento.checked;
  if (checkIsento.checked) {
    campoIE.value = '';
    campoIE.classList.remove('invalido');
    campoIE.placeholder = 'Isenta';
  } else {
    campoIE.placeholder = 'Somente números';
  }
});

campoCep.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) v = v.replace(/^(\d{5})(\d{0,3})$/, '$1-$2');
  e.target.value = v;

  if (v.replace(/\D/g, '').length === 8) buscarCep(v.replace(/\D/g, ''));
});

async function buscarCep(cep) {
  statusCep.textContent = 'Buscando endereço…';
  statusCep.className = 'dica carregando';

  try {
    const resposta = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    if (!resposta.ok) throw new Error('CEP não encontrado.');

    const endereco = await resposta.json();

    document.getElementById('logradouro').value = endereco.street || '';
    document.getElementById('bairro').value = endereco.neighborhood || '';
    document.getElementById('cidade').value = endereco.city || '';
    document.getElementById('estado').value = endereco.state || '';

    statusCep.textContent = 'Endereço preenchido. Confira antes de continuar.';
    statusCep.className = 'dica';

    // O número nunca vem do CEP, então mandamos o cursor para lá.
    document.getElementById('numero').focus();
  } catch (erro) {
    statusCep.textContent = 'Não encontramos esse CEP. Preencha o endereço manualmente.';
    statusCep.className = 'dica erro';
  }
}

document.getElementById('estado').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
});

// =========================================================================
// 5. SCRUM-10: PERSISTÊNCIA NO SUPABASE
// =========================================================================
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!validarPasso(3)) return;

  btnConcluir.disabled = true;
  btnConcluir.textContent = 'Salvando…';

  // Campos comuns às duas tabelas.
  const comuns = {
    nome_responsavel: document.getElementById('responsavel').value.trim(),
    inscricao_estadual: checkIsento.checked ? 'ISENTO' : campoIE.value.replace(/\D/g, ''),
    isento_ie: checkIsento.checked,
    telefone: campoTelefone.value.replace(/\D/g, ''),
    cep: campoCep.value.replace(/\D/g, ''),
    logradouro: document.getElementById('logradouro').value.trim(),
    numero: document.getElementById('numero').value.trim(),
    complemento: document.getElementById('complemento').value.trim() || null,
    bairro: document.getElementById('bairro').value.trim(),
    cidade: document.getElementById('cidade').value.trim(),
    estado: document.getElementById('estado').value.trim().toUpperCase(),
    raio_atuacao_km: Number(document.getElementById('raioAtuacao').value),
    onboarding_completo: true,
    onboarding_concluido_em: new Date().toISOString()
  };

  // status_cadastro tem CHECK diferente em cada tabela, então cada uma
  // avança para o próprio estado seguinte após o onboarding.
  const porTabela = {
    usuarios: {
      ...comuns,
      nichos: nichosSelecionados('usuarios'),
      status_cadastro: 'PENDENTE_VALIDACAO'
    },
    fornecedores: {
      ...comuns,
      nichos: nichosSelecionados('fornecedores'),
      status_cadastro: 'PENDENTE'
    }
  };

  try {
    // Atualiza cada tabela onde essa conta existe (perfil híbrido atualiza as duas).
    // O select devolve auth_user_id porque a PK tem nome diferente em cada tabela.
    const atualizacoes = contexto.tabelas.map((tabela) =>
      db.from(tabela)
        .update(porTabela[tabela])
        .eq('auth_user_id', contexto.userId)
        .select('auth_user_id')
    );

    const resultados = await Promise.all(atualizacoes);

    const falha = resultados.find((r) => r.error);
    if (falha) throw falha.error;

    const semLinhaAfetada = resultados.some((r) => !r.data || r.data.length === 0);
    if (semLinhaAfetada) {
      throw new Error('Nenhum registro foi atualizado. Verifique as políticas de acesso da tabela.');
    }

    window.location.href = PAGINA_HOME;
  } catch (erro) {
    console.error('Erro ao salvar onboarding:', erro);
    mostrarAviso(`Não conseguimos salvar seus dados: ${traduzirErro(erro)}`);
    btnConcluir.disabled = false;
    btnConcluir.textContent = 'Salvar e entrar';
  }
});

// ---------------------------------------------------------------- boot
iniciar();
