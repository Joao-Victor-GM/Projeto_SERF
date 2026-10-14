const SUPABASE_URL = 'https://rparlqdgcwzoanpqqeof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let metodoEscolhido = 'Boleto 30/60/90';
let pedidoAtual = null;

function selecionarMetodo(elemento, metodo) {
    document.querySelectorAll('.metodo-card').forEach(c => c.classList.remove('ativo'));
    elemento.classList.add('ativo');
    metodoEscolhido = metodo;
}

document.addEventListener('DOMContentLoaded', () => {
    const dadosProduto = localStorage.getItem('produto_selecionado');
    if (dadosProduto) {
        pedidoAtual = JSON.parse(dadosProduto);
        document.getElementById('itensCheckout').innerHTML = `
            <p><strong>Produto ID:</strong> #${pedidoAtual.id}</p>
            <p><strong>Quantidade:</strong> 1 (Lote Mínimo)</p>
            <p><strong>Status:</strong> Aguardando Faturamento</p>
        `;
        document.getElementById('valorTotal').textContent = `R$ ${pedidoAtual.preco.toFixed(2).replace('.', ',')}`;
    }
});

async function processarPagamento() {
    if (!pedidoAtual) { Swal.fire({ icon: 'warning', title: 'Carrinho Vazio', text: 'Selecione um produto.' }); return; }
    Swal.fire({ title: 'Processando Faturamento...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const { data: authData } = await supabase.auth.getUser();
    const { data: comprador } = await supabase.from('usuarios').select('id_usuario').eq('auth_user_id', authData.user.id).maybeSingle();

    if (!comprador) { Swal.fire({ icon: 'error', title: 'Acesso Negado', text: 'Apenas compradores podem gerar pedidos.' }); return; }

    const { error } = await supabase.from('pedidos').insert([{ id_usuario: comprador.id_usuario, id_produto: pedidoAtual.id, quantidade: 1, valor_unitario: pedidoAtual.preco, status_pedido: 'CONFIRMADO', observacao: `Pagamento via: ${metodoEscolhido}` }]);

    if (error) Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao registrar pedido.' });
    else {
        localStorage.removeItem('produto_selecionado');
        Swal.fire({ icon: 'success', title: 'Faturamento Concluído!', text: `Pedido registrado via ${metodoEscolhido}.`, confirmButtonColor: '#f77f00' }).then(() => {
            window.location.href = 'home.html'; // CORRETO: Ambos na pasta APP
        });
    }
}