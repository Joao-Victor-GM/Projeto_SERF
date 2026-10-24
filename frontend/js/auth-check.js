/* ==========================================================
   S.E.R.F. — AUTH-CHECK.JS
   Proteção das páginas internas (home, catálogo, perfil)
   e logout padronizado.

   Deve ser carregado no <head>, SEM defer, depois do cliente:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0"></script>
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

    let motivoSaida = null; // "inatividade" → o login explica por que saiu

    function redirecionarParaLogin() {
        limparDadosLocais();
        window.SERFSessao?.limparSessaoDaAba();
        // replace: a página protegida não fica no histórico do botão "voltar".
        window.location.replace(motivoSaida ? `${PAGINA_LOGIN}?motivo=${motivoSaida}` : PAGINA_LOGIN);
    }

    const client = window.obterSupabase ? window.obterSupabase() : null;

    if (!client) {
        console.error("[SERF:Auth] Cliente Supabase indisponível: carregue supabase-client.js antes.");
        redirecionarParaLogin();
        return;
    }

    /* ------------------------------------------------------
       INATIVIDADE
       Sem uso por mais que o limite (30 min; 7 dias com "Manter
       conectado" — ver supabase-client.js), a sessão é encerrada
       NESTE navegador. 2 min antes aparece um aviso para continuar.
       Vale também para o PC que hibernou ou ficou desligado: ao
       voltar, a página confere o tempo parado antes de abrir.
       ------------------------------------------------------ */
    const sessaoLocal = window.SERFSessao;
    const AVISO_ANTES_MS = 2 * 60 * 1000;
    let avisoAberto = false;

    const tempoParado = () => Date.now() - (sessaoLocal?.ultimaAtividade() ?? Date.now());

    async function encerrarPorInatividade() {
        if (motivoSaida) return;
        motivoSaida = "inatividade";
        try {
            // "local": encerra só este navegador (outros aparelhos seguem conectados)
            await client.auth.signOut({ scope: "local" });
        } catch (erro) {
            console.warn("[SERF:Auth] Falha ao encerrar sessão inativa:", erro);
        }
        redirecionarParaLogin();
    }

    function avisarInatividade() {
        if (avisoAberto || typeof Swal === "undefined") return;
        avisoAberto = true;

        Swal.fire({
            ...(window.SERFUtils?.swalConfig || {}),
            titleText: "Você ainda está aí?",
            text: "Por segurança, sua sessão será encerrada em 2 minutos por falta de uso.",
            icon: "warning",
            confirmButtonText: "Continuar conectado",
            allowOutsideClick: false,
            timer: Math.max(1000, sessaoLocal.limiteInatividade() - tempoParado()),
            timerProgressBar: true
        }).then(resultado => {
            avisoAberto = false;
            if (resultado.isConfirmed) sessaoLocal.marcarAtividade();
        });
    }

    function conferirInatividade() {
        if (!sessaoLocal || motivoSaida) return;
        const restante = sessaoLocal.limiteInatividade() - tempoParado();

        if (restante <= 0) {
            encerrarPorInatividade();
        } else if (restante <= AVISO_ANTES_MS) {
            avisarInatividade();
        } else if (avisoAberto && typeof Swal !== "undefined") {
            // Usado em outra aba: o aviso desta aba não vale mais
            Swal.close();
        }
    }

    let ultimaGravacao = 0;
    function registrarAtividade() {
        // Grava no máximo a cada 15 s (mousemove dispara centenas de vezes)
        if (!sessaoLocal || motivoSaida || Date.now() - ultimaGravacao < 15000) return;
        ultimaGravacao = Date.now();
        sessaoLocal.marcarAtividade();
    }

    // Parado além do limite (aba esquecida, PC desligado com o navegador
    // restaurando a aba): sai antes de mostrar qualquer dado.
    const inativoAoAbrir = sessaoLocal && sessaoLocal.ultimaAtividade() !== null &&
        tempoParado() > sessaoLocal.limiteInatividade();

    if (sessaoLocal && !inativoAoAbrir) {
        sessaoLocal.marcarAtividade();
        ultimaGravacao = Date.now();

        ["pointerdown", "keydown", "scroll", "touchstart", "mousemove", "wheel"].forEach(evento =>
            window.addEventListener(evento, registrarAtividade, { passive: true, capture: true }));
        document.addEventListener("visibilitychange", () => { if (!document.hidden) conferirInatividade(); });
        setInterval(conferirInatividade, 15000);
    }

    // Outros scripts podem aguardar: const sessao = await window.serfSessao;
    window.serfSessao = inativoAoAbrir
        ? encerrarPorInatividade().then(() => null)
        : client.auth.getSession()
        .then(({ data, error }) => {
            if (error || !data?.session) {
                redirecionarParaLogin();
                return null;
            }

            // O Realtime avalia o RLS com o token do usuário: sem isso, a conexão
            // fica "anônima" e não recebe eventos das tabelas protegidas.
            client.realtime.setAuth(data.session.access_token);

            document.documentElement.style.visibility = "";
            return data.session;
        })
        .catch(erro => {
            console.error("[SERF:Auth] Falha ao verificar sessão:", erro);
            redirecionarParaLogin();
            return null;
        });

    // Logout em outra aba ou sessão expirada → volta ao login.
    client.auth.onAuthStateChange((evento, sessao) => {
        if (evento === "SIGNED_OUT") {
            redirecionarParaLogin();
            return;
        }

        // Token renovado (a cada ~1h): mantém o Realtime autenticado.
        if (sessao?.access_token) {
            client.realtime.setAuth(sessao.access_token);
        }
    });

    /* ------------------------------------------------------
       LOGO DA EMPRESA NO AVATAR DO TOPO (migration 030)
       Classe + imagem de fundo: as páginas trocam o TEXTO do avatar
       (inicial) quando carregam, e isso não apaga o logo. A imagem é
       pré-carregada: se falhar, fica a inicial.
       ------------------------------------------------------ */
    function mostrarLogoNoTopo(url) {
        const aplicar = comLogo => document.querySelectorAll(".profile-avatar").forEach(avatar => {
            avatar.classList.toggle("com-logo", comLogo);
            if (comLogo) avatar.style.setProperty("--serf-logo-empresa", `url(${JSON.stringify(url)})`);
            else avatar.style.removeProperty("--serf-logo-empresa");
        });

        if (!url) return aplicar(false);

        const imagem = new Image();
        imagem.onload = () => aplicar(true);
        imagem.onerror = () => aplicar(false);
        imagem.src = url;
    }

    // Sem a migration 030 a coluna não existe: a consulta falha e fica a inicial
    async function carregarLogoNoTopo(sessao) {
        if (!sessao) return;
        try {
            const consultas = ["usuarios", "fornecedores"].map(tabela =>
                client.from(tabela).select("logo_url").eq("auth_user_id", sessao.user.id).maybeSingle());
            const [comprador, fornecedor] = await Promise.all(consultas);
            const logo = (!comprador.error && comprador.data?.logo_url) || (!fornecedor.error && fornecedor.data?.logo_url) || null;
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => mostrarLogoNoTopo(logo), { once: true });
            } else {
                mostrarLogoNoTopo(logo);
            }
        } catch { /* sem logo: fica a inicial */ }
    }

    window.serfSessao.then(carregarLogoNoTopo);
    window.serfAtualizarLogoTopo = mostrarLogoNoTopo;

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

    // Dados de exibição da empresa (CNPJ, e-mail): não ficam no navegador
    // depois de sair — computador compartilhado é comum em empresa.
    function limparDadosLocais() {
        try { localStorage.removeItem("usuario_logado"); } catch { /* sem armazenamento */ }
    }

    async function sair() {
        if (!(await confirmarSaida())) return;
        limparDadosLocais();

        try {
            await client.auth.signOut();
        } catch (erro) {
            console.warn("[SERF:Auth] Falha ao encerrar sessão no servidor:", erro);
        }

        // O onAuthStateChange também redireciona; garante mesmo se falhar.
        redirecionarParaLogin();
    }

    window.serfSair = sair;
    window.serfLimparDadosLocais = limparDadosLocais;

    // Delegação: funciona para botões presentes ou criados depois.
    document.addEventListener("click", evento => {
        const botao = evento.target.closest("[data-logout]");

        if (botao) {
            evento.preventDefault();
            sair();
        }
    });
})();
