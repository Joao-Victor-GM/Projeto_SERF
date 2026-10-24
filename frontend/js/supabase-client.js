/* ==========================================================
   S.E.R.F. — SUPABASE-CLIENT.JS
   Único ponto de configuração e criação do cliente Supabase.

   Ordem de carregamento em todas as páginas que usam o banco:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0"></script>
     <script src="../../js/supabase-client.js"></script>
     <script src="../../js/utils.js"></script>

   Versões dos CDNs ficam FIXAS (ex.: @2.118.0): uma versão nova só entra
   quando alguém atualizar e testar todas as páginas.

   Os demais scripts usam a mesma instância por:
     - window.supabaseClient  (ou apenas supabaseClient)
     - obterSupabase()        (retorna null se o SDK não carregou)

   Scripts clássicos (sem import/export) para funcionar também
   ao abrir os arquivos direto do disco, sem servidor. (Exceção: a Home
   usa módulos ES em js/home/ e precisa de servidor — ver docs/arquitetura.md.)
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

    /* ------------------------------------------------------
       ONDE A SESSÃO FICA GUARDADA ("Manter conectado")
       - Marcado no login  → localStorage: sobrevive a fechar o
         navegador/desligar o PC (até o limite de inatividade longo).
       - Desmarcado        → sessionStorage: some quando o navegador
         fecha. Abas novas pedem a sessão às abas já abertas
         (BroadcastChannel), então abrir um link em outra aba não
         obriga a entrar de novo.
       O limite de inatividade fica no auth-check.js.
       ------------------------------------------------------ */
    const CHAVE_LEMBRAR = "serf-manter-conectado";
    const CANAL_SESSAO = "serf-sessao";

    function lerArmazenamento(armazenamento, chave) {
        try { return armazenamento.getItem(chave); } catch { return null; }
    }

    function gravarArmazenamento(armazenamento, chave, valor) {
        try { armazenamento.setItem(chave, valor); } catch { /* sem armazenamento */ }
    }

    function apagarArmazenamento(armazenamento, chave) {
        try { armazenamento.removeItem(chave); } catch { /* sem armazenamento */ }
    }

    const manterConectado = () => lerArmazenamento(localStorage, CHAVE_LEMBRAR) === "1";

    // O "code verifier" do login por link (PKCE) precisa sobreviver a abrir o
    // e-mail em outra aba: fica sempre no localStorage.
    const sempreLocal = chave => chave.endsWith("-code-verifier");

    const canal = "BroadcastChannel" in window ? new BroadcastChannel(CANAL_SESSAO) : null;

    // Responde às abas novas com a sessão desta aba (só a que está no sessionStorage)
    canal?.addEventListener("message", ({ data }) => {
        if (data?.tipo !== "pedir" || !data.chave) return;
        const valor = lerArmazenamento(sessionStorage, data.chave);
        if (valor) canal.postMessage({ tipo: "resposta", chave: data.chave, id: data.id, valor });
    });

    function pedirAsOutrasAbas(chave) {
        if (!canal) return Promise.resolve(null);

        return new Promise(resolve => {
            const id = Math.random().toString(36).slice(2);
            const aoReceber = ({ data }) => {
                if (data?.tipo !== "resposta" || data.id !== id) return;
                fim(data.valor);
            };
            const fim = valor => {
                clearTimeout(espera);
                canal.removeEventListener("message", aoReceber);
                if (valor) gravarArmazenamento(sessionStorage, chave, valor);
                resolve(valor || null);
            };
            const espera = setTimeout(() => fim(null), 250);

            canal.addEventListener("message", aoReceber);
            canal.postMessage({ tipo: "pedir", chave, id });
        });
    }

    const armazenamentoDaSessao = {
        async getItem(chave) {
            const local = lerArmazenamento(sessionStorage, chave) ?? lerArmazenamento(localStorage, chave);
            if (local !== null || sempreLocal(chave) || manterConectado()) return local;
            return pedirAsOutrasAbas(chave);
        },
        setItem(chave, valor) {
            if (sempreLocal(chave) || manterConectado()) {
                gravarArmazenamento(localStorage, chave, valor);
                apagarArmazenamento(sessionStorage, chave);
            } else {
                gravarArmazenamento(sessionStorage, chave, valor);
                apagarArmazenamento(localStorage, chave);
            }
        },
        removeItem(chave) {
            apagarArmazenamento(sessionStorage, chave);
            apagarArmazenamento(localStorage, chave);
        }
    };

    /* ------------------------------------------------------
       INATIVIDADE (usada pelo auth-check.js)
       A última atividade fica no localStorage, compartilhada entre
       as abas: usar o sistema em qualquer aba conta para todas.
       ------------------------------------------------------ */
    const CHAVE_ATIVIDADE = "serf-ultima-atividade";
    const MINUTO = 60 * 1000;
    const LIMITE_INATIVIDADE = {
        normal: 30 * MINUTO,                   // sem "Manter conectado"
        manterConectado: 7 * 24 * 60 * MINUTO  // com "Manter conectado"
    };

    window.SERFSessao = Object.freeze({
        manterConectado,
        // Chamado pelo login ANTES de entrar: decide onde a nova sessão será gravada
        definirManterConectado(valor) {
            gravarArmazenamento(localStorage, CHAVE_LEMBRAR, valor ? "1" : "0");
        },
        limiteInatividade: () => (manterConectado() ? LIMITE_INATIVIDADE.manterConectado : LIMITE_INATIVIDADE.normal),
        marcarAtividade() {
            gravarArmazenamento(localStorage, CHAVE_ATIVIDADE, String(Date.now()));
        },
        // null = nada registrado ainda
        ultimaAtividade() {
            const valor = Number(lerArmazenamento(localStorage, CHAVE_ATIVIDADE));
            return Number.isFinite(valor) && valor > 0 ? valor : null;
        },
        esquecerAtividade() {
            apagarArmazenamento(localStorage, CHAVE_ATIVIDADE);
        },
        // Apaga cópias da sessão que ficaram nesta aba (logout em outra aba)
        limparSessaoDaAba() {
            try {
                Object.keys(sessionStorage).filter(chave => chave.startsWith("sb-")).forEach(chave => sessionStorage.removeItem(chave));
            } catch { /* sem armazenamento */ }
        }
    });

    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { storage: armazenamentoDaSessao, persistSession: true, autoRefreshToken: true }
        });
    }

    window.obterSupabase = () => window.supabaseClient;
})();
