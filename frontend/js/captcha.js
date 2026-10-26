/* ==========================================================
   S.E.R.F. — CAPTCHA.JS (Cloudflare Turnstile, gratuito)
   Barra robôs no cadastro, no login e na recuperação de senha.
   O Supabase confere o token (Authentication → Attack Protection).

   DESLIGADO enquanto CHAVE_SITE estiver vazia: o site funciona
   normalmente sem CAPTCHA. Para ligar (ordem importa):
     1. Cloudflare → Turnstile → Add site (domínio do site) →
        modo "Managed". Copie a Site Key e a Secret Key.
     2. Cole a Site Key em CHAVE_SITE abaixo e publique o site.
     3. Supabase → Authentication → Attack Protection → CAPTCHA:
        ligue, escolha Turnstile e cole a Secret Key.
   Se fizer o 3 antes do 2, ninguém consegue entrar.

   O script do Turnstile não aceita SRI (a Cloudflare muda o
   arquivo sem aviso); por isso ele só é carregado nas páginas de
   login e só quando o CAPTCHA está ligado.
   ========================================================== */

"use strict";

(function () {
    // Chave PÚBLICA do site no Turnstile (não é segredo)
    const CHAVE_SITE = "";

    const chave = window.SERFConfig?.turnstileChaveSite ?? CHAVE_SITE;
    const ESPERA_MAXIMA_MS = 20000;

    let carregamento = null;
    const widgets = new Map();   // formulário → { id, token, esperando[] }

    function carregarTurnstile() {
        carregamento ??= new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.async = true;
            script.onload = () => resolve(window.turnstile);
            script.onerror = () => reject(new Error("Não foi possível carregar a verificação de segurança. Confira sua internet e recarregue a página."));
            document.head.append(script);
        });
        return carregamento;
    }

    async function prepararFormulario(formulario) {
        if (!chave || !formulario || widgets.has(formulario)) return;

        const caixa = document.createElement("div");
        caixa.className = "captcha-caixa";
        const botao = formulario.querySelector('button[type="submit"]');
        botao ? botao.before(caixa) : formulario.append(caixa);

        const estado = { id: null, token: null, esperando: [] };
        widgets.set(formulario, estado);

        const entregar = token => {
            estado.token = token;
            estado.esperando.splice(0).forEach(({ resolve }) => resolve(token));
        };

        try {
            const turnstile = await carregarTurnstile();
            estado.id = turnstile.render(caixa, {
                sitekey: chave,
                appearance: "interaction-only",   // só aparece se precisar de clique
                language: "pt-br",
                callback: entregar,
                "expired-callback": () => { estado.token = null; },
                "error-callback": () => { estado.token = null; }
            });
        } catch (erro) {
            estado.esperando.splice(0).forEach(({ reject }) => reject(erro));
            estado.falha = erro;
        }
    }

    // Token para o próximo envio (undefined com o CAPTCHA desligado)
    function token(formulario) {
        if (!chave) return Promise.resolve(undefined);
        const estado = widgets.get(formulario);
        if (!estado) return Promise.reject(new Error("Verificação de segurança não iniciada. Recarregue a página."));
        if (estado.falha) return Promise.reject(estado.falha);
        if (estado.token) return Promise.resolve(estado.token);

        return new Promise((resolve, reject) => {
            const pedido = { resolve, reject };
            estado.esperando.push(pedido);
            setTimeout(() => {
                const indice = estado.esperando.indexOf(pedido);
                if (indice < 0) return;
                estado.esperando.splice(indice, 1);
                reject(new Error("Confirme a verificação de segurança (\"não sou um robô\") e tente de novo."));
            }, ESPERA_MAXIMA_MS);
        });
    }

    // O token vale uma vez só: depois de cada tentativa, pede outro
    function renovar(formulario) {
        const estado = widgets.get(formulario);
        if (!estado || estado.id === null) return;
        estado.token = null;
        window.turnstile?.reset(estado.id);
    }

    window.SERFCaptcha = Object.freeze({ ativo: Boolean(chave), prepararFormulario, token, renovar });
})();
