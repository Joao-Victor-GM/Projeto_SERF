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
                campoRazao.placeholder = "Buscando dados na Receita Federal...";
                campoRazao.value = ""; // Limpa temporariamente o campo para dar feedback visual

                // Consulta pública, gratuita e segura para a API do Brasil
                const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);

                if (!resposta.ok) {
                    throw new Error('CNPJ inválido ou inexistente na Receita Federal.');
                }

                const dadosEmpresa = await resposta.json();

                // Insere a Razão Social retornada diretamente no campo de texto do HTML!
                campoRazao.value = dadosEmpresa.razao_social;
                console.log(`CNPJ Validado com Sucesso: ${dadosEmpresa.razao_social}`);

            } catch (error) {
                alert('Erro na validação do CNPJ: ' + error.message);
                cnpjCadastro.value = ''; // Reseta os campos para o usuário corrigir
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
            alert('Por favor, digite um CNPJ válido com 14 números.');
            return;
        }
        if (!razaoSocial) {
            alert('Por favor, preencha ou valide a Razão Social antes de continuar.');
            return;
        }
        if (senha !== confirmarSenha) {
            alert('A confirmação de senha não bate com a senha digitada!');
            return;
        }

        try {
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

            // ETAPA B: Salva imediatamente na tabela 'usuarios' como provisório para evitar erro de CNPJ inexistente
            const { error: dbError } = await supabaseClient
                .from('usuarios')
                .insert([{
                    auth_user_id: uuidUsuario,
                    nome_empresa: razaoSocial,
                    cnpj: cnpj,
                    email: email
                }]);

            if (dbError) throw dbError;

            // Guarda no cache local para a tela de triagem saber quem atualizar
            const dadosProvisorios = {
                uid: uuidUsuario,
                cnpj: cnpj,
                razaoSocial: razaoSocial,
                email: email
            };
            localStorage.setItem('cadastro_pendente', JSON.stringify(dadosProvisorios));

            alert('Cadastro efetuado com sucesso! Vamos configurar as preferências da sua empresa agora.');
            formCadastro.reset();
            
            // Redireciona na hora para a triagem
            window.location.href = 'segmentacao.html';

        } catch (error) {
            console.error("Erro no cadastro:", error);
            alert('Ocorreu um erro ao cadastrar: ' + error.message);
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
            alert('Por favor, insira o CNPJ completo com 14 dígitos.');
            return;
        }

        try {
            let emailAssociadoAoCnpj = null;

            // ETAPA A: Procuramos o e-mail correspondente na tabela de Compradores
            const { data: usuario } = await supabaseClient
                .from('usuarios')
                .select('email')
                .eq('cnpj', cnpj)
                .maybeSingle();

            if (usuario) {
                emailAssociadoAoCnpj = usuario.email;
            } else {
                // ETAPA B: Se não encontrou, procuramos na tabela de Fornecedores
                const { data: fornecedor } = await supabaseClient
                    .from('fornecedores')
                    .select('email')
                    .eq('cnpj', cnpj)
                    .maybeSingle();

                if (fornecedor) {
                    emailAssociadoAoCnpj = fornecedor.email;
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

            // 🌟 VALIDAÇÃO DA ETAPA DE SEGMENTAÇÃO
            // Lê o metadado oculto da conta do usuário
            const segmentado = user?.user_metadata?.segmentacao_concluida;

            if (segmentado === false || segmentado === undefined) {
                alert('Onboarding pendente! Vamos configurar o perfil e nicho da sua empresa antes de acessar o painel.');

                // Salva temporariamente os dados para uso na tela de segmentação
                const dadosProvisorios = {
                    uid: user.id,
                    cnpj: cnpj,
                    razaoSocial: user.user_metadata?.razao_social || 'Empresa Local',
                    email: user.email
                };
                localStorage.setItem('cadastro_pendente', JSON.stringify(dadosProvisorios));

                // Redireciona para a triagem
                window.location.href = 'segmentacao.html';
                return;
            }

            // Acesso liberado se já estiver segmentado!
            alert('Acesso autorizado! Bem-vindo de volta ao SERF.');
            window.location.href = 'home.html';

        } catch (error) {
            console.error("Erro no login:", error);
            alert('Falha ao entrar no sistema: ' + error.message);
        }
    });
}


// =========================================================================
// FUNCIONALIDADE 5: FLUXO DE RECUPERAÇÃO DE SENHA (MODAL)
// =========================================================================
const modalRecuperar = document.getElementById('modalRecuperar');
const linkEsqueceuSenha = document.getElementById('linkEsqueceuSenha');
const closeModal = document.querySelector('.close-modal');
const formRecuperar = document.getElementById('formRecuperar');
const cnpjRecuperar = document.getElementById('cnpjRecuperar');

// Aplica a máscara de CNPJ no campo do modal se a função existir no seu app-v2.js
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
            alert('Por favor, insira um CNPJ válido de 14 dígitos.');
            return;
        }

        try {
            // Feedback visual no botão
            const btn = formRecuperar.querySelector('button');
            btn.innerText = 'Buscando cadastro...';
            btn.disabled = true;

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
                throw new Error('Nenhuma empresa localizada com este CNPJ.');
            }

            btn.innerText = 'Disparando e-mail...';

            // 3. Disparar link de reset de senha para o e-mail encontrado
            const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(emailAssociado, {
                redirectTo: window.location.origin + '/redefinir-senha.html'
            });

            if (resetError) throw resetError;

            alert(`E-mail de recuperação enviado com sucesso para a caixa de: ${emailAssociado.replace(/(.{3})(.*)(@.*)/, "$1***$3")}\n\nAbra o link do e-mail para cadastrar sua nova senha.`);
            
            modalRecuperar.style.display = 'none';
            formRecuperar.reset();

        } catch (error) {
            console.error('Erro na recuperação de senha:', error);
            
            // 🌟 TRATAMENTO DE ERRO PROFISSIONAL: Traduzindo erros do Supabase
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
                title: tituloErro,
                text: mensagemAmigavel,
                icon: 'error',
                confirmButtonColor: '#d33',
                confirmButtonText: 'Entendido'
            });

        } finally {
            const btn = formRecuperar.querySelector('button');
            btn.innerText = 'Enviar Link de Recuperação';
            btn.disabled = false;
        }

    });
}
