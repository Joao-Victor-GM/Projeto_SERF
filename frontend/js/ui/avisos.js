/* ==========================================================
   S.E.R.F. — UI / AVISOS.JS
   Diálogos padronizados (SweetAlert2 com a identidade do
   S.E.R.F.; sem a biblioteca, cai nos diálogos do navegador).
   Substitui os alert()/confirm() soltos pelas telas.

     await SERFAvisos.erro("Não foi possível cancelar", erro);
     SERFAvisos.sucesso("Produto atualizado");
     if (await SERFAvisos.confirmar({ titulo, texto, botao, perigo: true })) { ... }
   ========================================================== */

"use strict";

(function () {

    const temSwal = () => typeof window.Swal !== "undefined";
    const config = () => window.SERFUtils?.swalConfig || {};

    // Erro: frase para o usuário; detalhe técnico só no console
    async function erro(titulo, causa) {
        if (causa) console.error(`[SERF] ${titulo}:`, causa);
        const texto = window.SERFUtils.mensagemDeErro(causa);

        if (!temSwal()) {
            window.alert(`${titulo}\n\n${texto}`);
            return;
        }

        await Swal.fire({ ...config(), title: titulo, text: texto, icon: "error", confirmButtonText: "Entendi" });
    }

    // Aviso informativo (sem bloquear a tela por muito tempo)
    async function info(titulo, texto) {
        if (!temSwal()) {
            window.alert(texto ? `${titulo}\n\n${texto}` : titulo);
            return;
        }
        await Swal.fire({ ...config(), title: titulo, text: texto, icon: "info", confirmButtonText: "Ok" });
    }

    // Confirmação rápida no canto (não interrompe o fluxo)
    function sucesso(titulo, texto) {
        if (!temSwal()) return;
        Swal.fire({
            ...config(),
            toast: true,
            position: "top-end",
            icon: "success",
            title: titulo,
            text: texto,
            timer: 2600,
            timerProgressBar: true,
            showConfirmButton: false
        });
    }

    async function confirmar({ titulo, texto, botao = "Confirmar", cancelar = "Voltar", perigo = false }) {
        if (!temSwal()) return window.confirm(texto ? `${titulo}\n\n${texto}` : titulo);

        const resultado = await Swal.fire({
            ...config(),
            title: titulo,
            text: texto,
            icon: perigo ? "warning" : "question",
            showCancelButton: true,
            confirmButtonText: botao,
            cancelButtonText: cancelar,
            confirmButtonColor: perigo ? "#EF4444" : config().confirmButtonColor,
            focusCancel: perigo
        });

        return resultado.isConfirmed;
    }

    window.SERFAvisos = Object.freeze({ erro, info, sucesso, confirmar });
})();
