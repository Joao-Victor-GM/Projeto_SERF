/* ==========================================================
   S.E.R.F. — IDENTIDADE.JS
   Perfil → "Identidade da empresa": comprovar a posse do CNPJ
   (migration 029). Um código vai para o e-mail que a Receita Federal tem
   do CNPJ; no modo demonstração, aparece na tela.
   Sem a migration 029, o cartão fica escondido.
   ========================================================== */

"use strict";

(function () {
    const cartao = document.getElementById("identidade");
    const area = document.getElementById("identidadeConteudo");
    if (!cartao || !area) return;

    const { formatarData, dataLocalISO } = window.SERFUtils;
    const data = valor => formatarData(dataLocalISO(valor));

    function criar(tag, classe, texto) {
        const el = document.createElement(tag);
        if (classe) el.className = classe;
        if (texto !== undefined) el.textContent = texto;
        return el;
    }

    function botao(texto, classe = "btn-secondary") {
        const b = criar("button", classe, texto);
        b.type = "button";
        return b;
    }

    function mensagem(texto, tipo = "info") {
        const p = criar("p", `identidade-msg ${tipo}`, texto);
        if (tipo.includes("erro")) p.setAttribute("role", "alert");
        return p;
    }

    /* ---------------- ESTADOS ---------------- */

    function renderizarSituacao(id, modo) {
        area.replaceChildren();

        if (id.verificada_em) {
            area.append(
                criar("p", "identidade-ok", `✓ Posse do CNPJ comprovada em ${data(id.verificada_em)}.`),
                ...(id.metodo === "DEMONSTRACAO"
                    ? [mensagem("Comprovada no modo demonstração (sem e-mail da Receita).", "aviso")]
                    : [])
            );
            return;
        }

        if (id.contestada_em) {
            area.append(mensagem(
                "Outra conta comprovou a posse deste CNPJ. Até resolver, sua conta não recebe pedidos nem envia propostas. " +
                "Se é um engano, fale com o suporte.", "erro"));
            return;
        }

        const carencia = id.carencia_ate && new Date(id.carencia_ate) > new Date();
        area.append(
            criar("p", null, "Comprove que a empresa é sua para vender e ganhar o selo de homologado."),
            mensagem(carencia
                ? `Você pode continuar vendendo até ${data(id.carencia_ate)} sem comprovar.`
                : "Até comprovar, sua empresa não recebe pedidos nem envia propostas.", carencia ? "aviso" : "erro"),
            criar("p", "identidade-dica", modo === "REAL"
                ? "Enviaremos um código para o e-mail que a Receita Federal tem deste CNPJ (às vezes é o do contador)."
                : "Modo demonstração: o código aparece aqui na tela.")
        );

        const enviar = botao("Enviar código", "btn-primary");
        enviar.addEventListener("click", () => enviarCodigo(enviar, modo));
        area.append(enviar);

        // Código já enviado e ainda válido: já mostra o campo
        if (id.codigo_expira_em && new Date(id.codigo_expira_em) > new Date() && id.email_destino) {
            mostrarCampoCodigo({ destino: id.email_destino, modo });
        }
    }

    function mostrarCampoCodigo({ destino, modo, codigo }) {
        area.querySelector(".identidade-codigo")?.remove();

        const bloco = criar("form", "identidade-codigo");
        bloco.noValidate = true;

        if (modo === "DEMONSTRACAO" && codigo) {
            const demo = criar("div", "identidade-demo");
            demo.setAttribute("role", "note");
            demo.append(
                criar("strong", null, "Demonstração: "),
                document.createTextNode(`em produção, este código iria para o e-mail da Receita Federal. Código: `),
                criar("code", null, codigo)
            );
            bloco.append(demo);
        } else {
            bloco.append(criar("p", null, `Enviamos um código para ${destino}. Peça a quem recebe esse e-mail na empresa.`));
        }

        const rotulo = criar("label", "identidade-campo");
        const span = criar("span", null, "Código de 6 dígitos");
        const campo = criar("input");
        Object.assign(campo, { id: "codigoIdentidade", inputMode: "numeric", autocomplete: "off", maxLength: 6 });
        campo.setAttribute("pattern", "[0-9]{6}");
        rotulo.append(span, campo);

        const confirmar = botao("Confirmar", "btn-primary");
        confirmar.type = "submit";
        const erro = mensagem("", "erro");
        erro.hidden = true;

        bloco.append(rotulo, confirmar, erro);
        bloco.addEventListener("submit", evento => {
            evento.preventDefault();
            confirmarCodigo(campo.value, confirmar, erro);
        });

        area.append(bloco);
        campo.focus();
    }

    /* ---------------- AÇÕES ---------------- */

    async function enviarCodigo(botaoEnviar, modo) {
        botaoEnviar.disabled = true;
        try {
            const resposta = await window.SERFDados.empresa.enviarCodigoIdentidade();
            mostrarCampoCodigo({ ...resposta, modo: resposta.modo || modo });
            botaoEnviar.textContent = "Enviar outro código";
        } catch (falha) {
            area.querySelector(".identidade-msg.erro.envio")?.remove();
            const erro = mensagem(window.SERFUtils.mensagemDeErro(falha), "erro envio");
            botaoEnviar.after(erro);
        } finally {
            botaoEnviar.disabled = false;
        }
    }

    async function confirmarCodigo(valor, botaoConfirmar, erro) {
        const codigo = String(valor || "").replace(/\D/g, "");
        erro.hidden = true;
        if (codigo.length !== 6) {
            erro.textContent = "Digite os 6 números do código.";
            erro.hidden = false;
            return;
        }

        botaoConfirmar.disabled = true;
        try {
            const resultado = await window.SERFDados.empresa.confirmarIdentidade(codigo);
            if (String(resultado).startsWith("incorreto")) {
                const restantes = Number(String(resultado).split(":")[1] || 0);
                erro.textContent = restantes > 0
                    ? `Código incorreto. Restam ${restantes} tentativa${restantes === 1 ? "" : "s"}.`
                    : "Código incorreto. Peça um novo código.";
                erro.hidden = false;
                return;
            }
            window.SERFAvisos?.sucesso("Empresa verificada", "A posse do CNPJ foi comprovada.");
            await carregar();
        } catch (falha) {
            erro.textContent = window.SERFUtils.mensagemDeErro(falha);
            erro.hidden = false;
        } finally {
            botaoConfirmar.disabled = false;
        }
    }

    async function carregar() {
        const dados = window.SERFDados?.empresa;
        if (!dados) return;

        let id, modo;
        try {
            [id, modo] = await Promise.all([dados.identidade(), dados.modoIdentidade()]);
        } catch (erro) {
            console.warn("[SERF:Identidade] Indisponível:", erro.message || erro);   // sem a migration 029
            return;
        }
        if (!id) return;

        cartao.hidden = false;
        renderizarSituacao(id, modo);
    }

    async function iniciar() {
        if (!(await window.serfSessao)) return;
        carregar();
    }

    // Depois de todos os scripts defer (dados/empresa.repositorio.js)
    if (document.readyState === "complete") iniciar();
    else document.addEventListener("DOMContentLoaded", iniciar);

    window.SERFIdentidade = Object.freeze({ recarregar: carregar });
})();
