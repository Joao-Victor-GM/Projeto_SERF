const SUPABASE_URL = 'https://rparlqdgcwzoanpqqeof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function carregarCatalogo() {
    const lista = document.getElementById('listaProdutos');
    const { data: produtos, error } = await supabase.from('produtos').select('*').eq('ativo', true);

    if (error) { lista.innerHTML = '<p class="empty-state">Erro ao carregar produtos.</p>'; return; }
    if (produtos.length === 0) { lista.innerHTML = '<p class="empty-state">Nenhum produto cadastrado.</p>'; return; }

    lista.innerHTML = produtos.map(p => `
        <div class="produto-card">
            <span class="produto-marca">${p.marca || 'Sem Marca'} - ${p.categoria || 'Geral'}</span>
            <h3 style="color: var(--serf-azul-principal); margin: 5px 0;">${p.nome_produto}</h3>
            <p style="font-size: 11px; color: var(--serf-texto-secundario);">${p.descricao || 'Sem descrição'}</p>
            <div class="produto-preco">R$ ${p.preco_atacado.toFixed(2).replace('.', ',')}</div>
            <p style="font-size: 10px; color: #91A0AF;">Min: ${p.quantidade_minima} un | Estoque: ${p.quantidade_estoque}</p>
            <button class="btn-primary btn-comprar" onclick="iniciarCompra(${p.id_produto}, ${p.preco_atacado})">Iniciar Negociação</button>
        </div>
    `).join('');
}

function iniciarCompra(idProduto, preco) {
    localStorage.setItem('produto_selecionado', JSON.stringify({ id: idProduto, preco: preco }));
    window.location.href = 'pagamento.html'; // CORRETO: Ambos na pasta APP
}

document.addEventListener('DOMContentLoaded', async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
        const { data: fornecedor } = await supabase.from('fornecedores').select('id_fornecedor').eq('auth_user_id', authData.user.id).maybeSingle();
        if (fornecedor) document.getElementById('btnNovoProduto').style.display = 'inline-flex';
    }
    carregarCatalogo();
});