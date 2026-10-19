/* ==========================================================
   S.E.R.F. — UTILS.JS
   Funções e constantes compartilhadas por todas as páginas.

   Uso em qualquer script:
     const { escaparHTML, formatarMoeda, swalConfig } = window.SERFUtils;
   ========================================================== */

"use strict";

(function () {

    // Identidade visual do SweetAlert2 no S.E.R.F.
    const swalConfig = Object.freeze({
        background: "#ffffff",
        color: "#1d2d5c",
        confirmButtonColor: "#f77f00"
    });

    // Status de pedido do banco → categoria usada em filtros/KPIs + rótulo
    const STATUS_PEDIDO = Object.freeze({
        PENDENTE: { categoria: "aberto", rotulo: "Pendente" },
        CONFIRMADO: { categoria: "negociacao", rotulo: "Confirmado" },
        EM_SEPARACAO: { categoria: "negociacao", rotulo: "Em separação" },
        ENVIADO: { categoria: "negociacao", rotulo: "Enviado" },
        ENTREGUE: { categoria: "concluido", rotulo: "Entregue" },
        CANCELADO: { categoria: "cancelado", rotulo: "Cancelado" }
    });

    function statusDoPedido(codigo) {
        return STATUS_PEDIDO[codigo] || { categoria: "aberto", rotulo: codigo || "—" };
    }

    // Próximos status que o fornecedor pode aplicar a partir do atual.
    // Espelho da regra validada no banco (trigger pedidos_validar, migration 005):
    // ao mudar uma, mude a outra.
    const TRANSICOES_STATUS = Object.freeze({
        PENDENTE: ["CONFIRMADO", "CANCELADO"],
        CONFIRMADO: ["EM_SEPARACAO", "ENVIADO", "CANCELADO"],
        EM_SEPARACAO: ["ENVIADO", "CANCELADO"],
        ENVIADO: ["ENTREGUE"],
        ENTREGUE: [],
        CANCELADO: []
    });

    /* ------------------------------------------------------
       EMPRESA LOGADA
       Cadastros da sessão em "usuarios" (comprador) e
       "fornecedores". Uma única consulta por página, mesmo
       que vários scripts perguntem (Home + catalogo.js).
       ------------------------------------------------------ */

    let empresaEmCache = null; // { authUserId, promessa }

    async function carregarEmpresa(client, authUserId) {
        const [comprador, fornecedor] = await Promise.all([
            client
                .from("usuarios")
                .select("id_usuario, nome_empresa")
                .eq("auth_user_id", authUserId)
                .maybeSingle(),
            client
                .from("fornecedores")
                .select("id_fornecedor, auth_user_id, razao_social, nome_fantasia, cnpj, email, status_cadastro")
                .eq("auth_user_id", authUserId)
                .maybeSingle()
        ]);

        if (comprador.error) throw comprador.error;
        if (fornecedor.error) throw fornecedor.error;

        const dadosComprador = comprador.data || null;
        const dadosFornecedor = fornecedor.data || null;

        let perfil = null;
        if (dadosComprador && dadosFornecedor) perfil = "Ambos";
        else if (dadosFornecedor) perfil = "Fornecedor";
        else if (dadosComprador) perfil = "Comprador";

        return {
            authUserId,
            idUsuario: dadosComprador?.id_usuario ?? null,
            idFornecedor: dadosFornecedor?.id_fornecedor ?? null,
            nome: dadosComprador?.nome_empresa || dadosFornecedor?.razao_social || null,
            perfil,
            comprador: dadosComprador,
            fornecedor: dadosFornecedor
        };
    }

    // Retorna a empresa da sessão ou null (sem sessão / sem cliente).
    // Erros de consulta são propagados e não ficam em cache.
    async function obterEmpresaLogada({ recarregar = false } = {}) {
        const client = window.obterSupabase ? window.obterSupabase() : null;
        if (!client) return null;

        const { data: { session } } = await client.auth.getSession();
        const authUserId = session?.user?.id || null;

        if (!authUserId) return null;

        if (recarregar || empresaEmCache?.authUserId !== authUserId) {
            const promessa = carregarEmpresa(client, authUserId);
            empresaEmCache = { authUserId, promessa };

            promessa.catch(() => {
                if (empresaEmCache?.promessa === promessa) empresaEmCache = null;
            });
        }

        return empresaEmCache.promessa;
    }

    // Impede a inserção de HTML não confiável (dados do banco ou do usuário).
    function escaparHTML(valor) {
        if (valor === null || valor === undefined) return "";

        return String(valor).replace(/[&<>"']/g, caractere => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[caractere]);
    }

    function formatarMoeda(valor) {
        return new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL"
        }).format(Number(valor) || 0);
    }

    // "12345678000190" → "12.345.678/0001-90"
    function formatarCNPJ(cnpj) {
        if (!cnpj) return "Não informado";

        const limpo = String(cnpj).replace(/\D/g, "");

        return limpo.length === 14
            ? limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
            : String(cnpj);
    }

    // Máscara de CNPJ enquanto o usuário digita.
    function aplicarMascaraCNPJ(input) {
        if (!input) return;

        input.addEventListener("input", evento => {
            let valor = evento.target.value.replace(/\D/g, "").slice(0, 14);

            if (valor.length > 12) {
                valor = valor.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})$/, "$1.$2.$3/$4-$5");
            } else if (valor.length > 8) {
                valor = valor.replace(/^(\d{2})(\d{3})(\d{3})(\d{1,4})$/, "$1.$2.$3/$4");
            } else if (valor.length > 5) {
                valor = valor.replace(/^(\d{2})(\d{3})(\d{1,3})$/, "$1.$2.$3");
            } else if (valor.length > 2) {
                valor = valor.replace(/^(\d{2})(\d{1,3})$/, "$1.$2");
            }

            evento.target.value = valor;
        });
    }

    // TIMESTAMPTZ do banco → "AAAA-MM-DD" no fuso local.
    function dataLocalISO(timestamp) {
        const data = new Date(timestamp);

        if (Number.isNaN(data.getTime())) return null;

        const ano = data.getFullYear();
        const mes = String(data.getMonth() + 1).padStart(2, "0");
        const dia = String(data.getDate()).padStart(2, "0");

        return `${ano}-${mes}-${dia}`;
    }

    // "AAAA-MM-DD" → "DD/MM/AAAA"
    function formatarData(dataISO) {
        if (!dataISO) return "—";

        const [ano, mes, dia] = dataISO.split("-");

        return `${dia}/${mes}/${ano}`;
    }

    // Texto curto relativo: "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias".
    function tempoRelativo(timestamp) {
        const data = new Date(timestamp);

        if (Number.isNaN(data.getTime())) return "";

        const minutos = Math.floor((Date.now() - data.getTime()) / 60000);

        if (minutos < 1) return "agora";
        if (minutos < 60) return `há ${minutos} min`;

        const horas = Math.floor(minutos / 60);
        if (horas < 24) return `há ${horas} h`;

        const dias = Math.floor(horas / 24);
        if (dias === 1) return "ontem";

        return `há ${dias} dias`;
    }

    /* ------------------------------------------------------
       MENSAGENS DE ERRO PARA O USUÁRIO
       Erros técnicos do Supabase/Postgres viram frases que dizem
       o que aconteceu e o que fazer. As regras de negócio do
       banco (RAISE EXCEPTION, código P0001) já são escritas para
       o usuário e passam direto. O detalhe técnico fica no console.
       ------------------------------------------------------ */

    const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente em instantes.";

    function mensagemDeErro(erro) {
        if (!erro) return ERRO_GENERICO;
        if (typeof erro === "string") return erro;

        const codigo = String(erro.code || "");
        const texto = String(erro.message || erro.error_description || "");
        const contem = trecho => texto.toLowerCase().includes(trecho);

        if (codigo === "P0001" && texto) return texto;

        if (contem("failed to fetch") || contem("networkerror") || contem("load failed") || contem("network request failed")) {
            return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
        }
        if (contem("jwt expired") || codigo === "PGRST301" || codigo === "PGRST303") {
            return "Sua sessão expirou. Entre novamente para continuar.";
        }
        if (codigo === "42501" || contem("row-level security") || contem("permission denied")) {
            return "Sua empresa não tem permissão para esta ação. Se acabou de mudar de perfil, saia e entre de novo.";
        }
        if (codigo === "23505") return "Esse registro já existe.";
        if (codigo === "23514") return "Algum valor está fora do permitido (por exemplo, preço ou quantidade). Revise os campos.";
        if (codigo === "23502") return "Preencha todos os campos obrigatórios.";
        if (codigo === "22P02" || codigo === "22003") return "Algum campo tem um valor inválido. Revise e tente de novo.";
        if (codigo === "PGRST116") return "Registro não encontrado. Ele pode ter sido removido.";
        if (codigo === "42P01" || codigo === "PGRST205") {
            return "Este recurso ainda não está disponível no servidor. Avise o suporte.";
        }

        // Mensagens das nossas próprias validações no front-end (new Error("...")).
        // Pelo nome, não por instanceof: TypeError/ReferenceError internos
        // (bugs) não podem aparecer para o usuário.
        if (erro.name === "Error" && !codigo && texto) {
            return texto;
        }

        return ERRO_GENERICO;
    }

    window.SERFUtils = Object.freeze({
        mensagemDeErro,
        swalConfig,
        STATUS_PEDIDO,
        TRANSICOES_STATUS,
        statusDoPedido,
        obterEmpresaLogada,
        escaparHTML,
        formatarMoeda,
        formatarCNPJ,
        aplicarMascaraCNPJ,
        dataLocalISO,
        formatarData,
        tempoRelativo
    });
})();
