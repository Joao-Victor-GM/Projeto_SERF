const SUPABASE_URL = 'https://rparlqdgcwzoanpqqeof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let tabelaPerfil = 'usuarios'; 
let usuarioLogado = null;

async function carregarPerfil() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) { window.location.href = '../public/login-cadastro.html'; return; }
    
    usuarioLogado = authData.user;
    let { data: perfil } = await supabase.from('usuarios').select('*').eq('auth_user_id', usuarioLogado.id).maybeSingle();
    
    if (!perfil) {
        const { data: fornecedor } = await supabase.from('fornecedores').select('*').eq('auth_user_id', usuarioLogado.id).maybeSingle();
        perfil = fornecedor;
        tabelaPerfil = 'fornecedores';
    }

    if (perfil) {
        document.getElementById('perfilCnpj').value = perfil.cnpj;
        document.getElementById('perfilEmail').value = perfil.email;
        document.getElementById('perfilNome').value = perfil.nome_empresa || perfil.razao_social;
        document.getElementById('perfilTelefone').value = perfil.telefone || '';
    }
}

document.getElementById('formAtualizarPerfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('perfilNome').value;
    const telefone = document.getElementById('perfilTelefone').value;
    const campoNome = tabelaPerfil === 'usuarios' ? 'nome_empresa' : 'razao_social';

    const { error } = await supabase.from(tabelaPerfil).update({ [campoNome]: nome, telefone: telefone }).eq('auth_user_id', usuarioLogado.id);
    if (error) Swal.fire({ title: 'Erro!', text: 'Falha ao atualizar perfil.', icon: 'error', confirmButtonColor: '#d33' });
    else Swal.fire({ title: 'Sucesso!', text: 'Perfil atualizado.', icon: 'success', confirmButtonColor: '#f77f00' });
});

document.addEventListener('DOMContentLoaded', carregarPerfil);