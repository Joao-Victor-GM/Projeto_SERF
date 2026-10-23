/* =========================================================================
   S.E.R.F. — NOTA FISCAL ELETRÔNICA (notas.js)

   O fornecedor emite a NF-e após o pagamento; comprador e fornecedor veem
   o DANFE. Dois modos (configuracao_nfe.modo, migration 027):
   - SIMULADA (padrão): DANFE com a tarja SEM VALOR FISCAL, sem SEFAZ.
   - REAL: emissão pela Focus NFe (Edge Function nfe): PROCESSANDO →
     AUTORIZADA (DANFE/XML oficiais) ou REJEITADA (motivo da SEFAZ).

   As regras ficam no banco (migration 010): emissão só após pagamento,
   numeração sequencial, envio exige nota autorizada, cancelamento em até
   24 h com justificativa de 15+ caracteres.

   API (window.SERFNotas):
     buscar(idPedido)                → nota mais recente | null
     renderizar(container, contexto) → seção "Nota fiscal" do modal
     autorizada(nota)                → true se há NF-e válida
   ========================================================================= */

"use strict";

(function () {
    const { swalConfig, escaparHTML, formatarMoeda, formatarCNPJ } = window.SERFUtils;

    const PRAZO_CANCELAMENTO_MS = 24 * 3600000;


    /* =====================================================================
       1. DADOS
       ===================================================================== */

    async function buscar(idPedido) {
        const { data, error } = await obterSupabase()
            .from("notas_fiscais")
            .select("*")
            .eq("id_pedido", idPedido)
            .order("id_nota", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data;
    }

    async function chamarRPC(funcao, parametros) {
        const { data, error } = await obterSupabase().rpc(funcao, parametros);
        if (error) throw error;
        return Array.isArray(data) ? data[0] : data;
    }

    const emitir = idPedido => chamarRPC("emitir_nota_fiscal", { p_id_pedido: idPedido });

    // Modo da NF-e (027). Sem a migration: SIMULADA.
    let modoEmCache = null;
    async function modoNfe() {
        if (modoEmCache) return modoEmCache;
        try {
            const { data, error } = await obterSupabase().from("configuracao_nfe").select("modo").maybeSingle();
            if (error) throw error;
            modoEmCache = data?.modo === "REAL" ? "REAL" : "SIMULADA";
        } catch {
            modoEmCache = "SIMULADA";
        }
        return modoEmCache;
    }

    // NF-e real: Edge Function nfe (emitir | consultar | cancelar)
    async function nfeReal(acao, idPedido, extras = {}) {
        const { data, error } = await obterSupabase().functions.invoke("nfe", { body: { acao, id_pedido: idPedido, ...extras } });
        if (!error) return data;

        let corpo = null;
        try { corpo = await error.context?.json?.(); } catch { /* corpo não é JSON */ }
        throw new Error(corpo?.erro || "O emissor de NF-e não respondeu. Tente novamente em instantes.");
    }

    const real = nota => nota?.provedor === "FOCUS_NFE";
    const cancelar = (idPedido, motivo) => chamarRPC("cancelar_nota_fiscal", { p_id_pedido: idPedido, p_motivo: motivo });

    function autorizada(nota) {
        return Boolean(nota && nota.status === "AUTORIZADA");
    }

    function podeCancelar(nota, statusPedido) {
        return autorizada(nota) &&
            !["ENVIADO", "ENTREGUE"].includes(statusPedido) &&
            Date.now() - new Date(nota.data_emissao).getTime() < PRAZO_CANCELAMENTO_MS;
    }

    function numeroFormatado(nota) {
        return String(nota.numero).padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3");
    }

    function chaveFormatada(chave) {
        return String(chave).replace(/(\d{4})(?=\d)/g, "$1 ");
    }

    function dataHora(valor) {
        return valor
            ? new Date(valor).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—";
    }


    /* =====================================================================
       2. SEÇÃO "NOTA FISCAL" DO MODAL DO PEDIDO
       contexto: { pedidoId, statusPedido, papel, nota, pagamentoLiberado,
                   aoAtualizar(nota, mensagemChat) }
       ===================================================================== */

    function renderizar(container, contexto) {
        if (!container) return;
        modoNfe();     // já busca o modo para o botão "Emitir" agir certo
        if (contexto.nota?.status !== "PROCESSANDO") pararAcompanhamento();

        const { papel, nota, statusPedido, pagamentoLiberado } = contexto;
        const fornecedor = papel === "fornecedor";
        let selo = "";
        let corpo;
        let acoes = "";

        if (nota?.status === "PROCESSANDO") {
            selo = `<span class="pag-selo analise">Na SEFAZ</span>`;
            corpo = "A NF-e foi enviada e está sendo autorizada pela SEFAZ. Esta seção atualiza sozinha.";
            acoes = `<button type="button" class="btn-secondary" data-nf-acao="consultar">Consultar agora</button>`;
            acompanharProcessamento(contexto);

        } else if (autorizada(nota)) {
            selo = `<span class="pag-selo pago">NF-e autorizada</span>`;
            corpo = `Nº ${numeroFormatado(nota)} · série ${nota.serie} · emitida em ${dataHora(nota.data_emissao)}`;
            acoes = real(nota) && nota.url_danfe
                ? `<a class="btn-secondary" href="${escaparHTML(nota.url_danfe)}" target="_blank" rel="noopener">Ver DANFE (PDF)</a>` +
                  (nota.url_xml ? `<a class="btn-text" href="${escaparHTML(nota.url_xml)}" target="_blank" rel="noopener">XML</a>` : "")
                : `<button type="button" class="btn-secondary" data-nf-acao="danfe">Ver DANFE</button>`;

            if (fornecedor && podeCancelar(nota, statusPedido)) {
                acoes = `<button type="button" class="btn-text" data-nf-acao="cancelar">Cancelar NF-e</button>` + acoes;
            }

        } else if (statusPedido === "PENDENTE" || statusPedido === "CANCELADO") {
            corpo = nota
                ? `NF-e nº ${numeroFormatado(nota)} cancelada: ${escaparHTML(nota.motivo_cancelamento || "")}`
                : statusPedido === "CANCELADO" ? "Pedido cancelado." : "A nota fiscal é emitida após a confirmação e o pagamento.";
            if (nota) selo = `<span class="pag-selo neutro">Cancelada</span>`;

        } else if (fornecedor && nota?.status === "REJEITADA") {
            selo = `<span class="pag-selo vencido">NF-e rejeitada</span>`;
            corpo = `A SEFAZ recusou a nota: “${escaparHTML(nota.mensagem_sefaz || "sem detalhes")}”. Corrija o cadastro e emita de novo.`;
            acoes = `<button type="button" class="btn-primary" data-nf-acao="emitir">Emitir de novo</button>`;

        } else if (fornecedor) {
            const cancelada = nota?.status === "CANCELADA";
            selo = `<span class="pag-selo pendente">${cancelada ? "Reemitir NF-e" : "NF-e pendente"}</span>`;
            corpo = pagamentoLiberado
                ? `${cancelada ? `A NF-e nº ${numeroFormatado(nota)} foi cancelada. ` : ""}Emita a nota fiscal para liberar o envio da mercadoria.`
                : "A emissão é liberada após o pagamento do comprador (ou a aprovação do prazo).";
            if (pagamentoLiberado) {
                acoes = `<button type="button" class="btn-primary" data-nf-acao="emitir">Emitir NF-e</button>`;
            }

        } else {
            selo = `<span class="pag-selo pendente">Aguardando emissão</span>`;
            corpo = "O fornecedor emite a nota fiscal após o pagamento. Ela aparece aqui automaticamente.";
        }

        container.hidden = false;
        container.innerHTML = `
            <div class="pag-cabecalho">
                <strong>Nota fiscal</strong>
                ${selo}
            </div>
            <p class="pag-texto">${corpo}</p>
            ${acoes ? `<div class="pag-acoes">${acoes}</div>` : ""}
        `;

        container.onclick = evento => {
            const botao = evento.target.closest("[data-nf-acao]");
            if (botao) executarAcao(botao.dataset.nfAcao, contexto, botao);
        };
    }

    // PROCESSANDO: consulta a SEFAZ (via Focus) a cada 5 s, até 2 min
    let acompanhamento = null;
    function acompanharProcessamento(contexto) {
        if (acompanhamento?.pedidoId === contexto.pedidoId) return;
        clearInterval(acompanhamento?.timer);

        let tentativas = 0;
        acompanhamento = {
            pedidoId: contexto.pedidoId,
            timer: setInterval(async () => {
                tentativas += 1;
                try {
                    const { nota } = await nfeReal("consultar", contexto.pedidoId);
                    if (nota && nota.status !== "PROCESSANDO") {
                        pararAcompanhamento();
                        // Só quem emitiu anuncia no chat (a tela do comprador também acompanha)
                        contexto.aoAtualizar(nota, contexto.papel === "fornecedor" ? mensagemDoResultado(nota) : null);
                    }
                } catch (erro) {
                    console.warn("[SERF:NF-e] Consulta:", erro.message || erro);
                }
                if (tentativas >= 24) pararAcompanhamento();
            }, 5000)
        };
    }

    function pararAcompanhamento() {
        clearInterval(acompanhamento?.timer);
        acompanhamento = null;
    }

    function mensagemDoResultado(nota) {
        return nota?.status === "AUTORIZADA" ? `🧾 NF-e nº ${numeroFormatado(nota)} autorizada pela SEFAZ.` : null;
    }

    async function emitirReal(contexto, botao) {
        const ok = await Swal.fire({
            ...swalConfig,
            title: "Emitir NF-e na SEFAZ?",
            html: "A nota terá <strong>valor fiscal</strong>. Confira os dados do pedido antes.",
            icon: "question",
            showCancelButton: true,
            confirmButtonText: "Emitir",
            cancelButtonText: "Voltar"
        });
        if (!ok.isConfirmed) return;

        return comFeedback(botao, "Enviando à SEFAZ...", async () => {
            const resposta = await nfeReal("emitir", contexto.pedidoId);
            const nota = resposta.nota || await buscar(contexto.pedidoId);
            contexto.aoAtualizar(nota, mensagemDoResultado(nota));

            if (nota?.status === "REJEITADA") {
                Swal.fire({ ...swalConfig, title: "NF-e rejeitada", text: nota.mensagem_sefaz || "A SEFAZ recusou a nota.", icon: "error" });
            } else if (nota?.status === "AUTORIZADA") {
                Swal.fire({ ...swalConfig, title: "NF-e autorizada", html: `Nº <strong>${numeroFormatado(nota)}</strong> · série ${nota.serie}`, icon: "success" });
            }
        });
    }

    async function executarAcao(acao, contexto, botao) {
        if (acao === "danfe") return abrirDanfe(contexto.nota);

        if (acao === "consultar") {
            return comFeedback(botao, "Consultando...", async () => {
                const { nota } = await nfeReal("consultar", contexto.pedidoId);
                if (nota) contexto.aoAtualizar(nota, contexto.papel === "fornecedor" ? mensagemDoResultado(nota) : null);
            });
        }

        if (acao === "emitir" && await modoNfe() === "REAL") return emitirReal(contexto, botao);

        if (acao === "emitir") {
            const ok = await Swal.fire({
                ...swalConfig,
                title: "Emitir NF-e?",
                html: "A nota será <strong>autorizada</strong> e liberará o envio da mercadoria.<br><small>Documento simulado, sem valor fiscal.</small>",
                icon: "question",
                showCancelButton: true,
                confirmButtonText: "Emitir",
                cancelButtonText: "Cancelar"
            });
            if (!ok.isConfirmed) return;

            return comFeedback(botao, "Transmitindo...", async () => {
                await new Promise(resolver => setTimeout(resolver, 1100)); // simula a SEFAZ
                const nota = await emitir(contexto.pedidoId);
                contexto.aoAtualizar(nota, `🧾 NF-e nº ${numeroFormatado(nota)} emitida (simulada). Disponível em "Ver DANFE".`);

                Swal.fire({
                    ...swalConfig,
                    title: "NF-e autorizada",
                    html: `Nº <strong>${numeroFormatado(nota)}</strong> · série ${nota.serie}<br><small>Protocolo ${escaparHTML(nota.protocolo)}</small>`,
                    icon: "success",
                    showCancelButton: true,
                    confirmButtonText: "Ver DANFE",
                    cancelButtonText: "Fechar"
                }).then(r => { if (r.isConfirmed) abrirDanfe(nota); });
            });
        }

        if (acao === "cancelar") {
            const { value: motivo, isConfirmed } = await Swal.fire({
                ...swalConfig,
                title: "Cancelar NF-e",
                input: "textarea",
                inputLabel: "Justificativa (mínimo 15 caracteres)",
                inputPlaceholder: "Ex.: Erro na quantidade informada no pedido",
                inputAttributes: { maxlength: 255 },
                inputValidator: valor => (!valor || valor.trim().length < 15)
                    ? "A justificativa precisa ter pelo menos 15 caracteres."
                    : undefined,
                showCancelButton: true,
                confirmButtonText: "Cancelar nota",
                cancelButtonText: "Voltar",
                confirmButtonColor: "#DC2626"
            });
            if (!isConfirmed) return;

            return comFeedback(botao, "Cancelando...", async () => {
                const nota = real(contexto.nota)
                    ? (await nfeReal("cancelar", contexto.pedidoId, { justificativa: motivo.trim() })).nota
                    : await cancelar(contexto.pedidoId, motivo.trim());
                contexto.aoAtualizar(nota, `🧾 NF-e nº ${numeroFormatado(nota)} cancelada: ${nota.motivo_cancelamento}`);
            });
        }
    }

    async function comFeedback(botao, textoProcessando, tarefa) {
        const original = botao.textContent;
        botao.disabled = true;
        botao.textContent = textoProcessando;

        try {
            await tarefa();
        } catch (erro) {
            console.error("[SERF:NF-e]", erro);
            Swal.fire({ ...swalConfig, title: "Não foi possível concluir", text: window.SERFUtils.mensagemDeErro(erro), icon: "error" });
        } finally {
            botao.disabled = false;
            botao.textContent = original;
        }
    }


    /* =====================================================================
       3. DANFE (janela própria, pronta para imprimir / salvar em PDF)
       ===================================================================== */

    function abrirDanfe(nota) {
        if (!nota) return;

        const janela = window.open("", "_blank");
        if (!janela) {
            Swal.fire({ ...swalConfig, title: "Janela bloqueada", text: "Permita pop-ups para visualizar o DANFE.", icon: "warning" });
            return;
        }

        const e = escaparHTML;
        const cancelada = nota.status === "CANCELADA";
        const emitente = [nota.emitente_cidade, nota.emitente_uf].filter(Boolean).join(" - ");

        janela.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DANFE ${e(numeroFormatado(nota))} (simulado)</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #e9edf2; padding: 24px 12px; }
  .folha { position: relative; max-width: 800px; margin: 0 auto; background: #fff; padding: 22px; border: 1px solid #c8ced6; overflow: hidden; }
  .marca { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .marca span { transform: rotate(-30deg); font-size: 54px; font-weight: 900; color: rgba(208, 59, 59, 0.13); text-align: center; line-height: 1.15; white-space: nowrap; }
  .tarja { margin-bottom: 12px; padding: 7px 10px; border: 2px solid #d03b3b; color: #b42323; font-size: 11px; font-weight: 700; text-align: center; letter-spacing: 0.04em; }
  .grade { display: grid; border: 1px solid #333; border-bottom: none; }
  .grade + .grade { border-top: none; }
  .c { padding: 5px 7px; border-bottom: 1px solid #333; border-right: 1px solid #333; min-width: 0; }
  .c:last-child { border-right: none; }
  .r { display: block; font-size: 8px; font-weight: 700; color: #444; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px; }
  .v { font-size: 12px; word-break: break-word; }
  .grande { font-size: 15px; font-weight: 700; }
  .titulo { margin: 12px 0 4px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
  .chave { font-family: Consolas, "Courier New", monospace; font-size: 13px; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #333; padding: 5px 6px; text-align: left; }
  th { font-size: 8px; text-transform: uppercase; background: #f2f4f7; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  .cancelada { margin-top: 12px; padding: 10px; border: 2px solid #d03b3b; color: #b42323; font-weight: 700; text-align: center; }
  .acoes { max-width: 800px; margin: 0 auto 12px; display: flex; justify-content: flex-end; gap: 8px; }
  .acoes button { padding: 8px 14px; border: none; border-radius: 5px; background: #082B4C; color: #fff; font-weight: 700; cursor: pointer; }
  .rodape { margin-top: 12px; font-size: 9px; color: #555; text-align: center; }
  @media print {
    body { background: #fff; padding: 0; }
    .acoes { display: none; }
    .folha { border: none; max-width: none; }
    .marca span, .tarja, .cancelada { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="acoes"><button type="button" data-imprimir>Imprimir / Salvar PDF</button></div>
<div class="folha">
  <div class="marca"><span>SEM VALOR FISCAL<br>DOCUMENTO SIMULADO${cancelada ? "<br>CANCELADA" : ""}</span></div>

  <div class="tarja">DOCUMENTO SIMULADO DO PROJETO S.E.R.F. — SEM VALOR FISCAL — NÃO TRANSMITIDO À SEFAZ</div>

  <div class="grade" style="grid-template-columns: 2fr 1fr 1fr;">
    <div class="c"><span class="r">Emitente</span><div class="v grande">${e(nota.emitente_razao_social)}</div>
      <div class="v">CNPJ ${e(formatarCNPJ(nota.emitente_cnpj))}${emitente ? ` · ${e(emitente)}` : ""}</div></div>
    <div class="c"><span class="r">DANFE</span><div class="v grande">Simulado</div><div class="v">Documento auxiliar da NF-e · 1 - Saída</div></div>
    <div class="c"><span class="r">Nº / Série</span><div class="v grande">${e(numeroFormatado(nota))}</div><div class="v">Série ${e(nota.serie)} · Folha 1/1</div></div>
  </div>

  <div class="grade" style="grid-template-columns: 1fr;">
    <div class="c"><span class="r">Chave de acesso</span><div class="v chave">${e(chaveFormatada(nota.chave_acesso))}</div></div>
  </div>

  <div class="grade" style="grid-template-columns: 2fr 1fr 1.4fr;">
    <div class="c"><span class="r">Natureza da operação</span><div class="v">${e(nota.natureza_operacao)}</div></div>
    <div class="c"><span class="r">CFOP</span><div class="v">${e(nota.cfop)}</div></div>
    <div class="c"><span class="r">Protocolo de autorização (simulado)</span><div class="v">${e(nota.protocolo)} · ${e(dataHora(nota.data_emissao))}</div></div>
  </div>

  <div class="titulo">Destinatário</div>
  <div class="grade" style="grid-template-columns: 2fr 1fr 1fr;">
    <div class="c"><span class="r">Nome / Razão social</span><div class="v">${e(nota.destinatario_nome)}</div></div>
    <div class="c"><span class="r">CNPJ</span><div class="v">${e(formatarCNPJ(nota.destinatario_cnpj))}</div></div>
    <div class="c"><span class="r">Data de emissão</span><div class="v">${e(dataHora(nota.data_emissao))}</div></div>
  </div>

  <div class="titulo">Dados do produto</div>
  <table>
    <thead><tr><th>Código</th><th>Descrição</th><th>CFOP</th><th>Un.</th><th class="n">Qtd.</th><th class="n">V. unit.</th><th class="n">V. total</th><th class="n">Alíq. ICMS*</th></tr></thead>
    <tbody><tr>
      <td>${e(nota.produto_codigo)}</td><td>${e(nota.produto_descricao)}</td><td>${e(nota.cfop)}</td><td>UN</td>
      <td class="n">${e(nota.quantidade)}</td><td class="n">${e(formatarMoeda(nota.valor_unitario))}</td>
      <td class="n">${e(formatarMoeda(nota.valor_total))}</td><td class="n">${e(Number(nota.aliquota_icms).toLocaleString("pt-BR"))}%</td>
    </tr></tbody>
  </table>

  <div class="titulo">Cálculo do imposto</div>
  <div class="grade" style="grid-template-columns: repeat(4, 1fr);">
    <div class="c"><span class="r">Base de cálculo ICMS*</span><div class="v">${e(formatarMoeda(nota.valor_total))}</div></div>
    <div class="c"><span class="r">Valor do ICMS*</span><div class="v">${e(formatarMoeda(nota.valor_icms))}</div></div>
    <div class="c"><span class="r">Valor total dos produtos</span><div class="v">${e(formatarMoeda(nota.valor_total))}</div></div>
    <div class="c"><span class="r">Valor total da nota</span><div class="v grande">${e(formatarMoeda(nota.valor_total))}</div></div>
  </div>

  <div class="titulo">Informações adicionais</div>
  <div class="grade" style="grid-template-columns: 1fr;">
    <div class="c"><div class="v">
      Pedido S.E.R.F. nº ${e(nota.id_pedido)}${nota.forma_pagamento ? ` · Pagamento: ${e(nota.forma_pagamento)}` : ""}.<br>
      * Valores de impostos ilustrativos (alíquota fixa de 18%), sem enquadramento tributário real.
    </div></div>
  </div>

  ${cancelada ? `<div class="cancelada">NF-e CANCELADA em ${e(dataHora(nota.data_cancelamento))}: ${e(nota.motivo_cancelamento || "")}</div>` : ""}

  <p class="rodape">Gerado pelo S.E.R.F. (Projeto Aplicado II / ACEx) para fins acadêmicos. Este documento não é uma NF-e e não tem validade jurídica ou fiscal.</p>
</div>
</body>
</html>`);
        janela.document.close();
        // Sem onclick no HTML gerado: a janela herda a CSP (sem script inline)
        janela.document.querySelector("[data-imprimir]")?.addEventListener("click", () => janela.print());
    }


    window.SERFNotas = Object.freeze({ buscar, renderizar, autorizada });
})();
