/* =========================================================================
   S.E.R.F. — PAGAMENTOS (pagamentos.js)  ·  AMBIENTE SIMULADO

   Pix (QR Code + copia e cola), cartão de crédito (parcelado), boleto e
   faturamento a prazo (28/30/60 dias, sujeito à aprovação do fornecedor).
   Nenhum dinheiro circula: a "confirmação" simula o retorno de um gateway.

   Segurança:
   - O navegador não grava na tabela pagamentos; usa as funções RPC da
     migration 009 (iniciar, confirmar, responder prazo), que validam tudo.
   - Número completo e CVV do cartão NUNCA saem do navegador: só os 4
     últimos dígitos e a bandeira são enviados.

   API (window.SERFPagamentos):
     buscar(idPedido)                → pagamento | null
     renderizar(container, contexto) → seção "Pagamento" do modal do pedido
     liberaEnvio(pagamento)          → true se pago ou prazo aprovado
   ========================================================================= */

"use strict";

(function () {
    const { swalConfig, escaparHTML, formatarMoeda } = window.SERFUtils;

    const METODOS = {
        PIX: { rotulo: "Pix", icone: "⚡" },
        CARTAO: { rotulo: "Cartão de crédito", icone: "💳" },
        BOLETO: { rotulo: "Boleto", icone: "🧾" },
        PRAZO: { rotulo: "Faturamento a prazo", icone: "📅" }
    };

    const CARTOES_TESTE = {
        aprovado: "4111 1111 1111 1111",
        recusado: "4000 0000 0000 0002"
    };


    /* =====================================================================
       1. DADOS
       ===================================================================== */

    async function buscar(idPedido) {
        const { data, error } = await obterSupabase()
            .from("pagamentos")
            .select("*")
            .eq("id_pedido", idPedido)
            .maybeSingle();

        if (error) throw error;
        return data;
    }

    async function chamarRPC(funcao, parametros) {
        const { data, error } = await obterSupabase().rpc(funcao, parametros);
        if (error) throw error;
        return Array.isArray(data) ? data[0] : data;
    }

    const iniciar = (idPedido, metodo, extras = {}) => chamarRPC("iniciar_pagamento", {
        p_id_pedido: idPedido,
        p_metodo: metodo,
        p_parcelas: extras.parcelas ?? 1,
        p_prazo_dias: extras.prazoDias ?? null
    });

    const confirmar = (idPedido, cartao = {}) => chamarRPC("confirmar_pagamento_simulado", {
        p_id_pedido: idPedido,
        p_cartao_final: cartao.final ?? null,
        p_cartao_bandeira: cartao.bandeira ?? null
    });

    const responderPrazo = (idPedido, aprovar, motivo) => chamarRPC("responder_pagamento_prazo", {
        p_id_pedido: idPedido,
        p_aprovar: aprovar,
        p_motivo: motivo ?? null
    });


    /* =====================================================================
       2. ESTADO DERIVADO
       ===================================================================== */

    function vencido(pagamento) {
        return Boolean(
            pagamento &&
            pagamento.status === "AGUARDANDO_PAGAMENTO" &&
            pagamento.vencimento &&
            new Date(pagamento.vencimento) < new Date()
        );
    }

    function liberaEnvio(pagamento) {
        return Boolean(
            pagamento &&
            (pagamento.status === "PAGO" ||
                (pagamento.metodo === "PRAZO" && pagamento.status === "AGUARDANDO_PAGAMENTO"))
        );
    }

    // { classe, rotulo } para o selo de situação
    function situacao(pagamento) {
        if (!pagamento) return { classe: "pendente", rotulo: "Aguardando pagamento" };
        if (vencido(pagamento)) return { classe: "vencido", rotulo: "Cobrança vencida" };

        const mapa = {
            AGUARDANDO_APROVACAO: { classe: "analise", rotulo: "Prazo em análise" },
            AGUARDANDO_PAGAMENTO: pagamento.metodo === "PRAZO"
                ? { classe: "faturado", rotulo: "Faturado a prazo" }
                : { classe: "pendente", rotulo: "Aguardando pagamento" },
            PAGO: { classe: "pago", rotulo: "Pago" },
            RECUSADO: { classe: "vencido", rotulo: "Prazo recusado" },
            CANCELADO: { classe: "neutro", rotulo: "Cancelado" },
            ESTORNADO: { classe: "neutro", rotulo: "Estornado" }
        };

        return mapa[pagamento.status] || { classe: "neutro", rotulo: pagamento.status };
    }

    function dataHora(valor) {
        if (!valor) return "—";
        return new Date(valor).toLocaleString("pt-BR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
        });
    }

    function dataCurta(valor) {
        if (!valor) return "—";
        return new Date(valor).toLocaleDateString("pt-BR");
    }

    function descricaoMetodo(pagamento) {
        const base = METODOS[pagamento.metodo]?.rotulo || pagamento.metodo;

        if (pagamento.metodo === "CARTAO") {
            const cartao = pagamento.cartao_final ? ` ${pagamento.cartao_bandeira || ""} •••• ${pagamento.cartao_final}` : "";
            return `${base}${cartao} · ${pagamento.parcelas}x`;
        }
        if (pagamento.metodo === "PRAZO") return `${base} · ${pagamento.prazo_dias} dias`;
        return base;
    }


    /* =====================================================================
       3. SEÇÃO "PAGAMENTO" DO MODAL DO PEDIDO
       contexto: { pedidoId, statusPedido, valorTotal, produto,
                   parceiroNome, papel: "comprador" | "fornecedor",
                   pagamento, aoAtualizar(pagamento, mensagemChat) }
       ===================================================================== */

    function selo(pagamento) {
        const s = situacao(pagamento);
        return `<span class="pag-selo ${s.classe}">${escaparHTML(s.rotulo)}</span>`;
    }

    function renderizar(container, contexto) {
        if (!container) return;

        const { papel, pagamento, statusPedido } = contexto;
        const comprador = papel === "comprador";
        let corpo = "";
        let acoes = "";

        if (statusPedido === "PENDENTE") {
            corpo = comprador
                ? "O pagamento é liberado assim que o fornecedor confirmar o pedido."
                : "Confirme o pedido para liberar o pagamento ao comprador.";

        } else if (!pagamento || pagamento.status === "RECUSADO" || vencido(pagamento)) {
            if (statusPedido === "CANCELADO") {
                corpo = "Pedido cancelado.";
            } else if (comprador && ["CONFIRMADO", "EM_SEPARACAO"].includes(statusPedido)) {
                corpo = pagamento?.status === "RECUSADO"
                    ? `O fornecedor recusou o pagamento a prazo${pagamento.motivo_recusa ? `: “${escaparHTML(pagamento.motivo_recusa)}”` : ""}. Escolha outra forma de pagamento.`
                    : vencido(pagamento)
                        ? "A cobrança anterior venceu. Gere uma nova para concluir o pagamento."
                        : "Pedido confirmado pelo fornecedor. Escolha como deseja pagar.";
                acoes = `<button type="button" class="btn-primary" data-pag-acao="checkout">Pagar ${escaparHTML(formatarMoeda(contexto.valorTotal))}</button>`;
            } else {
                corpo = comprador
                    ? "Aguardando liberação do pagamento."
                    : "Aguardando o comprador escolher a forma de pagamento. O envio é liberado após o pagamento.";
            }

        } else if (pagamento.status === "AGUARDANDO_APROVACAO") {
            corpo = comprador
                ? `Você pediu faturamento em ${pagamento.prazo_dias} dias. Aguardando a análise do fornecedor.`
                : `O comprador pediu para pagar em <strong>${pagamento.prazo_dias} dias</strong> (${escaparHTML(formatarMoeda(pagamento.valor))}). Aprovar libera o envio; o comprador paga até o vencimento.`;
            if (!comprador) {
                acoes = `
                    <button type="button" class="btn-secondary" data-pag-acao="recusar-prazo">Recusar</button>
                    <button type="button" class="btn-primary" data-pag-acao="aprovar-prazo">Aprovar prazo</button>
                `;
            }

        } else if (pagamento.status === "AGUARDANDO_PAGAMENTO") {
            if (pagamento.metodo === "PRAZO") {
                corpo = comprador
                    ? `Fatura de ${escaparHTML(formatarMoeda(pagamento.valor))} com vencimento em <strong>${dataCurta(pagamento.vencimento)}</strong>.`
                    : `Prazo aprovado: o comprador paga até <strong>${dataCurta(pagamento.vencimento)}</strong>. O envio já está liberado.`;
                if (comprador) acoes = `<button type="button" class="btn-primary" data-pag-acao="pagar-fatura">Pagar fatura</button>`;
            } else {
                corpo = comprador
                    ? `${escaparHTML(METODOS[pagamento.metodo].rotulo)} gerado, válido até ${dataHora(pagamento.vencimento)}.`
                    : `O comprador gerou um ${escaparHTML(METODOS[pagamento.metodo].rotulo.toLowerCase())}; aguardando a confirmação.`;
                if (comprador) {
                    acoes = `
                        <button type="button" class="btn-secondary" data-pag-acao="checkout-trocar">Trocar forma</button>
                        <button type="button" class="btn-primary" data-pag-acao="checkout">Continuar pagamento</button>
                    `;
                }
            }

        } else if (pagamento.status === "PAGO") {
            corpo = `${escaparHTML(descricaoMetodo(pagamento))} · pago em ${dataHora(pagamento.data_pagamento)}`;
            acoes = `<button type="button" class="btn-secondary" data-pag-acao="comprovante">Comprovante</button>`;

        } else {
            corpo = pagamento.status === "ESTORNADO"
                ? `Pagamento de ${escaparHTML(formatarMoeda(pagamento.valor))} estornado após o cancelamento do pedido.`
                : "Cobrança cancelada junto com o pedido.";
        }

        container.hidden = false;
        container.innerHTML = `
            <div class="pag-cabecalho">
                <strong>Pagamento</strong>
                ${statusPedido === "PENDENTE" ? "" : selo(pagamento)}
            </div>
            <p class="pag-texto">${corpo}</p>
            ${acoes ? `<div class="pag-acoes">${acoes}</div>` : ""}
        `;

        container.onclick = evento => {
            const botao = evento.target.closest("[data-pag-acao]");
            if (botao) executarAcao(botao.dataset.pagAcao, contexto, botao);
        };
    }

    async function executarAcao(acao, contexto, botao) {
        const { pedidoId, pagamento } = contexto;

        if (acao === "checkout") return abrirCheckout(contexto, { metodoInicial: pagamento?.status === "AGUARDANDO_PAGAMENTO" && !vencido(pagamento) ? pagamento.metodo : "PIX" });
        if (acao === "checkout-trocar") return abrirCheckout(contexto, { metodoInicial: "PIX", forcarNovo: true });
        if (acao === "comprovante") return abrirComprovante(contexto);

        if (acao === "pagar-fatura") {
            const ok = await Swal.fire({
                ...swalConfig,
                title: "Pagar fatura?",
                html: `Confirmar o pagamento de <strong>${escaparHTML(formatarMoeda(pagamento.valor))}</strong> (simulação).`,
                icon: "question",
                showCancelButton: true,
                confirmButtonText: "Pagar",
                cancelButtonText: "Cancelar"
            });
            if (!ok.isConfirmed) return;

            return comFeedback(botao, async () => {
                const atualizado = await confirmar(pedidoId);
                contexto.aoAtualizar(atualizado, `💳 Fatura paga: ${formatarMoeda(atualizado.valor)}.`);
                sucesso("Fatura paga!", atualizado);
            });
        }

        if (acao === "aprovar-prazo") {
            return comFeedback(botao, async () => {
                const atualizado = await responderPrazo(pedidoId, true);
                contexto.aoAtualizar(atualizado, `✅ Pagamento a prazo aprovado. Vencimento: ${dataCurta(atualizado.vencimento)}.`);
            });
        }

        if (acao === "recusar-prazo") {
            const { value: motivo, isConfirmed } = await Swal.fire({
                ...swalConfig,
                title: "Recusar pagamento a prazo",
                input: "text",
                inputLabel: "Motivo (opcional, enviado ao comprador)",
                inputPlaceholder: "Ex.: limite de crédito excedido",
                showCancelButton: true,
                confirmButtonText: "Recusar",
                cancelButtonText: "Voltar",
                confirmButtonColor: "#DC2626"
            });
            if (!isConfirmed) return;

            return comFeedback(botao, async () => {
                const atualizado = await responderPrazo(pedidoId, false, motivo);
                contexto.aoAtualizar(atualizado, `❌ Pagamento a prazo recusado${atualizado.motivo_recusa ? `: ${atualizado.motivo_recusa}` : ""}.`);
            });
        }
    }

    async function comFeedback(botao, tarefa) {
        botao.disabled = true;
        try {
            await tarefa();
        } catch (erro) {
            console.error("[SERF:Pagamentos]", erro);
            Swal.fire({ ...swalConfig, title: "Não foi possível concluir", text: erro.message, icon: "error" });
        } finally {
            botao.disabled = false;
        }
    }

    function sucesso(titulo, pagamento) {
        Swal.fire({
            ...swalConfig,
            title: titulo,
            html: `${escaparHTML(descricaoMetodo(pagamento))}<br>Transação <strong>${escaparHTML(pagamento.transacao_id || "")}</strong>`,
            icon: "success",
            timer: 2600,
            showConfirmButton: false
        });
    }


    /* =====================================================================
       4. CHECKOUT (modal com as 4 formas)
       ===================================================================== */

    let checkout = null; // { contexto, pagamento, metodo, cronometro }

    function garantirModal() {
        if (document.getElementById("modalPagamento")) return;

        const modal = document.createElement("div");
        modal.id = "modalPagamento";
        modal.className = "modal-serf";
        modal.style.display = "none";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "pagTitulo");

        modal.innerHTML = `
            <div class="modal-serf-conteudo pag-modal">
                <div class="modal-serf-header">
                    <div>
                        <h3 id="pagTitulo">Pagamento</h3>
                        <small class="pag-subtitulo" id="pagSubtitulo"></small>
                    </div>
                    <button type="button" class="btn-fechar-modal" data-pag-fechar aria-label="Fechar">&times;</button>
                </div>

                <div class="pag-aviso-teste" role="note">
                    <strong>Ambiente de testes:</strong> nenhuma cobrança real é feita.
                </div>

                <div class="pag-total">
                    <span>Total a pagar</span>
                    <strong id="pagTotal">R$ 0,00</strong>
                </div>

                <div class="pag-metodos" role="tablist" aria-label="Forma de pagamento">
                    ${Object.entries(METODOS).map(([codigo, m]) => `
                        <button type="button" class="pag-metodo" role="tab" data-metodo="${codigo}" aria-selected="false">
                            <span aria-hidden="true">${m.icone}</span> ${m.rotulo}
                        </button>
                    `).join("")}
                </div>

                <div class="pag-painel" id="pagPainel" role="tabpanel"></div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.addEventListener("click", evento => {
            if (evento.target === modal || evento.target.closest("[data-pag-fechar]")) fecharCheckout();

            const metodo = evento.target.closest("[data-metodo]");
            if (metodo) selecionarMetodo(metodo.dataset.metodo);
        });

        window.addEventListener("keydown", evento => {
            if (evento.key === "Escape" && modal.style.display === "flex") fecharCheckout();
        });
    }

    function abrirCheckout(contexto, { metodoInicial = "PIX", forcarNovo = false } = {}) {
        garantirModal();

        checkout = {
            contexto,
            pagamento: forcarNovo ? null : contexto.pagamento,
            metodo: null,
            cronometro: null
        };

        document.getElementById("pagTitulo").textContent = `Pagamento do pedido #${contexto.pedidoId}`;
        document.getElementById("pagSubtitulo").textContent = `${contexto.produto} · ${contexto.parceiroNome}`;
        document.getElementById("pagTotal").textContent = formatarMoeda(contexto.valorTotal);

        document.getElementById("modalPagamento").style.display = "flex";
        selecionarMetodo(metodoInicial);
    }

    function fecharCheckout() {
        const modal = document.getElementById("modalPagamento");
        if (modal) modal.style.display = "none";
        clearInterval(checkout?.cronometro);
        checkout = null;
    }

    function selecionarMetodo(metodo) {
        if (!checkout) return;

        clearInterval(checkout.cronometro);
        checkout.metodo = metodo;

        document.querySelectorAll("#modalPagamento .pag-metodo").forEach(botao => {
            const ativo = botao.dataset.metodo === metodo;
            botao.classList.toggle("active", ativo);
            botao.setAttribute("aria-selected", String(ativo));
        });

        // Reaproveita a cobrança em aberto do mesmo método (não gera outra)
        const existente = checkout.pagamento &&
            checkout.pagamento.metodo === metodo &&
            checkout.pagamento.status === "AGUARDANDO_PAGAMENTO" &&
            !vencido(checkout.pagamento)
            ? checkout.pagamento
            : null;

        const painel = document.getElementById("pagPainel");
        const renderizadores = { PIX: painelPix, CARTAO: painelCartao, BOLETO: painelBoleto, PRAZO: painelPrazo };
        renderizadores[metodo](painel, existente);
    }

    // Atualiza a seção do modal do pedido + mensagem no chat
    function concluir(pagamento, mensagemChat) {
        checkout.contexto.aoAtualizar(pagamento, mensagemChat);
        checkout.pagamento = pagamento;
    }

    async function gerar(botao, metodo, extras) {
        botao.disabled = true;
        try {
            const pagamento = await iniciar(checkout.contexto.pedidoId, metodo, extras);
            checkout.pagamento = pagamento;
            checkout.contexto.aoAtualizar(pagamento, null);
            return pagamento;
        } catch (erro) {
            console.error("[SERF:Pagamentos] Falha ao gerar cobrança:", erro);
            Swal.fire({ ...swalConfig, title: "Não foi possível gerar a cobrança", text: erro.message, icon: "error" });
            return null;
        } finally {
            botao.disabled = false;
        }
    }

    async function confirmarSimulado(botao, cartao) {
        botao.disabled = true;
        const textoOriginal = botao.textContent;
        botao.textContent = "Processando...";

        try {
            // Pequena espera para simular a resposta do gateway
            await new Promise(resolver => setTimeout(resolver, 900));
            const pagamento = await confirmar(checkout.contexto.pedidoId, cartao);
            const rotulo = METODOS[pagamento.metodo].rotulo;

            concluir(pagamento, `💳 Pagamento confirmado via ${rotulo}: ${formatarMoeda(pagamento.valor)}.`);
            fecharCheckout();
            sucesso("Pagamento aprovado!", pagamento);
        } catch (erro) {
            console.error("[SERF:Pagamentos] Pagamento não confirmado:", erro);
            Swal.fire({ ...swalConfig, title: "Pagamento não aprovado", text: erro.message, icon: "error" });
        } finally {
            botao.disabled = false;
            botao.textContent = textoOriginal;
        }
    }

    function iniciarCronometro(elemento, vencimento) {
        const atualizar = () => {
            const restante = new Date(vencimento) - new Date();
            if (restante <= 0) {
                elemento.textContent = "expirado — gere um novo código";
                elemento.classList.add("expirado");
                clearInterval(checkout?.cronometro);
                return;
            }
            const min = Math.floor(restante / 60000);
            const seg = Math.floor((restante % 60000) / 1000);
            elemento.textContent = `expira em ${String(min).padStart(2, "0")}:${String(seg).padStart(2, "0")}`;
        };

        atualizar();
        checkout.cronometro = setInterval(atualizar, 1000);
    }

    async function copiar(texto, botao) {
        try {
            await navigator.clipboard.writeText(texto);
            const original = botao.textContent;
            botao.textContent = "Copiado!";
            setTimeout(() => { botao.textContent = original; }, 1600);
        } catch (e) {
            Swal.fire({ ...swalConfig, title: "Copie manualmente", text: texto, icon: "info" });
        }
    }

    // ---------- PIX ----------
    function painelPix(painel, pagamento) {
        if (!pagamento) {
            painel.innerHTML = `
                <p class="pag-explicacao">Gere um QR Code Pix. A confirmação é imediata após o pagamento.</p>
                <button type="button" class="btn-primary pag-botao-largo" id="btnGerarPix">Gerar QR Code Pix</button>
            `;
            document.getElementById("btnGerarPix").onclick = async evento => {
                const gerado = await gerar(evento.currentTarget, "PIX");
                if (gerado) painelPix(painel, gerado);
            };
            return;
        }

        painel.innerHTML = `
            <div class="pag-pix">
                <div class="pag-qrcode" id="pagQrcode" aria-label="QR Code Pix (simulado)"></div>
                <div class="pag-pix-info">
                    <span class="pag-rotulo">Pix copia e cola <small id="pagExpira"></small></span>
                    <textarea class="pag-codigo" readonly rows="4" id="pagCodigoPix">${escaparHTML(pagamento.codigo_pix)}</textarea>
                    <button type="button" class="btn-secondary" id="btnCopiarPix">Copiar código</button>
                </div>
            </div>
            <button type="button" class="btn-primary pag-botao-largo" id="btnConfirmarPix">Simular pagamento do Pix</button>
        `;

        desenharQRCode(document.getElementById("pagQrcode"), pagamento.codigo_pix);
        iniciarCronometro(document.getElementById("pagExpira"), pagamento.vencimento);

        document.getElementById("btnCopiarPix").onclick = e => copiar(pagamento.codigo_pix, e.currentTarget);
        document.getElementById("btnConfirmarPix").onclick = e => confirmarSimulado(e.currentTarget);
    }

    function desenharQRCode(alvo, texto) {
        if (typeof qrcode !== "function") {
            alvo.innerHTML = `<p class="pag-explicacao">QR Code indisponível (biblioteca não carregada). Use o copia e cola.</p>`;
            return;
        }

        const qr = qrcode(0, "M");
        qr.addData(texto);
        qr.make();
        alvo.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    }

    // ---------- CARTÃO ----------
    function bandeiraDoCartao(numero) {
        if (/^4/.test(numero)) return "Visa";
        if (/^(5[1-5]|2[2-7])/.test(numero)) return "Mastercard";
        if (/^3[47]/.test(numero)) return "Amex";
        if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(numero)) return "Elo";
        return "Cartão";
    }

    function luhnValido(numero) {
        let soma = 0;
        let dobrar = false;
        for (let i = numero.length - 1; i >= 0; i--) {
            let digito = Number(numero[i]);
            if (dobrar) {
                digito *= 2;
                if (digito > 9) digito -= 9;
            }
            soma += digito;
            dobrar = !dobrar;
        }
        return numero.length >= 13 && soma % 10 === 0;
    }

    function painelCartao(painel) {
        const total = Number(checkout.contexto.valorTotal) || 0;
        const opcoesParcelas = Array.from({ length: 12 }, (_, i) => i + 1)
            .map(n => `<option value="${n}">${n}x de ${formatarMoeda(total / n)} sem juros</option>`)
            .join("");

        painel.innerHTML = `
            <p class="pag-explicacao">
                Use um cartão de teste: <code>${CARTOES_TESTE.aprovado}</code> (aprovado) ou
                <code>${CARTOES_TESTE.recusado}</code> (recusado). <strong>Não digite um cartão real.</strong>
            </p>

            <form class="pag-form-cartao" id="formCartao" autocomplete="off" novalidate>
                <div class="campo-form">
                    <label for="cartaoNumero">Número do cartão</label>
                    <input id="cartaoNumero" inputmode="numeric" maxlength="23" placeholder="0000 0000 0000 0000" required>
                    <small class="campo-ajuda" id="cartaoBandeira"></small>
                </div>

                <div class="campo-form">
                    <label for="cartaoNome">Nome impresso no cartão</label>
                    <input id="cartaoNome" maxlength="60" placeholder="Como está no cartão" required>
                </div>

                <div class="linha-dupla">
                    <div class="campo-form">
                        <label for="cartaoValidade">Validade</label>
                        <input id="cartaoValidade" inputmode="numeric" maxlength="5" placeholder="MM/AA" required>
                    </div>
                    <div class="campo-form">
                        <label for="cartaoCvv">CVV</label>
                        <input id="cartaoCvv" inputmode="numeric" maxlength="4" placeholder="123" required>
                    </div>
                </div>

                <div class="campo-form">
                    <label for="cartaoParcelas">Parcelamento</label>
                    <select id="cartaoParcelas">${opcoesParcelas}</select>
                </div>

                <button type="submit" class="btn-primary pag-botao-largo" id="btnPagarCartao">
                    Pagar ${escaparHTML(formatarMoeda(total))}
                </button>
            </form>
        `;

        const numero = document.getElementById("cartaoNumero");
        const validade = document.getElementById("cartaoValidade");

        numero.addEventListener("input", () => {
            const digitos = numero.value.replace(/\D/g, "").slice(0, 19);
            numero.value = digitos.replace(/(\d{4})(?=\d)/g, "$1 ");
            document.getElementById("cartaoBandeira").textContent = digitos.length >= 4 ? bandeiraDoCartao(digitos) : "";
        });

        validade.addEventListener("input", () => {
            const digitos = validade.value.replace(/\D/g, "").slice(0, 4);
            validade.value = digitos.length > 2 ? `${digitos.slice(0, 2)}/${digitos.slice(2)}` : digitos;
        });

        document.getElementById("formCartao").addEventListener("submit", async evento => {
            evento.preventDefault();

            const digitos = numero.value.replace(/\D/g, "");
            const [mes, ano] = validade.value.split("/").map(Number);
            const cvv = document.getElementById("cartaoCvv").value.replace(/\D/g, "");
            const nome = document.getElementById("cartaoNome").value.trim();
            const agora = new Date();
            const expirado = !mes || mes > 12 || !ano ||
                new Date(2000 + ano, mes, 0, 23, 59) < agora;

            const erro =
                !luhnValido(digitos) ? "Número de cartão inválido." :
                nome.length < 3 ? "Informe o nome impresso no cartão." :
                expirado ? "Validade inválida ou cartão vencido." :
                cvv.length < 3 ? "CVV inválido." : null;

            if (erro) {
                Swal.fire({ ...swalConfig, title: "Confira os dados do cartão", text: erro, icon: "warning" });
                return;
            }

            const botao = document.getElementById("btnPagarCartao");
            const parcelas = Number(document.getElementById("cartaoParcelas").value);

            // 1) registra a cobrança no cartão (parcelas)  2) "autoriza" no gateway simulado
            const pagamento = await gerar(botao, "CARTAO", { parcelas });
            if (!pagamento) return;

            await confirmarSimulado(botao, { final: digitos.slice(-4), bandeira: bandeiraDoCartao(digitos) });
        });
    }

    // ---------- BOLETO ----------
    function painelBoleto(painel, pagamento) {
        if (!pagamento) {
            painel.innerHTML = `
                <p class="pag-explicacao">O boleto vence em 3 dias. Em um banco real, a compensação leva até 1 dia útil.</p>
                <button type="button" class="btn-primary pag-botao-largo" id="btnGerarBoleto">Gerar boleto</button>
            `;
            document.getElementById("btnGerarBoleto").onclick = async evento => {
                const gerado = await gerar(evento.currentTarget, "BOLETO");
                if (gerado) painelBoleto(painel, gerado);
            };
            return;
        }

        painel.innerHTML = `
            <div class="pag-boleto">
                <span class="pag-rotulo">Linha digitável · vence em ${dataCurta(pagamento.vencimento)}</span>
                <div class="pag-codigo pag-linha">${escaparHTML(pagamento.linha_digitavel)}</div>
                <button type="button" class="btn-secondary" id="btnCopiarBoleto">Copiar linha digitável</button>
            </div>
            <button type="button" class="btn-primary pag-botao-largo" id="btnConfirmarBoleto">Simular compensação do boleto</button>
        `;

        document.getElementById("btnCopiarBoleto").onclick = e =>
            copiar(pagamento.linha_digitavel.replace(/\D/g, ""), e.currentTarget);
        document.getElementById("btnConfirmarBoleto").onclick = e => confirmarSimulado(e.currentTarget);
    }

    // ---------- A PRAZO ----------
    function painelPrazo(painel) {
        painel.innerHTML = `
            <p class="pag-explicacao">
                Solicite o faturamento a prazo. O fornecedor analisa o crédito: se aprovar, o envio é
                liberado e você paga até o vencimento.
            </p>
            <div class="pag-prazos" role="radiogroup" aria-label="Prazo de pagamento">
                ${[28, 30, 60].map((dias, i) => `
                    <label class="pag-prazo">
                        <input type="radio" name="prazoDias" value="${dias}" ${i === 1 ? "checked" : ""}>
                        <span><strong>${dias} dias</strong><small>vence em ${dataCurta(Date.now() + dias * 86400000)}*</small></span>
                    </label>
                `).join("")}
            </div>
            <small class="campo-ajuda">* O vencimento é contado a partir da aprovação do fornecedor.</small>
            <button type="button" class="btn-primary pag-botao-largo" id="btnSolicitarPrazo">Solicitar faturamento a prazo</button>
        `;

        document.getElementById("btnSolicitarPrazo").onclick = async evento => {
            const prazoDias = Number(painel.querySelector('input[name="prazoDias"]:checked').value);
            const pagamento = await gerar(evento.currentTarget, "PRAZO", { prazoDias });
            if (!pagamento) return;

            concluir(pagamento, `📅 Solicitei pagamento a prazo (${prazoDias} dias) de ${formatarMoeda(pagamento.valor)}.`);
            fecharCheckout();
            Swal.fire({
                ...swalConfig,
                title: "Solicitação enviada",
                text: "O fornecedor foi avisado pelo chat e vai analisar o pedido de prazo.",
                icon: "success",
                timer: 2600,
                showConfirmButton: false
            });
        };
    }


    /* =====================================================================
       5. COMPROVANTE
       ===================================================================== */

    function abrirComprovante(contexto) {
        const p = contexto.pagamento;
        const linhas = [
            ["Pedido", `#${contexto.pedidoId}`],
            ["Produto", contexto.produto],
            [contexto.papel === "comprador" ? "Fornecedor" : "Comprador", contexto.parceiroNome],
            ["Forma de pagamento", descricaoMetodo(p)],
            ["Valor", formatarMoeda(p.valor)],
            ["Pago em", dataHora(p.data_pagamento)],
            ["Transação", p.transacao_id || "—"]
        ];

        Swal.fire({
            ...swalConfig,
            title: "Comprovante de pagamento",
            html: `
                <div class="pag-comprovante">
                    ${linhas.map(([rotulo, valor]) => `
                        <div><span>${escaparHTML(rotulo)}</span><strong>${escaparHTML(valor)}</strong></div>
                    `).join("")}
                    <p>Pagamento simulado no ambiente de testes do S.E.R.F.</p>
                </div>
            `,
            confirmButtonText: "Fechar"
        });
    }


    window.SERFPagamentos = Object.freeze({
        buscar,
        renderizar,
        liberaEnvio,
        situacao,
        metodos: METODOS
    });
})();
