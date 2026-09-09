// =========================================================================
// S.E.R.F. - LOGIN, CADASTRO E RECUPERAÇÃO (app-v2.js)
// Depende de supabase-config.js, que deve ser carregado antes.
// =========================================================================

const supabaseClient = window.SERF.db;
const PAGINAS = window.SERF.PAGINAS;
const traduzirErro = window.SERF.traduzirErro;

// 2. CAPTURA DOS ELEMENTOS DO HTML (DOM)
const formCadastro = document.getElementById('formCadastro');
const formLogin = document.getElementById('formLogin');
const cnpjCadastro = document.getElementById('cnpjCadastro');
const cnpjLogin = document.getElementById('cnpjLogin');
const campoRazao = document.getElementById('razaoSocialCadastro');

// =========================================================================
// FUNCIONALIDADE 1: MÁSCARA DE CNPJ EM TEMPO REAL
// =========================================================================
function aplicarMascaraCNPJ(inputElement) {
    if (!inputElement) return;

    inputElement.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');

        if (value.length > 14) {
            value = value.slice(0, 14);
        }

        if (value.length > 12) {
            value = value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})$/, "$1.$2.$3/$4-$5");
        } else if (value.length > 8) {
            value = value.replace(/^(\d{2})(\d{3})(\d{3})(\d{1,4})$/, "$1.$2.$3/$4");
        } else if (value.length > 5) {
            value = value.replace(/^(\d{2})(\d{3})(\d{1,3})$/, "$1.$2.$3");
        } else if (value.length > 2) {
            value = value.replace(/^(\d{2})(\d{1,3})$/, "$1.$2");
        }

        e.target.value = value;
    });
}

aplicarMascaraCNPJ(cnpjCadastro);
aplicarMascaraCNPJ(cnpjLogin);

// =========================================================================
// FUNCIONALIDADE 2: VALIDAÇÃO DE CNPJ E AUTO-PREENCHIMENTO (BRASILAPI)
// =========================================================================
if (cnpjCadastro) {
    cnpjCadastro.addEventListener('blur', async () => {
        const cnpjLimpo = cnpjCadastro.value.replace(/\D/g, '');

        if (cnpjLimpo.length !== 14) return;

        try {
            campoRazao.placeholder = 'Buscando dados na Receita Federal...';
            campoRazao.value = '';

            const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);

            if (!resposta.ok) {
                throw new Error('CNPJ inválido ou inexistente na Receita Federal.');
            }

            const dadosEmpresa = await resposta.json();
            campoRazao.value = dadosEmpresa.razao_social;

            // Avisa cedo se o CNPJ já tem conta, em vez de deixar o erro
            // aparecer só depois de o usuário preencher senha e e-mail.
            const { data: jaExiste } = await supabaseClient.rpc('cnpj_existe', { p_cnpj: cnpjLimpo });

            if (jaExiste) {
                alert('Este CNPJ já possui conta no SERF. Faça login ou recupere sua senha.');
            }
        } catch (error) {
            alert('Erro na validação do CNPJ: ' + traduzirErro(error));
            cnpjCadastro.value = '';
            campoRazao.value = '';
            campoRazao.placeholder = 'Razão Social';
        }
    });
}

// =========================================================================
// FUNCIONALIDADE 3: FLUXO DE CADASTRO (CRIAR CONTA)
// =========================================================================
if (formCadastro) {
    formCadastro.addEventListener('submit', async (e) => {
        e.preventDefault();

        const botao = formCadastro.querySelector('button[type="submit"]');
        const email = document.getElementById('emailCadastro').value.trim();
        const senha = document.getElementById('senhaCadastro').value;
        const cnpj = cnpjCadastro.value.replace(/\D/g, '');
        const razaoSocial = campoRazao.value.trim();
        const perfilSelecionado = document.querySelector('input[name="perfil"]:checked').value;

        if (cnpj.length !== 14) {
            alert('Por favor, digite um CNPJ válido com 14 números.');
            return;
        }
        if (!razaoSocial) {
            alert('Por favor, preencha ou valide a Razão Social antes de continuar.');
            return;
        }
        if (senha.length < 6) {
            alert('A senha precisa ter no mínimo 6 caracteres.');
            return;
        }

        botao.disabled = true;
        botao.innerText = 'Criando conta...';

        try {
            // Checagem prévia: a RPC devolve só true/false, nunca o e-mail.
            const { data: jaExiste, error: errCheck } = await supabaseClient
                .rpc('cnpj_existe', { p_cnpj: cnpj });

            if (errCheck) throw errCheck;
            if (jaExiste) {
                throw new Error('Este CNPJ já possui conta no SERF.');
            }

            // SCRUM-9: os dados da empresa viajam em options.data.
            // O trigger tr_novo_usuario_serf lê esses campos e grava em
            // usuarios e/ou fornecedores na MESMA transação do signUp.
            // Por isso o cadastro funciona mesmo com confirmação de e-mail
            // ligada, quando ainda não existe sessão no navegador.
            const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                email: email,
                password: senha,
                options: {
                    data: {
                        perfil: perfilSelecionado,
                        razao_social: razaoSocial,
                        cnpj: cnpj
                    }
                }
            });

            if (authError) throw authError;

            formCadastro.reset();

            if (authData.session) {
                alert('Conta criada. Vamos configurar seu perfil.');
                window.location.href = PAGINAS.ONBOARDING;
            } else {
                alert('Conta criada. Confirme o e-mail que enviamos e depois faça login.');
                document.getElementById('container').classList.remove('right-panel-active');
            }
        } catch (error) {
            console.error('Erro no cadastro:', error);
            alert('Não foi possível criar a conta: ' + traduzirErro(error));
        } finally {
            botao.disabled = false;
            botao.innerText = 'Cadastrar';
        }
    });
}

// =========================================================================
// FUNCIONALIDADE 4: FLUXO DE LOGIN (ENTRAR COM CNPJ + SENHA)
// =========================================================================
if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();

        const botao = formLogin.querySelector('button[type="submit"]');
        const cnpj = cnpjLogin.value.replace(/\D/g, '');
        const senha = document.getElementById('senhaLogin').value;

        if (cnpj.length !== 14) {
            alert('Por favor, insira o CNPJ completo com 14 dígitos.');
            return;
        }

        botao.disabled = true;
        botao.innerText = 'Entrando...';

        try {
            // Descobre o e-mail vinculado ao CNPJ. Roda sem sessão, então
            // precisa ser via RPC: com RLS ligado, um SELECT direto nas
            // tabelas volta vazio. A função tem freio contra varredura.
            const { data: emailAssociadoAoCnpj, error: errBusca } = await supabaseClient
                .rpc('email_por_cnpj', { p_cnpj: cnpj });

            if (errBusca) throw errBusca;

            if (!emailAssociadoAoCnpj) {
                throw new Error('CNPJ ou senha incorretos.');
            }

            const { data: sessionData, error: loginError } = await supabaseClient.auth.signInWithPassword({
                email: emailAssociadoAoCnpj,
                password: senha
            });

            if (loginError) throw loginError;

            // Decide o destino: onboarding pendente ou home.
            const uuidLogado = sessionData.user.id;

            const [registroComprador, registroFornecedor] = await Promise.all([
                supabaseClient.from('usuarios')
                    .select('onboarding_completo').eq('auth_user_id', uuidLogado).maybeSingle(),
                supabaseClient.from('fornecedores')
                    .select('onboarding_completo').eq('auth_user_id', uuidLogado).maybeSingle()
            ]);

            const registros = [registroComprador.data, registroFornecedor.data].filter(Boolean);

            // Só libera a home quando todos os perfis da conta estão configurados.
            const onboardingPendente =
                registros.length === 0 || registros.some((r) => r.onboarding_completo !== true);

            window.location.href = onboardingPendente ? PAGINAS.ONBOARDING : PAGINAS.HOME;
        } catch (error) {
            console.error('Erro no login:', error);
            alert('Falha ao entrar: ' + traduzirErro(error));
            botao.disabled = false;
            botao.innerText = 'Entrar';
        }
    });
}

// =========================================================================
// FUNCIONALIDADE 5: RECUPERAÇÃO DE SENHA
//
// Agora pede o E-MAIL, não o CNPJ. Dois motivos:
//  - resetPasswordForEmail não revela se a conta existe, então some o
//    oráculo que confirmava quais CNPJs estão cadastrados;
//  - não precisa resolver CNPJ -> e-mail sem sessão.
// =========================================================================
const modalRecuperar = document.getElementById('modalRecuperar');
const linkEsqueceuSenha = document.getElementById('linkEsqueceuSenha');
const closeModal = document.querySelector('.close-modal');
const formRecuperar = document.getElementById('formRecuperar');
const emailRecuperar = document.getElementById('emailRecuperar');

function abrirModal() {
    modalRecuperar.style.display = 'flex';
    if (emailRecuperar) emailRecuperar.focus();
}

function fecharModal() {
    modalRecuperar.style.display = 'none';
}

if (linkEsqueceuSenha) {
    linkEsqueceuSenha.addEventListener('click', (e) => {
        e.preventDefault();
        abrirModal();
    });
}

if (closeModal) {
    closeModal.addEventListener('click', fecharModal);
    closeModal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fecharModal();
        }
    });
}

if (modalRecuperar) {
    window.addEventListener('click', (e) => {
        if (e.target === modalRecuperar) fecharModal();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalRecuperar.style.display === 'flex') fecharModal();
    });
}

if (formRecuperar) {
    formRecuperar.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = formRecuperar.querySelector('button');
        const email = emailRecuperar.value.trim();

        if (!email) {
            alert('Digite o e-mail cadastrado.');
            return;
        }

        btn.innerText = 'Enviando...';
        btn.disabled = true;

        try {
            const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/redefinir-senha.html'
            });

            if (resetError) throw resetError;

            // Mensagem propositalmente neutra: não confirma se o e-mail existe.
            alert('Se este e-mail estiver cadastrado, o link de recuperação chegará em instantes.\n\nConfira também a caixa de spam.');

            fecharModal();
            formRecuperar.reset();
        } catch (error) {
            console.error('Erro na recuperação de senha:', error);
            alert('Erro ao enviar o link: ' + traduzirErro(error));
        } finally {
            btn.innerText = 'Enviar link de recuperação';
            btn.disabled = false;
        }
    });
}
