/* ==========================================================
   S.E.R.F. — MONITOR-ERROS.JS
   Manda para o Supabase (tabela erros_navegador, migration 032)
   os erros que acontecem na tela de quem usa o sistema:
     - erro de JavaScript não tratado;
     - promessa rejeitada sem catch;
     - falha que o próprio código já registra com
       console.error("[SERF:...] ...").
   Nada sai do Supabase do projeto (sem serviço externo). Vai só o
   caminho da página, sem ?parâmetros (podem ter tokens).

   Carregar DEPOIS de supabase-client.js e auth-check.js.
   ========================================================== */

"use strict";

(function () {
    const MAXIMO_POR_PAGINA = 10;      // uma página em loop não inunda a tabela
    const enviados = new Set();
    let total = 0;

    // Ruído que não é defeito do S.E.R.F.
    const IGNORAR = [
        /^Script error\.?$/i,                       // script de outra origem, sem detalhes
        /ResizeObserver loop/i,
        /extension:\/\//i,                          // extensões do navegador
        /Failed to fetch|NetworkError|Load failed/i // queda de internet do usuário
    ];

    const cortar = (texto, limite) => String(texto ?? "").slice(0, limite);

    function textoDoErro(valor) {
        if (valor instanceof Error) return `${valor.name}: ${valor.message}`;
        if (typeof valor === "string") return valor;
        try { return JSON.stringify(valor); } catch { return String(valor); }
    }

    async function relatar({ mensagem, origem, pilha }) {
        mensagem = cortar(mensagem, 500).trim();
        if (!mensagem || IGNORAR.some(padrao => padrao.test(mensagem) || padrao.test(origem || ""))) return;

        const chave = `${mensagem}|${origem || ""}`;
        if (enviados.has(chave) || total >= MAXIMO_POR_PAGINA) return;
        enviados.add(chave);
        total += 1;

        try {
            // Só com login (a tabela não aceita visitante)
            const sessao = await window.serfSessao;
            const client = window.obterSupabase?.();
            if (!sessao || !client) return;

            const { error } = await client.from("erros_navegador").insert({
                pagina: cortar(location.pathname, 200),
                mensagem,
                origem: cortar(origem, 300) || null,
                pilha: cortar(pilha, 4000) || null,
                navegador: cortar(navigator.userAgent, 300)
            });
            // console.warn, não console.error: não pode relatar a si mesmo
            if (error) console.warn("[SERF:Monitor] Erro não registrado:", error.message || error);
        } catch { /* sem rede: paciência */ }
    }

    window.addEventListener("error", evento => {
        // Imagem/arquivo que não carregou também dispara "error", mas sem
        // ErrorEvent (e o logo, por exemplo, já trata a falha)
        if (!(evento instanceof ErrorEvent)) return;
        relatar({
            mensagem: evento.error ? textoDoErro(evento.error) : evento.message,
            origem: evento.filename ? `${evento.filename.replace(location.origin, "")}:${evento.lineno}:${evento.colno}` : "",
            pilha: evento.error?.stack
        });
    });

    window.addEventListener("unhandledrejection", evento => {
        relatar({ mensagem: `Promessa rejeitada: ${textoDoErro(evento.reason)}`, pilha: evento.reason?.stack });
    });

    // Falhas que o código já trata e registra como "[SERF:Modulo] ..."
    const consoleErrorOriginal = console.error.bind(console);
    console.error = (...argumentos) => {
        consoleErrorOriginal(...argumentos);
        if (typeof argumentos[0] !== "string" || !argumentos[0].startsWith("[SERF")) return;
        const erro = argumentos.find(valor => valor instanceof Error || (valor && typeof valor === "object" && "message" in valor));
        relatar({
            mensagem: argumentos.map(textoDoErro).join(" "),
            origem: argumentos[0].slice(0, 60),
            pilha: erro?.stack
        });
    };

    window.SERFMonitor = Object.freeze({ relatar });
})();
