// =========================================================================
// S.E.R.F. - SCRIPT DE INTEGRAÇÃO COMPLETO (app-v2.js)
// Login por e-mail no Supabase Auth + Cadastro com validação de CNPJ (BrasilAPI)
// =========================================================================

// 1. DEPENDÊNCIAS COMPARTILHADAS
// O cliente (supabaseClient) é criado em supabase-client.js;
// swalConfig e a máscara de CNPJ vêm de utils.js.
const { swalConfig, aplicarMascaraCNPJ, escaparHTML } = window.SERFUtils;

// 2. CAPTURA DOS ELEMENTOS DO HTML (DOM)
const formCadastro = document.getElementById('formCadastro');
const formLogin = document.getElementById('formLogin');
const cnpjCadastro = document.getElementById('cnpjCadastro');
const emailLogin = document.getElementById('emailLogin');
const campoRazao = document.getElementById('razaoSocialCadastro');
const containerTela = document.getElementById('container');

// Após o login (sessão ativa), lê apenas o cadastro da própria empresa.
// Consulta as DUAS tabelas, sem parar na primeira: a empresa pode ser
// compradora (usuarios), fornecedora (fornecedores) ou Ambos.
async function obterEmpresaDaSessao(authUserId) {
    const [comprador, fornecedor] = await Promise.all([
        supabaseClient.from('usuarios').select('nome_empresa, cnpj').eq('auth_user_id', authUserId).maybeSingle(),
        supabaseClient.from('fornecedores').select('razao_social, cnpj').eq('auth_user_id', authUserId).maybeSingle()
    ]);

    const ehComprador = Boolean(comprador.data);
    const ehFornecedor = Boolean(fornecedor.data);

    let perfil = null;
    if (ehComprador && ehFornecedor) perfil = 'Ambos';
    else if (ehFornecedor) perfil = 'Fornecedor';
    else if (ehComprador) perfil = 'Comprador';

    return {
        nome: comprador.data?.nome_empresa || fornecedor.data?.razao_social || null,
        cnpj: comprador.data?.cnpj || fornecedor.data?.cnpj || null,
        perfil
    };
}

// Traduz os erros do Supabase Auth mais comuns para o usuário.
function mensagemErroAuth(error) {
    const msg = error?.message || '';

    if (msg.includes('Invalid login credentials')) return 'E-mail ou senha inválidos.';
    if (msg.includes('Email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (msg.includes('User already registered')) return 'Já existe uma conta com este e-mail.';
    // O trigger do banco recusa CNPJ repetido; o Auth devolve um erro genérico.
    // [029] CNPJ repetido só é recusado quando já tem dono VERIFICADO
    if (msg.includes('Database error saving new user') || msg.includes('CNPJ_JA_CADASTRADO') || msg.includes('CNPJ_JA_VERIFICADO')) {
        return 'Este CNPJ já pertence a uma empresa verificada no S.E.R.F. Se ele é da sua empresa, fale com o suporte.';
    }
    if (msg.includes('rate limit')) return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';

    return msg || 'Erro de comunicação com o servidor.';
}

// Função utilitária para fazer o container do login tremer fisicamente em caso de erro
function tremerTela() {
    if (containerTela) {
        containerTela.classList.add('shake-error');
        setTimeout(() => {
            containerTela.classList.remove('shake-error');
        }, 400);
    }
}

// =========================================================================
// FUNCIONALIDADE 1: MÁSCARA DE CNPJ EM TEMPO REAL (utils.js)
// =========================================================================
aplicarMascaraCNPJ(cnpjCadastro);


// =========================================================================
// FUNCIONALIDADE 2: VALIDAÇÃO DE CNPJ E AUTO-PREENCHIMENTO (BRASILAPI)
// =========================================================================
if (cnpjCadastro) {
    cnpjCadastro.addEventListener('blur', async () => {
        const cnpjLimpo = cnpjCadastro.value.replace(/\D/g, '');

        // Só dispara a consulta se o CNPJ tiver os 14 dígitos completos
        if (cnpjLimpo.length === 14) {
            try {
                // Feedback visual de busca utilizando SweetAlert2
                Swal.fire({
                    title: 'Buscando CNPJ...',
                    text: 'Consultando dados públicos da Receita Federal.',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                campoRazao.placeholder = "Buscando dados na Receita Federal...";
                campoRazao.value = ""; 

                // Consulta pública à API do Brasil
                const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);

                if (!resposta.ok) {
                    throw new Error('CNPJ inválido ou inexistente na Receita Federal.');
                }

                const dadosEmpresa = await resposta.json();
                
                // Fecha o loading
                Swal.close();

                // Insere a Razão Social no HTML
                campoRazao.value = dadosEmpresa.razao_social;

                // Alerta elegante de sucesso na busca do CNPJ
                Swal.fire({
                    ...swalConfig,
                    title: 'Empresa Localizada!',
                    text: dadosEmpresa.razao_social,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });

            } catch (error) {
                Swal.close();
                tremerTela();
                Swal.fire({
                    ...swalConfig,
                    title: 'Erro na Validação',
                    text: window.SERFUtils.mensagemDeErro(error),
                    icon: 'error',
                    confirmButtonColor: '#d33'
                });
                cnpjCadastro.value = ''; 
                campoRazao.value = '';
                campoRazao.placeholder = 'Razão Social';
            }
        }
    });
}


// =========================================================================
// FUNCIONALIDADE 3: FLUXO DE CADASTRO COM SALVAMENTO IMEDIATO E METADADOS
// =========================================================================
if (formCadastro) {
    formCadastro.addEventListener('submit', async (e) => {
        e.preventDefault(); 

        const email = document.getElementById('emailCadastro').value.trim();
        const senha = document.getElementById('senhaCadastro').value;
        const confirmarSenha = document.getElementById('confirmarSenhaCadastro').value;
        const cnpj = cnpjCadastro.value.replace(/\D/g, '');
        const razaoSocial = campoRazao.value.trim();

        if (cnpj.length !== 14) {
            tremerTela();
            Swal.fire({
                ...swalConfig,
                title: 'Dados Incompletos',
                text: 'Por favor, digite um CNPJ válido com 14 números.',
                icon: 'warning'
            });
            return;
        }
        if (!razaoSocial) {
            tremerTela();
            Swal.fire({
                ...swalConfig,
                title: 'Atenção',
                text: 'Por favor, preencha ou valide a Razão Social antes de continuar.',
                icon: 'warning'
            });
            return;
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) {
            tremerTela();
            Swal.fire({ ...swalConfig, title: 'E-mail inválido', text: 'Confira o e-mail digitado.', icon: 'warning' });
            return;
        }
        if (senha.length < 8) {
            tremerTela();
            Swal.fire({ ...swalConfig, title: 'Senha curta', text: 'Use uma senha com 8 ou mais caracteres.', icon: 'warning' });
            return;
        }
        if (senha !== confirmarSenha) {
            tremerTela();
            Swal.fire({
                ...swalConfig,
                title: 'Atenção',
                text: 'A confirmação de senha não bate com a senha digitada!',
                icon: 'error',
                confirmButtonColor: '#d33'
            });
            return;
        }

        // CAPTCHA (captcha.js): antes do "carregando", para o desafio não ficar escondido
        let captchaToken;
        try {
            captchaToken = await window.SERFCaptcha?.token(formCadastro);
        } catch (erroCaptcha) {
            Swal.fire({ ...swalConfig, title: 'Verificação de segurança', text: erroCaptcha.message, icon: 'warning' });
            return;
        }

        try {
            Swal.fire({
                title: 'Criando Cadastro...',
                text: 'Gravando credenciais no banco de dados.',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // Conta nova: sessão só até fechar o navegador (pode marcar
            // "Manter conectado" no próximo login) e relógio de inatividade zerado
            window.SERFSessao?.definirManterConectado(false);
            window.SERFSessao?.marcarAtividade();

            // Cadastra no Supabase Auth. CNPJ e razão social vão nos metadados e
            // o registro em 'usuarios' é criado pelo trigger do banco (migration 005).
            const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                email: email,
                password: senha,
                options: {
                    captchaToken,
                    data: {
                        segmentacao_concluida: false,
                        cnpj: cnpj,
                        razao_social: razaoSocial
                    }
                }
            });
            window.SERFCaptcha?.renovar(formCadastro);

            if (authError) throw authError;

            Swal.close();
            formCadastro.reset();

            // Confirmação de e-mail LIGADA: não há sessão até o usuário clicar no link.
            // A segmentação acontece no primeiro login.
            if (!authData.session) {
                Swal.fire({
                    ...swalConfig,
                    title: 'Confirme seu E-mail',
                    html: `Enviamos um link de confirmação para <strong>${escaparHTML(email)}</strong>.<br><br>Depois de confirmar, faça login para configurar o perfil da sua empresa.`,
                    icon: 'info'
                }).then(() => {
                    window.SERFLogin?.mostrar(false);
                });
                return;
            }

            // Confirmação de e-mail DESLIGADA: segue direto para a segmentação.
            Swal.fire({
                ...swalConfig,
                title: 'Cadastro Realizado!',
                text: 'Sua conta foi criada! Vamos configurar as preferências da sua empresa agora.',
                icon: 'success'
            }).then(() => {
                window.location.href = 'segmentacao.html';
            });

        } catch (error) {
            Swal.close();
            tremerTela();
            console.error("Erro no cadastro:", error);
            Swal.fire({
                ...swalConfig,
                title: 'Erro ao Cadastrar',
                text: mensagemErroAuth(error),
                icon: 'error',
                confirmButtonColor: '#d33'
            });
        }
    });
}


// =========================================================================
// FUNCIONALIDADE 4: FLUXO DE LOGIN COM VALIDAÇÃO DE SEGMENTAÇÃO
// =========================================================================
if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailLogin.value.trim();
        const senha = document.getElementById('senhaLogin').value;

        if (!email || !senha) {
            tremerTela();
            Swal.fire({
                ...swalConfig,
                title: 'Dados Incompletos',
                text: 'Informe o e-mail e a senha da sua empresa.',
                icon: 'warning'
            });
            return;
        }

        // CAPTCHA (captcha.js): antes do "carregando", para o desafio não ficar escondido
        let captchaToken;
        try {
            captchaToken = await window.SERFCaptcha?.token(formLogin);
        } catch (erroCaptcha) {
            Swal.fire({ ...swalConfig, title: 'Verificação de segurança', text: erroCaptcha.message, icon: 'warning' });
            return;
        }

        try {
            Swal.fire({
                title: 'Autenticando...',
                text: 'Validando suas credenciais de acesso.',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // "Manter conectado": decide ONDE a sessão será guardada (ver
            // supabase-client.js) e zera o relógio de inatividade.
            window.SERFSessao?.definirManterConectado(Boolean(document.getElementById('manterConectado')?.checked));
            window.SERFSessao?.marcarAtividade();

            // ETAPA A: Autentica com E-mail + Senha no Supabase Auth.
            // Erro genérico: não revela se o e-mail existe.
            const { data: sessionData, error: loginError } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: senha,
                options: { captchaToken }
            });
            window.SERFCaptcha?.renovar(formLogin);

            if (loginError) throw loginError;

            const user = sessionData.user;

            // ETAPA B: Com a sessão ativa, lê o cadastro da própria empresa
            const empresa = await obterEmpresaDaSessao(user.id);

            // VALIDAÇÃO DA ETAPA DE SEGMENTAÇÃO
            const segmentado = user?.user_metadata?.segmentacao_concluida === true;

            Swal.close();

            if (!segmentado || !empresa.perfil) {
                Swal.fire({
                    ...swalConfig,
                    title: 'Onboarding Pendente',
                    text: 'Vamos configurar o perfil e nicho da sua empresa antes de acessar o painel.',
                    icon: 'info'
                }).then(() => {
                    window.location.href = 'segmentacao.html';
                });
                return;
            }

            // Salva os dados SOMENTE para exibição na Home (não servem para autenticar)
            const dadosUsuario = {
                cnpj: empresa.cnpj,
                razaoSocial: empresa.nome || user.user_metadata?.razao_social || 'Empresa Autenticada',
                email: user.email,
                perfil: empresa.perfil,
                nicho: user.user_metadata?.nicho || null
            };
            localStorage.setItem('usuario_logado', JSON.stringify(dadosUsuario));

            // Acesso liberado se já estiver segmentado!
            Swal.fire({
                ...swalConfig,
                title: 'Acesso Autorizado!',
                text: 'Seja bem-vindo de volta ao S.E.R.F.!',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            }).then(() => {
                window.location.href = '../app/home.html';
            });

        } catch (error) {
            Swal.close();
            tremerTela();
            console.error("Erro no login:", error);
            Swal.fire({
                ...swalConfig,
                title: 'Falha ao Acessar',
                text: mensagemErroAuth(error),
                icon: 'error',
                confirmButtonColor: '#d33'
            });
        }
    });
}


// =========================================================================
// FUNCIONALIDADE 5: FLUXO DE RECUPERAÇÃO DE SENHA (MODAL COM SWEETALERT2)
// =========================================================================
// Abrir/fechar o diálogo (foco, Esc, clique fora): login-telas.js
const formRecuperar = document.getElementById('formRecuperar');
const emailRecuperar = document.getElementById('emailRecuperar');

// Envio do formulário de recuperação
if (formRecuperar) {
    formRecuperar.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailRecuperar.value.trim();

        if (!email) {
            Swal.fire({
                ...swalConfig,
                title: 'E-mail Obrigatório',
                text: 'Informe o e-mail cadastrado da sua empresa.',
                icon: 'warning'
            });
            return;
        }

        // CAPTCHA (captcha.js): antes do "carregando", para o desafio não ficar escondido
        let captchaToken;
        try {
            captchaToken = await window.SERFCaptcha?.token(formRecuperar);
        } catch (erroCaptcha) {
            Swal.fire({ ...swalConfig, title: 'Verificação de segurança', text: erroCaptcha.message, icon: 'warning' });
            return;
        }

        try {
            Swal.fire({
                title: 'Processando pedido...',
                text: 'Solicitando o link de redefinição de senha.',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // O Supabase só envia o e-mail se a conta existir, mas responde
            // igual nos dois casos: a tela não revela quais e-mails estão cadastrados.
            const urlRedefinir = new URL('redefinir-senha.html', window.location.href).href;
            const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: urlRedefinir,
                captchaToken
            });
            window.SERFCaptcha?.renovar(formRecuperar);

            if (resetError) throw resetError;

            Swal.close();

            Swal.fire({
                ...swalConfig,
                title: 'Verifique seu E-mail',
                html: `Se <strong>${escaparHTML(email)}</strong> estiver cadastrado no S.E.R.F., você receberá o link de redefinição em instantes.<br><br>Confira também a caixa de Spam ou Lixo Eletrônico.`,
                icon: 'success'
            });

            window.SERFLogin?.fecharRecuperacao();
            formRecuperar.reset();

        } catch (error) {
            Swal.close();

            // TRATAMENTO DE ERRO PROFISSIONAL: Traduzindo erros do Supabase
            let tituloErro = 'Erro de Recuperação';
            let mensagemAmigavel = mensagemErroAuth(error);

            if (error.message.includes('rate limit')) {
                tituloErro = 'Limite Excedido';
                mensagemAmigavel = 'Você já solicitou um link de recuperação recentemente. Por favor, aguarde alguns minutos antes de tentar novamente para evitar spam!';
            }

            // Exibe o SweetAlert com a mensagem traduzida e bonita
            Swal.fire({
                ...swalConfig,
                title: tituloErro,
                text: mensagemAmigavel,
                icon: 'error',
                confirmButtonColor: '#d33',
                confirmButtonText: 'Entendido'
            });
        }
    });
}


// =========================================================================
// FUNCIONALIDADE 6: AVISO DE SESSÃO ENCERRADA POR INATIVIDADE
// O auth-check.js manda para cá com ?motivo=inatividade.
// =========================================================================
(function avisarSaidaPorInatividade() {
    const parametros = new URLSearchParams(window.location.search);
    if (parametros.get('motivo') !== 'inatividade') return;

    // Tira o motivo da URL (recarregar a página não repete o aviso)
    parametros.delete('motivo');
    const resto = parametros.toString();
    history.replaceState(null, '', window.location.pathname + (resto ? `?${resto}` : '') + window.location.hash);

    if (typeof Swal === 'undefined') return;
    Swal.fire({
        ...swalConfig,
        title: 'Sessão encerrada',
        text: 'Você ficou um tempo sem usar o S.E.R.F. e, por segurança, sua sessão foi encerrada. Entre novamente para continuar.',
        icon: 'info'
    });
})();


// =========================================================================
// FUNCIONALIDADE 7: CAPTCHA (desligado até configurar a chave em captcha.js)
// =========================================================================
[formCadastro, formLogin, formRecuperar].forEach(formulario => window.SERFCaptcha?.prepararFormulario(formulario));
