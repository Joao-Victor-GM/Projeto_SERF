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
        statusDoPedido,
        escaparHTML,
        formatarMoeda,
        formatarCNPJ,
        aplicarMascaraCNPJ,
        dataLocalISO,
        formatarData,
        tempoRelativo
    });
})();
