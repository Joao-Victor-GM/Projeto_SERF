/* ==========================================================
   S.E.R.F. — AUTH-CHECK.JS
   Proteção das páginas internas (home, catálogo, perfil).

   Deve ser carregado no <head>, logo após o SDK do Supabase
   e SEM defer, para bloquear a página antes de ela aparecer:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="../../js/auth-check.js"></script>

   A autenticação depende SOMENTE da sessão do Supabase Auth.
   Dados no localStorage servem apenas para exibição.
   ========================================================== */

"use strict";

(function () {
    const SUPABASE_URL = "https://rparlqdgcwzoanpqqeof.supabase.co";
    const SUPABASE_KEY = "sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC";
    const PAGINA_LOGIN = "../public/login-cadastro.html";

    // Esconde o conteúdo até a sessão ser confirmada (evita "piscar" a página).
    document.documentElement.style.visibility = "hidden";

    function redirecionarParaLogin() {
        localStorage.removeItem("usuario_logado");
        // replace: a página protegida não fica no histórico do botão "voltar".
        window.location.replace(PAGINA_LOGIN);
    }

    if (typeof supabase === "undefined" || !supabase.createClient) {
        console.error("[SERF:Auth] SDK do Supabase não carregado antes do auth-check.js.");
        redirecionarParaLogin();
        return;
    }

    // Cliente único, reaproveitado por home.js, catalogo.js e perfil.js.
    window.supabaseClient =
        window.supabaseClient || supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Outros scripts podem aguardar: const sessao = await window.serfSessao;
    window.serfSessao = window.supabaseClient.auth.getSession()
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
    window.supabaseClient.auth.onAuthStateChange(evento => {
        if (evento === "SIGNED_OUT") {
            redirecionarParaLogin();
        }
    });
})();
