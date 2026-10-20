/* ==========================================================
   S.E.R.F. — PRODUTOS-GESTAO.JS
   O fornecedor edita preço, estoque e dados do produto, e pode
   desativar/reativar (pausar vendas sem apagar o histórico).
   Usado pelos cards de "Meus produtos" (catalogo.js).

   Depende de: SweetAlert2, utils.js, ui/avisos.js,
   dados/base.js + dados/produtos.repositorio.js
   ========================================================== */

"use strict";

(function () {

    const { escaparHTML, CATEGORIAS_PRODUTO } = window.SERFUtils;

    const campo = (id, rotulo, valor, atributos = "") => `
        <label class="gestao-campo" for="${id}">
            <span>${rotulo}</span>
            <input id="${id}" class="swal2-input" value="${escaparHTML(valor ?? "")}" ${atributos}>
        </label>`;

    // Lista fechada (a mesma do cadastro e do filtro do Radar). Uma categoria
    // antiga fora da lista continua como opção, para não ser perdida.
    function campoCategoria(atual) {
        const opcoes = [...CATEGORIAS_PRODUTO];
        if (atual && !opcoes.includes(atual)) opcoes.unshift(atual);

        return `
        <label class="gestao-campo" for="gpCategoria">
            <span>Categoria</span>
            <select id="gpCategoria" class="swal2-input">
                <option value="">Sem categoria</option>
                ${opcoes.map(c => `<option value="${escaparHTML(c)}"${c === atual ? " selected" : ""}>${escaparHTML(c)}</option>`).join("")}
            </select>
        </label>`;
    }

    // Lê e valida o formulário; null = inválido (mensagem já exibida)
    function lerFormulario() {
        const valor = id => document.getElementById(id).value.trim();
        const numero = id => Number(valor(id).replace(",", "."));

        const dados = {
            nome_produto: valor("gpNome"),
            categoria: valor("gpCategoria") || null,
            marca: valor("gpMarca") || null,
            descricao: valor("gpDescricao") || null,
            // NCM só existe com a migration 027 (campo só aparece nesse caso)
            ...(document.getElementById("gpNcm") && { ncm: valor("gpNcm").replace(/\D/g, "") || null }),
            preco_atacado: numero("gpPreco"),
            quantidade_minima: numero("gpMinimo"),
            quantidade_estoque: numero("gpEstoque")
        };

        if (!dados.nome_produto) return Swal.showValidationMessage("Informe o nome do produto."), null;
        if (dados.ncm && dados.ncm.length !== 8) return Swal.showValidationMessage("O NCM tem 8 números (ex.: 7208.51.00)."), null;
        if (!(dados.preco_atacado > 0)) return Swal.showValidationMessage("O preço deve ser maior que zero."), null;
        if (!Number.isInteger(dados.quantidade_minima) || dados.quantidade_minima < 1) {
            return Swal.showValidationMessage("O pedido mínimo deve ser um número inteiro a partir de 1."), null;
        }
        if (!Number.isInteger(dados.quantidade_estoque) || dados.quantidade_estoque < 0) {
            return Swal.showValidationMessage("O estoque deve ser um número inteiro (0 ou mais)."), null;
        }

        return dados;
    }

    // Abre o formulário; aoSalvar(linha) é chamado após gravar
    async function editar(produto, aoSalvar) {
        const resultado = await Swal.fire({
            ...(window.SERFUtils.swalConfig || {}),
            title: "Editar produto",
            customClass: { popup: "gestao-produto" },
            html: `
                <div class="gestao-grade">
                    ${campo("gpNome", "Nome", produto.nome_produto, 'maxlength="150" required')}
                    ${campoCategoria(produto.categoria)}
                    ${campo("gpMarca", "Marca", produto.marca, 'maxlength="100"')}
                    ${"ncm" in produto ? campo("gpNcm", "NCM (para NF-e real)", produto.ncm, 'inputmode="numeric" maxlength="10" placeholder="8 números"') : ""}
                    ${campo("gpPreco", "Preço de atacado (R$)", produto.preco_atacado, 'inputmode="decimal"')}
                    ${campo("gpMinimo", "Pedido mínimo (un.)", produto.quantidade_minima, 'type="number" min="1" step="1"')}
                    ${campo("gpEstoque", "Estoque (un.)", produto.quantidade_estoque, 'type="number" min="0" step="1"')}
                </div>
                <label class="gestao-campo gestao-descricao" for="gpDescricao">
                    <span>Descrição</span>
                    <textarea id="gpDescricao" class="swal2-textarea" maxlength="500">${escaparHTML(produto.descricao ?? "")}</textarea>
                </label>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: "Salvar alterações",
            cancelButtonText: "Cancelar",
            showLoaderOnConfirm: true,
            didOpen: () => document.getElementById("gpEstoque")?.focus(),
            preConfirm: async () => {
                const dados = lerFormulario();
                if (!dados) return false;

                try {
                    return await window.SERFDados.produtos.atualizar(produto.id_produto, dados);
                } catch (erro) {
                    console.error("[SERF:Produtos] Falha ao salvar:", erro);
                    Swal.showValidationMessage(window.SERFUtils.mensagemDeErro(erro));
                    return false;
                }
            }
        });

        if (!resultado.isConfirmed || !resultado.value) return null;

        window.SERFAvisos.sucesso("Produto atualizado");
        await aoSalvar?.(resultado.value);
        return resultado.value;
    }

    // Desativar = some do catálogo dos compradores, sem apagar pedidos antigos
    async function alternarAtivo(produto, aoSalvar) {
        const desativar = produto.ativo !== false;

        if (desativar) {
            const ok = await window.SERFAvisos.confirmar({
                titulo: `Pausar vendas de "${produto.nome_produto}"?`,
                texto: "O produto deixa de aparecer para os compradores. Pedidos já feitos não mudam, e você pode reativar quando quiser.",
                botao: "Pausar vendas",
                perigo: true
            });
            if (!ok) return null;
        }

        try {
            const linha = await window.SERFDados.produtos.definirAtivo(produto.id_produto, !desativar);
            window.SERFAvisos.sucesso(desativar ? "Vendas pausadas" : "Produto reativado",
                desativar ? "Compradores não veem mais este produto." : "O produto voltou ao catálogo.");
            await aoSalvar?.(linha);
            return linha;
        } catch (erro) {
            await window.SERFAvisos.erro("Não foi possível alterar o produto", erro);
            return null;
        }
    }

    window.SERFGestaoProdutos = Object.freeze({ editar, alternarAtivo });
})();
