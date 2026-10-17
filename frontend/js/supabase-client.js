/* ==========================================================
   S.E.R.F. — SUPABASE-CLIENT.JS
   Único ponto de configuração e criação do cliente Supabase.

   Ordem de carregamento em todas as páginas que usam o banco:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="../../js/supabase-client.js"></script>
     <script src="../../js/utils.js"></script>

   Os demais scripts usam a mesma instância por:
     - window.supabaseClient  (ou apenas supabaseClient)
     - obterSupabase()        (retorna null se o SDK não carregou)

   Scripts clássicos (sem import/export) para funcionar também
   ao abrir os arquivos direto do disco, sem servidor.
   ========================================================== */

"use strict";

(function () {
    const SUPABASE_URL = "https://rparlqdgcwzoanpqqeof.supabase.co";
    // Chave publicável: pode ficar no front-end; a segurança vem do RLS.
    const SUPABASE_KEY = "sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC";

    if (typeof supabase === "undefined" || !supabase.createClient) {
        console.error("[SERF] SDK do Supabase não carregado antes do supabase-client.js.");
        window.obterSupabase = () => null;
        return;
    }

    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }

    window.obterSupabase = () => window.supabaseClient;
})();
