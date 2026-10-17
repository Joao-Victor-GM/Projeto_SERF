/* ==========================================================
   S.E.R.F. — AUTH-CHECK.JS
   Proteção das páginas internas (home, catálogo, perfil)
   e logout padronizado.

   Deve ser carregado no <head>, SEM defer, depois do cliente:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="../../js/supabase-client.js"></script>
     <script src="../../js/utils.js"></script>
     <script src="../../js/auth-check.js"></script>

   Logout: qualquer elemento com o atributo data-logout
     <button type="button" data-logout>Sair</button>

   A autenticação depende SOMENTE da sessão do Supabase Auth.
   Dados no localStorage servem apenas para exibição.
   ========================================================== */

"use strict";

(function () {
    const PAGINA_LOGIN = "../public/login-cadastro.html";

    // Esconde o conteúdo até a sessão ser confirmada (evita "piscar" a página).
    document.documentElement.style.visibility = "hidden";

    function limparDadosLocais() {
        localStorage.removeItem("usuario_logado");
        localStorage.removeItem("produto_selecionado");
    }

    function redirecionarParaLogin() {
        limparDadosLocais();
        // replace: a página protegida não fica no histórico do botão "voltar".
        window.location.replace(PAGINA_LOGIN);
    }

    const client = window.obterSupabase ? window.obterSupabase() : null;

    if (!client) {
        console.error("[SERF:Auth] Cliente Supabase indisponível: carregue supabase-client.js antes.");
        redirecionarParaLogin();
        return;
    }

    // Outros scripts podem aguardar: const sessao = await window.serfSessao;
    window.serfSessao = client.auth.getSession()
        .then(({ data, error }) => {
            if (error || !data?.session) {
                redirecionarParaLogin();
                return null;
            }

            document.documentElement.style.visibility = "";
            return data.session;
        })
        .catch(erro => {
            console.error("[SERF:Auth] Falha ao verificar sessão:", erro);
            redirecionarParaLogin();
            return null;
        });

    // Logout em outra aba ou sessão expirada → volta ao login.
    client.auth.onAuthStateChange(evento => {
        if (evento === "SIGNED_OUT") {
            redirecionarParaLogin();
        }
    });

    /* ------------------------------------------------------
       LOGOUT PADRONIZADO
       ------------------------------------------------------ */

    async function confirmarSaida() {
        if (typeof Swal !== "undefined") {
            const resultado = await Swal.fire({
                ...(window.SERFUtils?.swalConfig || {}),
                title: "Encerrar sessão?",
                text: "Você será desconectado da plataforma S.E.R.F.",
                icon: "question",
                showCancelButton: true,
                confirmButtonText: "Sim, sair",
                cancelButtonText: "Cancelar",
                confirmButtonColor: "#EF4444"
            });

            return resultado.isConfirmed;
        }

        return window.confirm("Deseja sair da sua conta?");
    }

    async function sair() {
        if (!(await confirmarSaida())) return;

        try {
            await client.auth.signOut();
        } catch (erro) {
            console.warn("[SERF:Auth] Falha ao encerrar sessão no servidor:", erro);
        }

        // O onAuthStateChange também redireciona; garante mesmo se falhar.
        redirecionarParaLogin();
    }

    window.serfSair = sair;

    // Delegação: funciona para botões presentes ou criados depois.
    document.addEventListener("click", evento => {
        const botao = evento.target.closest("[data-logout]");

        if (botao) {
            evento.preventDefault();
            sair();
        }
    });
})();
