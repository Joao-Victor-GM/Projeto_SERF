/* ==========================================================
   S.E.R.F. — HOME / PEDIDO-MODAL.JS
   Modal do pedido: resumo, gestão de status, cancelamento,
   pagamento e NF-e (seção 20, segunda parte).

   A Home é um conjunto de MÓDULOS ES (sem build): cada arquivo importa
   o que usa dos outros e exporta o que oferece. A entrada é
   inicializacao.js (<script type="module"> na home.html), a única que
   executa algo ao carregar (iniciarHome()). O que outros scripts da
   página usam fica em window.SERFHome.
   ========================================================== */

import {
    STATUS_BANCO,
    TRANSICOES_STATUS,
    aplicarStatusPedido,
    atualizarStatusPedido,
    elementos,
    escaparHTML,
    estado,
    formatarData,
    formatarMoeda,
    parceiroDoPedido,
    souCompradorDoPedido,
    souFornecedorDoPedido
} from "./estado.js";
import { atualizarDashboard, marcarMensagensComoLidas } from "./dashboard.js";
import {
    INTERVALO_SINCRONIZACAO_CHAT,
    adicionarMensagens,
    assinarChatTempoReal,
    buscarMensagensPedido,
    chat,
    enviarMensagemPedido,
    sincronizarMensagensChat
} from "./chat.js";


// Preenche o resumo do pedido no topo do modal.
export function renderizarResumoPedido(pedido) {

    const parceiro = parceiroDoPedido(pedido);
    const papel = estado.modo === "comprar" ? "Fornecedor" : "Comprador";

    const campos = [
        [papel, parceiro.nome],
        ["Produto", pedido.produto],
        ["Status", pedido.statusRotulo],
        ["Quantidade", `${pedido.quantidade} un.`],
        ["Valor unitário", formatarMoeda(pedido.valorUnitario)],
        ["Valor total", formatarMoeda(pedido.valorTotal)]
    ];

    elementos.pedidoResumo.innerHTML = campos.map(([rotulo, valor]) => `
        <div>
            <dt>${rotulo}</dt>
            <dd title="${escaparHTML(valor)}">${escaparHTML(valor)}</dd>
        </div>
    `).join("") + (pedido.observacao ? `
        <div class="pedido-resumo-obs">
            <dt>Observação</dt>
            <dd>${escaparHTML(pedido.observacao)}</dd>
        </div>
    ` : "") + (pedido.motivoCancelamento ? `
        <div class="pedido-resumo-obs">
            <dt>Motivo do cancelamento</dt>
            <dd>${escaparHTML(pedido.motivoCancelamento)}</dd>
        </div>
    ` : "");
}

// Mostra o seletor de status apenas ao fornecedor do produto,
// com os próximos status permitidos a partir do atual.
export function renderizarGestaoStatus(pedido) {

    // Toda mudança no pedido passa por aqui: atualiza também o cancelamento.
    renderizarCancelamento(pedido);

    const form = elementos.formStatusPedido;

    if (!souFornecedorDoPedido(pedido)) {
        form.hidden = true;
        return;
    }

    form.hidden = false;

    const proximos = TRANSICOES_STATUS[pedido.statusBanco] || [];

    if (proximos.length === 0) {
        elementos.selectNovoStatus.innerHTML =
            `<option value="">${escaparHTML(pedido.statusRotulo)}</option>`;
        elementos.selectNovoStatus.disabled = true;
        elementos.btnAtualizarStatus.disabled = true;
        elementos.statusPedidoAjuda.textContent =
            "Pedido finalizado: o status não pode mais ser alterado.";
        return;
    }

    // "Enviado" exige pagamento (ou prazo aprovado) E NF-e autorizada — o banco
    // também exige. undefined = ainda não carregado / tabela indisponível → não trava.
    let motivoBloqueio = null;

    if (pedido.pagamento !== undefined && window.SERFPagamentos &&
        !window.SERFPagamentos.liberaEnvio(pedido.pagamento)) {
        motivoBloqueio = "aguardando pagamento";
    } else if (pedido.nota !== undefined && window.SERFNotas &&
        !window.SERFNotas.autorizada(pedido.nota)) {
        motivoBloqueio = "emita a NF-e";
    }

    const envioBloqueado = motivoBloqueio !== null;

    elementos.selectNovoStatus.innerHTML = proximos.map(codigo => {
        const bloqueado = codigo === "ENVIADO" && envioBloqueado;
        const rotulo = STATUS_BANCO[codigo]?.rotulo || codigo;

        return `
            <option value="${codigo}" ${bloqueado ? "disabled" : ""}>
                ${escaparHTML(bloqueado ? `${rotulo} (${motivoBloqueio})` : rotulo)}
            </option>
        `;
    }).join("");

    // Seleciona a primeira opção disponível
    const primeiraLivre = [...elementos.selectNovoStatus.options].find(opcao => !opcao.disabled);

    elementos.selectNovoStatus.value = primeiraLivre ? primeiraLivre.value : "";
    elementos.selectNovoStatus.disabled = !primeiraLivre;
    elementos.btnAtualizarStatus.disabled = !primeiraLivre;
    elementos.statusPedidoAjuda.textContent = envioBloqueado && proximos.includes("ENVIADO")
        ? `Status atual: ${pedido.statusRotulo}. ${motivoBloqueio === "aguardando pagamento"
            ? "O envio é liberado após o pagamento do comprador."
            : "Emita a nota fiscal para liberar o envio."}`
        : `Status atual: ${pedido.statusRotulo}. O comprador é avisado pelo chat.`;
}

/* ---------- Cancelamento pelo comprador (migration 013) ---------- */

// Espelho da regra de cancelar_pedido_comprador(); o banco decide.
// undefined = pagamento/nota ainda não carregados → não bloqueia aqui.
function situacaoCancelamento(pedido) {

    if (!souCompradorDoPedido(pedido)) return null;

    if (pedido.statusBanco === "PENDENTE") {
        return { permitido: true, ajuda: "O fornecedor ainda não respondeu: você pode cancelar sem custo." };
    }

    if (!["CONFIRMADO", "EM_SEPARACAO"].includes(pedido.statusBanco)) return null;

    if (pedido.pagamento?.status === "PAGO") {
        return { permitido: false, ajuda: "Pedido já pago: peça o cancelamento ao fornecedor pelo chat." };
    }

    if (pedido.nota !== undefined && window.SERFNotas?.autorizada(pedido.nota)) {
        return { permitido: false, ajuda: "A NF-e já foi emitida: peça o cancelamento ao fornecedor pelo chat." };
    }

    return { permitido: true, ajuda: "O fornecedor já confirmou: informe o motivo do cancelamento." };
}

function renderizarCancelamento(pedido) {

    const situacao = situacaoCancelamento(pedido);

    elementos.pedidoCancelamento.hidden = !situacao;
    if (!situacao) return;

    elementos.cancelamentoAjuda.textContent = situacao.ajuda;
    elementos.btnCancelarPedido.disabled = !situacao.permitido;
}

// Pergunta o motivo. Retorna o texto ("" se opcional e vazio) ou null se desistiu.
async function pedirMotivoCancelamento(pedido, exigeMotivo) {

    const titulo = `Cancelar o pedido #${pedido.id}?`;
    const texto = exigeMotivo
        ? "O fornecedor já confirmou este pedido. Explique o motivo (mínimo de 10 caracteres)."
        : "Esta ação não pode ser desfeita. Se quiser, conte o motivo ao fornecedor.";

    if (typeof Swal === "undefined") {
        const resposta = window.prompt(`${titulo}\n\n${texto}`, "");
        if (resposta === null) return null;
        return resposta.trim();
    }

    const resultado = await Swal.fire({
        ...(window.SERFUtils.swalConfig || {}),
        title: titulo,
        text: texto,
        icon: "warning",
        input: "textarea",
        inputPlaceholder: exigeMotivo ? "Motivo do cancelamento" : "Motivo (opcional)",
        inputAttributes: { maxlength: "300" },
        showCancelButton: true,
        confirmButtonText: "Cancelar pedido",
        cancelButtonText: "Voltar",
        confirmButtonColor: "#EF4444",
        inputValidator: valor => {
            if (exigeMotivo && (valor || "").trim().length < 10) {
                return "Informe o motivo (mínimo de 10 caracteres).";
            }
            return undefined;
        }
    });

    return resultado.isConfirmed ? (resultado.value || "").trim() : null;
}

async function cancelarPedidoComoComprador() {

    const pedido = chat.pedido;
    const situacao = pedido ? situacaoCancelamento(pedido) : null;

    if (!situacao?.permitido) return;

    const motivo = await pedirMotivoCancelamento(pedido, pedido.statusBanco !== "PENDENTE");
    if (motivo === null) return;

    const botao = elementos.btnCancelarPedido;
    botao.disabled = true;
    botao.textContent = "Cancelando...";

    try {
        const registro = await SERFDados.pedidos.cancelarComoComprador(pedido.id, motivo);

        aplicarStatusPedido(pedido, registro);

        renderizarResumoPedido(pedido);
        renderizarGestaoStatus(pedido);
        carregarPagamento(pedido);
        carregarNota(pedido);
        atualizarDashboard();

        // Avisa o fornecedor pelo chat (chega em tempo real).
        const aviso = `❌ Pedido cancelado pelo comprador.${motivo ? ` Motivo: ${motivo}` : ""}`;
        enviarMensagemPedido(pedido.id, aviso)
            .then(mensagem => {
                if (chat.pedido?.id === pedido.id) adicionarMensagens([mensagem]);
            })
            .catch(erro => console.warn("[SERF:Chat] Aviso de cancelamento não enviado:", erro));
    } catch (erro) {
        console.error("[SERF:Home] Falha ao cancelar pedido:", erro);
        SERFAvisos.erro("Não foi possível cancelar o pedido", erro);
        renderizarGestaoStatus(pedido);
    } finally {
        botao.textContent = "Cancelar pedido";
    }
}

/* ---------- Nota fiscal do pedido (notas.js) ---------- */

async function carregarNota(pedido) {
    if (!window.SERFNotas) return;

    try {
        pedido.nota = await window.SERFNotas.buscar(pedido.id);
    } catch (erro) {
        // Sem a migration 010 a tabela não existe: o modal segue sem a seção.
        console.warn("[SERF:NF-e] Nota fiscal indisponível:", erro.message);
        pedido.nota = undefined;
        elementos.pedidoNota.hidden = true;
        return;
    }

    if (chat.pedido?.id !== pedido.id) return;

    renderizarNota(pedido);
    renderizarGestaoStatus(pedido);
}

export function renderizarNota(pedido) {
    if (!window.SERFNotas || pedido.nota === undefined) return;

    window.SERFNotas.renderizar(elementos.pedidoNota, {
        pedidoId: pedido.id,
        statusPedido: pedido.statusBanco,
        papel: souFornecedorDoPedido(pedido) && estado.modo === "vender" ? "fornecedor" : "comprador",
        nota: pedido.nota,
        pagamentoLiberado: Boolean(window.SERFPagamentos?.liberaEnvio(pedido.pagamento)),

        aoAtualizar: (nota, mensagemChat) => {
            pedido.nota = nota;

            if (chat.pedido?.id === pedido.id) {
                renderizarNota(pedido);
                renderizarGestaoStatus(pedido);
            }

            if (mensagemChat) {
                enviarMensagemPedido(pedido.id, mensagemChat)
                    .then(mensagem => {
                        if (chat.pedido?.id === pedido.id) adicionarMensagens([mensagem]);
                    })
                    .catch(erro => console.warn("[SERF:Chat] Aviso de NF-e não enviado:", erro));
            }
        }
    });
}

/* ---------- Pagamento do pedido (pagamentos.js) ---------- */

async function carregarPagamento(pedido) {
    if (!window.SERFPagamentos) return;

    try {
        pedido.pagamento = await window.SERFPagamentos.buscar(pedido.id);
    } catch (erro) {
        // Sem a migration 009 a tabela não existe: o modal segue funcionando sem a seção.
        console.warn("[SERF:Pagamentos] Pagamento indisponível:", erro.message);
        pedido.pagamento = undefined;
        elementos.pedidoPagamento.hidden = true;
        return;
    }

    if (chat.pedido?.id !== pedido.id) return;

    renderizarPagamento(pedido);
    renderizarGestaoStatus(pedido);
    renderizarNota(pedido);
}

export function renderizarPagamento(pedido) {
    if (!window.SERFPagamentos || pedido.pagamento === undefined) return;

    window.SERFPagamentos.renderizar(elementos.pedidoPagamento, {
        pedidoId: pedido.id,
        statusPedido: pedido.statusBanco,
        valorTotal: pedido.valorTotal,
        produto: pedido.produto,
        parceiroNome: parceiroDoPedido(pedido).nome,
        papel: souFornecedorDoPedido(pedido) && estado.modo === "vender" ? "fornecedor" : "comprador",
        pagamento: pedido.pagamento,

        // Chamado após gerar/pagar/aprovar: atualiza a tela e avisa no chat
        aoAtualizar: (pagamento, mensagemChat) => {
            pedido.pagamento = pagamento;

            if (chat.pedido?.id === pedido.id) {
                renderizarPagamento(pedido);
                renderizarGestaoStatus(pedido);
                renderizarNota(pedido);
            }

            if (mensagemChat) {
                enviarMensagemPedido(pedido.id, mensagemChat)
                    .then(mensagem => {
                        if (chat.pedido?.id === pedido.id) adicionarMensagens([mensagem]);
                    })
                    .catch(erro => console.warn("[SERF:Chat] Aviso de pagamento não enviado:", erro));
            }
        }
    });
}

async function enviarAtualizacaoStatus(evento) {

    evento.preventDefault();

    const pedido = chat.pedido;
    const novoStatus = elementos.selectNovoStatus.value;

    if (!pedido || !novoStatus) return;

    const rotulo = STATUS_BANCO[novoStatus]?.rotulo || novoStatus;

    if (
        novoStatus === "CANCELADO" &&
        !(await SERFAvisos.confirmar({
            titulo: `Cancelar o pedido #${pedido.id}?`,
            texto: "Esta ação não pode ser desfeita. O comprador é avisado pelo chat.",
            botao: "Cancelar pedido",
            perigo: true
        }))
    ) {
        return;
    }

    elementos.btnAtualizarStatus.disabled = true;
    elementos.btnAtualizarStatus.textContent = "Salvando...";

    try {
        const atualizado = await atualizarStatusPedido(pedido.id, novoStatus);

        aplicarStatusPedido(pedido, atualizado);

        renderizarResumoPedido(pedido);
        renderizarGestaoStatus(pedido);
        carregarPagamento(pedido);
        carregarNota(pedido);
        atualizarDashboard();

        // Registra a mudança no chat: o comprador recebe em tempo real.
        enviarMensagemPedido(pedido.id, `📦 Status do pedido atualizado para: ${rotulo}.`)
            .then(mensagem => {
                if (chat.pedido?.id === pedido.id) {
                    adicionarMensagens([mensagem]);
                }
            })
            .catch(erro => console.warn("[SERF:Chat] Aviso de status não enviado:", erro));
    } catch (erro) {
        console.error("[SERF:Home] Falha ao atualizar status:", erro);
        SERFAvisos.erro("Não foi possível atualizar o status", erro);
        renderizarGestaoStatus(pedido);
    } finally {
        elementos.btnAtualizarStatus.textContent = "Atualizar";
    }
}

export async function abrirDetalhesPedido(pedido) {

    // Encerra o canal de um pedido aberto anteriormente.
    fecharCanalChat();

    chat.pedido = pedido;
    chat.mensagens = new Map();

    const parceiro = parceiroDoPedido(pedido);

    elementos.modalPedidoTitulo.textContent = `Pedido #${pedido.id}`;
    elementos.modalPedidoSubtitulo.textContent = `Realizado em ${formatarData(pedido.criadoEm)}`;
    elementos.chatParceiroNome.textContent = parceiro.nome;
    elementos.chatMensagens.innerHTML = `<p class="chat-vazio">Carregando mensagens...</p>`;
    delete elementos.chatMensagens.dataset.desenhadas;   // nova conversa: redesenho completo
    elementos.chatInput.value = "";

    renderizarResumoPedido(pedido);
    renderizarGestaoStatus(pedido);

    // Pagamento: carrega em paralelo (a seção aparece quando chegar)
    elementos.pedidoPagamento.hidden = true;
    carregarPagamento(pedido);
    elementos.pedidoNota.hidden = true;
    carregarNota(pedido);

    elementos.modalPedido.style.display = "flex";
    elementos.chatInput.focus();

    // Assina antes de buscar o histórico para não perder mensagens
    // enviadas nesse intervalo; o Map descarta repetidas.
    chat.canal = assinarChatTempoReal(pedido.id);

    try {
        const historico = await buscarMensagensPedido(pedido.id);

        if (chat.pedido?.id !== pedido.id) return;

        adicionarMensagens(historico);

        // Abrir o chat confirma a leitura das mensagens recebidas.
        marcarMensagensComoLidas(pedido.id);

        chat.sincronizacao = setInterval(
            () => sincronizarMensagensChat(pedido.id),
            INTERVALO_SINCRONIZACAO_CHAT
        );
    } catch (erro) {
        console.error("[SERF:Chat] Falha ao buscar mensagens:", erro);

        if (chat.pedido?.id !== pedido.id) return;

        elementos.chatMensagens.innerHTML = `
            <p class="chat-vazio" style="color:#DC2626;">
                Não foi possível carregar as mensagens.<br>
                <small>${escaparHTML(erro.message || "Erro de comunicação com o Supabase")}</small>
            </p>
        `;
    }
}

function fecharCanalChat() {
    if (chat.canal) {
        SERFDados.base.cancelarAssinatura(chat.canal);
        chat.canal = null;
    }

    clearInterval(chat.sincronizacao);
    chat.sincronizacao = null;
    chat.realtimeAtivo = false;
    chat.ciclos = 0;
}

function fecharDetalhesPedido() {
    fecharCanalChat();

    chat.pedido = null;
    chat.mensagens = new Map();

    elementos.modalPedido.style.display = "none";
}

export function configurarChat() {

    elementos.btnFecharModalPedido.addEventListener("click", fecharDetalhesPedido);
    elementos.formStatusPedido.addEventListener("submit", enviarAtualizacaoStatus);
    elementos.btnCancelarPedido.addEventListener("click", cancelarPedidoComoComprador);

    // Fecha ao clicar fora da janela ou pressionar Esc.
    elementos.modalPedido.addEventListener("click", evento => {
        if (evento.target === elementos.modalPedido) {
            fecharDetalhesPedido();
        }
    });

    document.addEventListener("keydown", evento => {
        if (evento.key === "Escape" && chat.pedido) {
            fecharDetalhesPedido();
        }
    });

    elementos.formChat.addEventListener("submit", async evento => {

        evento.preventDefault();

        const texto = elementos.chatInput.value.trim();
        const pedido = chat.pedido;

        if (!texto || !pedido) return;

        elementos.btnEnviarMensagem.disabled = true;

        try {
            const mensagem = await enviarMensagemPedido(pedido.id, texto);

            elementos.chatInput.value = "";

            if (chat.pedido?.id === pedido.id) {
                adicionarMensagens([mensagem]);
            }
        } catch (erro) {
            console.error("[SERF:Chat] Falha ao enviar mensagem:", erro);
            SERFAvisos.erro("Não foi possível enviar a mensagem", erro);
        } finally {
            elementos.btnEnviarMensagem.disabled = false;
            elementos.chatInput.focus();
        }
    });
}
