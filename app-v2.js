// =========================================================================
// S.E.R.F. - SCRIPT DE INTEGRAÇÃO COMPLETO (app-v2.js)
// Conecta a Tela de Login/Cadastro ao Supabase + Validação de CNPJ (BrasilAPI)
// =========================================================================

// 1. CONFIGURAÇÕES DE ACESSO AO BANCO DE DADOS (SUPABASE)
// CORREÇÃO: Removido o '/rest/v1/' do final da URL
const SUPABASE_URL = 'https://rparlqdgcwzoanpqqeof.supabase.co'; 

// Sua chave pública padrão (mantenha como está)
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
// FUNCIONALIDADE 3: FLUXO DE CADASTRO (CRIAR CONTA)
// =========================================================================
if (formCadastro) {
    formCadastro.addEventListener('submit', async (e) => {
        e.preventDefault(); // Impede o navegador de recarregar a página e perder os dados

        // Captura os dados atuais das caixinhas de texto
        const email = document.getElementById('emailCadastro').value.trim();
        const senha = document.getElementById('senhaCadastro').value;
        const cnpj = cnpjCadastro.value.replace(/\D/g, '');
        const razaoSocial = campoRazao.value.trim();
        const perfilSelecionado = document.querySelector('input[name="perfil"]:checked').value;

        // Validações de segurança antes de chamar a internet
        if (cnpj.length !== 14) {
            alert('Por favor, digite um CNPJ válido com 14 números.');
            return;
        }
        if (!razaoSocial) {
            alert('Por favor, preencha ou valide a Razão Social antes de continuar.');
            return;
        }

        try {
            // ETAPA A: Cadastra as credenciais de login no Supabase Auth (E-mail e Senha)
            const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                email: email,
                password: senha
            });

            if (authError) throw authError;

            // Pega o UUID exclusivo criado para essa nova conta
            const uuidUsuario = authData.user?.id;

            if (!uuidUsuario) {
                throw new Error('Erro ao gerar ID de segurança no banco.');
            }

            // ETAPA B: Salva as informações da empresa na tabela correspondente ao perfil B2B
            if (perfilSelecionado === 'Comprador') {
                const { error: dbError } = await supabaseClient
                    .from('usuarios') // Sua tabela de microempresas
                    .insert([{
                        auth_user_id: uuidUsuario,
                        nome_empresa: razaoSocial,
                        cnpj: cnpj,
                        email: email
                    }]);

                if (dbError) throw dbError;

            } else if (perfilSelecionado === 'Fornecedor') {
                const { error: dbError } = await supabaseClient
                    .from('fornecedores') // Sua tabela de fornecedores locais
                    .insert([{
                        auth_user_id: uuidUsuario,
                        razao_social: razaoSocial,
                        cnpj: cnpj,
                        email: email
                    }]);

                if (dbError) throw dbError;
            }

            // Se tudo correu perfeitamente:
            alert('Parabéns! Sua conta B2B do SERF foi criada. Faça o seu login!');
            formCadastro.reset();
            
            // Remove a classe de animação para a interface deslizar de volta à tela de login
            document.getElementById('container').classList.remove("right-panel-active");

        } catch (error) {
            console.error("Erro completo capturado no cadastro:", error);
            alert('Ocorreu um erro ao cadastrar: ' + error.message);
        }
    });
}


// =========================================================================
// FUNCIONALIDADE 4: FLUXO DE LOGIN (ENTRAR COM CNPJ + SENHA)
// =========================================================================
if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Limpa o CNPJ digitado deixando apenas números
        const cnpj = cnpjLogin.value.replace(/\D/g, '');
        const senha = document.getElementById('senhaLogin').value;

        if (cnpj.length !== 14) {
            alert('Por favor, insira o CNPJ completo com 14 dígitos.');
            return;
        }

        try {
            let emailAssociadoAoCnpj = null;

            // ETAPA A: Procuramos o e-mail correspondente na tabela de Compradores
            const { data: usuario, error: errUser } = await supabaseClient
                .from('usuarios')
                .select('email')
                .eq('cnpj', cnpj)
                .maybeSingle(); // Retorna o registro ou vazio sem dar erro crítico

            if (usuario) {
                emailAssociadoAoCnpj = usuario.email;
            } else {
                // ETAPA B: Se não encontrou, procuramos na tabela de Fornecedores
                const { data: fornecedor, error: errForn } = await supabaseClient
                    .from('fornecedores')
                    .select('email')
                    .eq('cnpj', cnpj)
                    .maybeSingle();

                if (fornecedor) {
                    emailAssociadoAoCnpj = fornecedor.email;
                }
            }

            // Se varremos as duas tabelas e o CNPJ não apareceu em nenhuma delas:
            if (!emailAssociadoAoCnpj) {
                throw new Error('Nenhuma empresa cadastrada com este CNPJ.');
            }

            // ETAPA C: Autentica de verdade usando o e-mail descoberto e a senha fornecida
            const { data: sessionData, error: loginError } = await supabaseClient.auth.signInWithPassword({
                email: emailAssociadoAoCnpj,
                password: senha
            });

            if (loginError) throw loginError;

            // SUCESSO ABSOLUTO!
            alert('Acesso autorizado! Bem-vindo de volta ao SERF.');
            
            // Redireciona para a página principal protegida do seu painel
            window.location.href = 'home.html';

        } catch (error) {
            console.error("Erro completo capturado no login:", error);
            alert('Falha ao entrar no sistema: ' + error.message);
        }
    });
}
