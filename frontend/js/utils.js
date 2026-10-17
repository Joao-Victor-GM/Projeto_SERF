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

    window.SERFUtils = Object.freeze({
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
