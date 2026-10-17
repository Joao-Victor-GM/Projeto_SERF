/* ==========================================================
   S.E.R.F. — HOME / CHAT.JS
   Chat B2B do pedido: histórico, envio, Realtime e plano B
   (seção 20, primeira parte).

   A Home é dividida em scripts clássicos que compartilham o escopo
   global, carregados nesta ordem (todos com defer):
     estado.js → dashboard.js → eventos.js → chat.js →
     pedido-modal.js → tempo-real.js → inicializacao.js
   Só inicializacao.js executa algo ao carregar (iniciarHome()).
   ========================================================== */

"use strict";


/* ==========================================================
   20 — CHAT B2B DO PEDIDO (tabela mensagens_pedidos)
   Histórico via select(), envio via insert() e novas
   mensagens em tempo real via Supabase Realtime.
   Só fica ativo enquanto o modal do pedido está aberto.
   ========================================================== */

const chat = {
    pedido: null,           // Pedido com o modal aberto
    canal: null,            // Canal Realtime do pedido
    sincronizacao: null,    // Intervalo de conferência (plano B do Realtime)
    realtimeAtivo: false,   // Canal do pedido em SUBSCRIBED
    ciclos: 0,              // Contador de execuções do plano B
    mensagens: new Map()    // id → mensagem (evita duplicar insert + realtime)
};

// Com o chat aberto, confere mensagens novas periodicamente. Garante a
// entrega mesmo se o Realtime cair ou for bloqueado (rede, RLS, token).
const INTERVALO_SINCRONIZACAO_CHAT = 4000;

// Com o Realtime ativo, o plano B só confere a cada N ciclos (4 s × 5 = 20 s).
const CICLOS_SINCRONIZACAO_COM_REALTIME = 5;

// Data da mensagem mais recente já exibida (base da busca incremental).
function ultimaDataDoChat() {
    let ultima = null;

    chat.mensagens.forEach(mensagem => {
        const data = new Date(mensagem.data_envio);
        if (!Number.isNaN(data.getTime()) && (!ultima || data > ultima)) ultima = data;
    });

    return ultima ? ultima.toISOString() : null;
}

async function sincronizarMensagensChat(idPedido) {

    if (chat.pedido?.id !== idPedido || document.hidden) return;

    chat.ciclos += 1;
    if (chat.realtimeAtivo && chat.ciclos % CICLOS_SINCRONIZACAO_COM_REALTIME !== 0) return;

    try {
        // Busca só o que chegou depois da última mensagem exibida.
        const historico = await buscarMensagensPedido(idPedido, ultimaDataDoChat());

        if (chat.pedido?.id !== idPedido) return;

        const novas = historico.filter(mensagem => !chat.mensagens.has(mensagem.id));

        if (novas.length === 0) return;

        adicionarMensagens(novas);

        // Mensagens recebidas pelo plano B também atualizam conversas e leitura.
        novas.forEach(registrarMensagemNaConversa);

        if (novas.some(mensagem => mensagem.id_remetente !== empresaLogada.authUserId)) {
            marcarMensagensComoLidas(idPedido);
        }

        renderizarConversas();
        atualizarIndicadores();
    } catch (erro) {
        console.warn("[SERF:Chat] Falha na sincronização das mensagens:", erro);
    }
}

// 1) Histórico de mensagens do pedido
// desde: só mensagens a partir dessa data (inclusive; o Map descarta repetidas).
function buscarMensagensPedido(idPedido, desde = null) {
    return SERFDados.mensagens.listarDoPedido(idPedido, desde);
}

// 2) Envio de uma nova mensagem
async function enviarMensagemPedido(idPedido, texto) {

    if (!empresaLogada.authUserId) {
        throw new Error("Faça login para enviar mensagens.");
    }

    return SERFDados.mensagens.enviar(idPedido, empresaLogada.authUserId, texto);
}

// 3) Tempo real: novas mensagens do pedido aparecem sem recarregar
function assinarChatTempoReal(idPedido) {

    atualizarStatusChat("Conectando...", "");

    return SERFDados.mensagens.assinarDoPedido(
        idPedido,
        payload => {
            // Ignora eventos que chegarem após trocar ou fechar o pedido.
            if (chat.pedido?.id !== idPedido) return;

            adicionarMensagens([payload.new]);
        },
        status => {
            if (chat.pedido?.id !== idPedido) return;

            if (status === "SUBSCRIBED") {
                chat.realtimeAtivo = true;
                atualizarStatusChat("Tempo real ativo", "online");
            } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
                chat.realtimeAtivo = false;
                atualizarStatusChat("Tempo real indisponível", "offline");
            }
        }
    );
}

function atualizarStatusChat(texto, classe) {
    elementos.chatStatus.textContent = texto;
    elementos.chatStatus.className = `chat-status ${classe}`.trim();
}

// Formata "AAAA-MM-DDTHH:MM..." como "16/10 14:32".
function formatarHorarioMensagem(timestamp) {
    const data = new Date(timestamp);

    if (Number.isNaN(data.getTime())) return "";

    return data.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

// Instante da mensagem em ms (ordenação e anexação incremental)
const instanteDaMensagem = mensagem => Date.parse(mensagem.data_envio) || 0;

function htmlDaMensagem(mensagem, nomeParceiro) {

    const minha =
        empresaLogada.authUserId !== null &&
        mensagem.id_remetente === empresaLogada.authUserId;

    return `
            <div class="chat-balao ${minha ? "enviada" : "recebida"}">
                <span class="chat-autor">
                    ${minha ? "Você" : escaparHTML(nomeParceiro)}
                </span>
                <p>${escaparHTML(mensagem.texto)}</p>
                <small>${formatarHorarioMensagem(mensagem.data_envio)}</small>
            </div>
        `;
}

// Guarda as mensagens (sem repetir) e atualiza a conversa.
// Caso comum (mensagem nova chegando no fim): só ANEXA os balões novos.
// Antes, cada mensagem reordenava e redesenhava o histórico inteiro
// (custo quadrático: 300 mensagens levavam segundos).
function adicionarMensagens(lista) {

    const novas = lista.filter(mensagem => !chat.mensagens.has(mensagem.id));
    lista.forEach(mensagem => chat.mensagens.set(mensagem.id, mensagem));

    if (novas.length === 0) return;

    const container = elementos.chatMensagens;
    const desenhadas = Number(container.dataset.desenhadas ?? -1);
    const ultima = Number(container.dataset.ultima ?? Infinity);

    novas.sort((a, b) => instanteDaMensagem(a) - instanteDaMensagem(b));

    // Só anexa se a tela mostra exatamente as mensagens anteriores
    // e as novas vêm depois da última exibida; senão, redesenha tudo.
    const podeAnexar =
        desenhadas > 0 &&
        desenhadas === chat.mensagens.size - novas.length &&
        instanteDaMensagem(novas[0]) >= ultima;

    if (!podeAnexar) {
        renderizarMensagens();
        return;
    }

    const parceiro = parceiroDoPedido(chat.pedido);
    container.insertAdjacentHTML("beforeend", novas.map(m => htmlDaMensagem(m, parceiro.nome)).join(""));

    container.dataset.desenhadas = String(chat.mensagens.size);
    container.dataset.ultima = String(instanteDaMensagem(novas[novas.length - 1]));

    // Mantém a conversa rolada até a mensagem mais recente.
    container.scrollTop = container.scrollHeight;
}

function renderizarMensagens() {

    const container = elementos.chatMensagens;
    const mensagens = [...chat.mensagens.values()].sort(
        (a, b) => instanteDaMensagem(a) - instanteDaMensagem(b)
    );

    container.dataset.desenhadas = String(mensagens.length);
    container.dataset.ultima = String(mensagens.length ? instanteDaMensagem(mensagens[mensagens.length - 1]) : 0);

    if (mensagens.length === 0) {
        container.innerHTML = `
            <p class="chat-vazio">
                Nenhuma mensagem ainda. Envie a primeira para iniciar a negociação.
            </p>
        `;

        return;
    }

    const parceiro = parceiroDoPedido(chat.pedido);

    container.innerHTML = mensagens.map(mensagem => htmlDaMensagem(mensagem, parceiro.nome)).join("");

    // Mantém a conversa rolada até a mensagem mais recente.
    container.scrollTop = container.scrollHeight;
}
