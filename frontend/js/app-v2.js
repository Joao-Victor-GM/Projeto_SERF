// =========================================================================
// S.E.R.F. - SCRIPT DE INTEGRAÇÃO COMPLETO (app-v2.js)
// Conecta a Tela de Login/Cadastro ao Supabase + Validação de CNPJ (BrasilAPI)
// =========================================================================

// 1. CONFIGURAÇÕES DE ACESSO AO BANCO DE DADOS (SUPABASE)
const SUPABASE_URL = 'https://rparlqdgcwzoanpqqeof.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC'; 

// Inicializa o cliente do Supabase
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("🚀 Ponte com o Supabase configurada com sucesso!");

// 2. CAPTURA DOS ELEMENTOS DO HTML (DOM)
const formCadastro = document.getElementById('formCadastro');
const formLogin = document.getElementById('formLogin');
const cnpjCadastro = document.getElementById('cnpjCadastro');
const cnpjLogin = document.getElementById('cnpjLogin');
const campoRazao = document.getElementById('razaoSocialCadastro');
const containerTela = document.getElementById('container');

// Configurações Globais de Cores do SweetAlert2 (Identidade do S.E.R.F.)
const swalConfig = {
    background: '#ffffff',
    color: '#1d2d5c',
    confirmButtonColor: '#f77f00' // Laranja do SERF
};

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
// FUNCIONALIDADE 1: MÁSCARA DE CNPJ EM TEMPO REAL
// =========================================================================
function aplicarMascaraCNPJ(inputElement) {
    if (!inputElement) return;
    
    inputElement.addEventListener('input', (e) => {
        let value = e.target.value;
        value = value.replace(/\D/g, ''); // Remove tudo que não é número
        
        if (value.length > 14) {
            value = value.slice(0, 14); // Limita a 14 dígitos no máximo
        }
        
        // Aplica os pontos, barra e traço dinamicamente conforme digita
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
                console.log(`CNPJ Validado com Sucesso: ${dadosEmpresa.razao_social}`);

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
                    text: error.message,
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

        try {
            Swal.fire({
                title: 'Criando Cadastro...',
                text: 'Gravando credenciais no banco de dados.',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // ETAPA A: Cadastra no Auth do Supabase inserindo a etiqueta 'segmentacao_concluida: false' nos metadados
            const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                email: email,
                password: senha,
                options: {
                    data: {
                        segmentacao_concluida: false,
                        cnpj: cnpj,
                        razao_social: razaoSocial
                    }
                }
            });

            if (authError) throw authError;

            const uuidUsuario = authData.user?.id;
            if (!uuidUsuario) throw new Error('Erro ao gerar ID de segurança no banco.');

            // ETAPA B: Salva na tabela 'usuarios'
            const { error: dbError } = await supabaseClient
                .from('usuarios')
                .insert([{
                    auth_user_id: uuidUsuario,
                    nome_empresa: razaoSocial,
                    cnpj: cnpj,
                    email: email
                }]);

            if (dbError) throw dbError;

            // Guarda no cache local para a triagem de segmentação
            const dadosProvisorios = {
                uid: uuidUsuario,
                cnpj: cnpj,
                razaoSocial: razaoSocial,
                email: email
            };
            localStorage.setItem('cadastro_pendente', JSON.stringify(dadosProvisorios));

            Swal.close();

            // Mensagem de sucesso bonita com direcionamento para segmentação
            Swal.fire({
                ...swalConfig,
                title: 'Cadastro Realizado!',
                text: 'Sua conta foi criada! Vamos configurar as preferências da sua empresa agora.',
                icon: 'success'
            }).then(() => {
                formCadastro.reset();
                window.location.href = 'segmentacao.html';
            });

        } catch (error) {
            Swal.close();
            tremerTela();
            console.error("Erro no cadastro:", error);
            Swal.fire({
                ...swalConfig,
                title: 'Erro ao Cadastrar',
                text: error.message,
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

        const cnpj = cnpjLogin.value.replace(/\D/g, '');
        const senha = document.getElementById('senhaLogin').value;

        if (cnpj.length !== 14) {
            tremerTela();
            Swal.fire({
                ...swalConfig,
                title: 'CNPJ Incompleto',
                text: 'Por favor, insira o CNPJ completo com 14 dígitos.',
                icon: 'warning'
            });
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

            let emailAssociadoAoCnpj = null;
            let nomeEmpresaEncontrada = null;
            let perfilEncontrado = 'Comprador';

            // ETAPA A: Procuramos o e-mail correspondente na tabela de Compradores
            const { data: usuario } = await supabaseClient
                .from('usuarios')
                .select('email, nome_empresa')
                .eq('cnpj', cnpj)
                .maybeSingle();

            if (usuario) {
                emailAssociadoAoCnpj = usuario.email;
                nomeEmpresaEncontrada = usuario.nome_empresa;
                perfilEncontrado = 'Comprador';
            } else {
                // ETAPA B: Se não encontrou, procuramos na tabela de Fornecedores
                const { data: fornecedor } = await supabaseClient
                    .from('fornecedores')
                    .select('email, razao_social')
                    .eq('cnpj', cnpj)
                    .maybeSingle();

                if (fornecedor) {
                    emailAssociadoAoCnpj = fornecedor.email;
                    nomeEmpresaEncontrada = fornecedor.razao_social;
                    perfilEncontrado = 'Fornecedor';
                }
            }

            if (!emailAssociadoAoCnpj) {
                throw new Error('Nenhuma empresa cadastrada com este CNPJ.');
            }

            // ETAPA C: Autentica com E-mail + Senha no Supabase Auth
            const { data: sessionData, error: loginError } = await supabaseClient.auth.signInWithPassword({
                email: emailAssociadoAoCnpj,
                password: senha
            });

            if (loginError) throw loginError;

            const user = sessionData.user;

            // VALIDAÇÃO DA ETAPA DE SEGMENTAÇÃO
            const segmentado = user?.user_metadata?.segmentacao_concluida;

            Swal.close();

            if (segmentado === false || segmentado === undefined) {
                Swal.fire({
                    ...swalConfig,
                    title: 'Onboarding Pendente',
                    text: 'Vamos configurar o perfil e nicho da sua empresa antes de acessar o painel.',
                    icon: 'info'
                }).then(() => {
                    const dadosProvisorios = {
                        uid: user.id,
                        cnpj: cnpj,
                        razaoSocial: nomeEmpresaEncontrada || user.user_metadata?.razao_social || 'Empresa Local',
                        email: user.email
                    };
                    localStorage.setItem('cadastro_pendente', JSON.stringify(dadosProvisorios));
                    window.location.href = 'segmentacao.html';
                });
                return;
            }

            // Salva os dados para exibição contextual na Home
            const dadosUsuario = {
                uid: user.id,
                cnpj: cnpj,
                razaoSocial: nomeEmpresaEncontrada || user.user_metadata?.razao_social || 'Empresa Autenticada',
                email: user.email,
                perfil: perfilEncontrado
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
                text: error.message,
                icon: 'error',
                confirmButtonColor: '#d33'
            });
        }
    });
}


// =========================================================================
// FUNCIONALIDADE 5: FLUXO DE RECUPERAÇÃO DE SENHA (MODAL COM SWEETALERT2)
// =========================================================================
const modalRecuperar = document.getElementById('modalRecuperar');
const linkEsqueceuSenha = document.getElementById('linkEsqueceuSenha');
const closeModal = document.querySelector('.close-modal');
const formRecuperar = document.getElementById('formRecuperar');
const cnpjRecuperar = document.getElementById('cnpjRecuperar');

// Aplica a máscara de CNPJ no campo do modal se a função existir
if (typeof aplicarMascaraCNPJ === 'function') {
    aplicarMascaraCNPJ(cnpjRecuperar);
}

// Abre o Modal ao clicar no link de esqueceu senha
if (linkEsqueceuSenha) {
    linkEsqueceuSenha.addEventListener('click', (e) => {
        e.preventDefault();
        modalRecuperar.style.display = 'flex';
    });
}

// Fecha o Modal ao clicar no "X"
if (closeModal) {
    closeModal.addEventListener('click', () => {
        modalRecuperar.style.display = 'none';
    });
}

// Fecha o Modal ao clicar fora do conteúdo
window.addEventListener('click', (e) => {
    if (e.target === modalRecuperar) {
        modalRecuperar.style.display = 'none';
    }
});

// Envio do formulário de recuperação
if (formRecuperar) {
    formRecuperar.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cnpj = cnpjRecuperar.value.replace(/\D/g, '');
        
        if (cnpj.length !== 14) {
            Swal.fire({
                ...swalConfig,
                title: 'CNPJ Inválido',
                text: 'Por favor, insira um CNPJ válido de 14 dígitos.',
                icon: 'warning'
            });
            return;
        }

        try {
            // Feedback visual no botão com SweetAlert2
            Swal.fire({
                title: 'Processando pedido...',
                text: 'Buscando o e-mail cadastrado associado a esse CNPJ.',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            let emailAssociado = null;

            // 1. Procurar e-mail na tabela de Compradores (usuarios)
            const { data: comprador } = await supabaseClient
                .from('usuarios')
                .select('email')
                .eq('cnpj', cnpj)
                .maybeSingle();

            if (comprador) {
                emailAssociado = comprador.email;
            } else {
                // 2. Se não achou, procurar na tabela de Fornecedores
                const { data: fornecedor } = await supabaseClient
                    .from('fornecedores')
                    .select('email')
                    .eq('cnpj', cnpj)
                    .maybeSingle();

                if (fornecedor) {
                    emailAssociado = fornecedor.email;
                }
            }

            if (!emailAssociado) {
                throw new Error('Nenhuma empresa localizada com este CNPJ no banco de dados do S.E.R.F.');
            }

            // 3. Disparar link de reset de senha para o e-mail encontrado
            const urlRedefinir = new URL('redefinir-senha.html', window.location.href).href;
            const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(emailAssociado, {
                redirectTo: urlRedefinir
            });

            if (resetError) throw resetError;

            Swal.close();

            // Mensagem elegante com e-mail parcialmente mascarado (ex: t***@gmail.com)
            const emailMascarado = emailAssociado.replace(/(.{3})(.*)(@.*)/, "$1***$3");
            
            // 🌟 SUCESSO DE VERDADE COM SWEETALERT2
            Swal.fire({
                ...swalConfig,
                title: 'E-mail Enviado!',
                html: `Enviamos o link de redefinição para a caixa de: <strong>${emailMascarado}</strong>.<br><br>Verifique também a caixa de Spam ou Lixo Eletrônico!`,
                icon: 'success'
            });
            
            modalRecuperar.style.display = 'none';
            formRecuperar.reset();

        } catch (error) {
            Swal.close();
            
            // TRATAMENTO DE ERRO PROFISSIONAL: Traduzindo erros do Supabase
            let tituloErro = 'Erro de Recuperação';
            let mensagemAmigavel = error.message;

            if (error.message.includes('rate limit exceeded')) {
                tituloErro = 'Limite Excedido';
                mensagemAmigavel = 'Você já solicitou um link de recuperação recentemente. Por favor, aguarde alguns minutos antes de tentar novamente para evitar spam!';
            } else if (error.message.includes('Nenhuma empresa localizada')) {
                tituloErro = 'CNPJ não encontrado';
                mensagemAmigavel = 'Não encontramos nenhuma empresa cadastrada com este CNPJ no S.E.R.F. Verifique o número!';
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
