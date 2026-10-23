// Textos dos e-mails do S.E.R.F.: funções puras (sem rede).
// Testadas em tests/unit/modelos-email.test.mjs (Node remove os tipos).

export interface Email {
    assunto: string;
    texto: string;
    html: string;
}

interface Item {
    id_pedido: number;
    produto: string;
    quantidade: number;
    valor_total: number;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapar = (valor: unknown): string => String(valor ?? "").replace(/[&<>"']/g, c => ESCAPES[c]);

const moeda = (valor: unknown): string =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor) || 0);

const STATUS: Record<string, string> = {
    CONFIRMADO: "foi confirmado pelo fornecedor. O pagamento já está liberado.",
    ENVIADO: "foi enviado. Confirme o recebimento quando a mercadoria chegar.",
    ENTREGUE: "foi entregue.",
    CANCELADO: "foi cancelado pelo fornecedor."
};

const METODOS: Record<string, string> = { PIX: "Pix", BOLETO: "boleto", CARTAO: "cartão", PRAZO: "a prazo" };

interface Conteudo {
    assunto: string;
    titulo: string;
    paragrafos: string[];      // texto simples (escapado na versão HTML)
    acao: string;
    caminho: string;           // página do app (ex.: "home.html?pedido=12")
    rodape?: string;           // quando quem recebe não é usuário do S.E.R.F.
}

function conteudo(tipo: string, d: Record<string, any>): Conteudo {
    const pedido = d.id_pedido ? `pedido #${d.id_pedido}` : "pedido";
    const linkPedido = `home.html?pedido=${d.id_pedido}`;

    switch (tipo) {
        case "PEDIDO_RECEBIDO": {
            const itens: Item[] = d.itens || [];
            const total = itens.reduce((soma, item) => soma + (Number(item.valor_total) || 0), 0);
            return {
                assunto: itens.length > 1
                    ? `${itens.length} novos pedidos de ${d.comprador}`
                    : `Novo pedido de ${d.comprador}: ${itens[0]?.produto ?? ""}`,
                titulo: itens.length > 1 ? "Você recebeu novos pedidos" : "Você recebeu um novo pedido",
                paragrafos: [
                    `${d.comprador} pediu:`,
                    ...itens.map(i => `• ${i.quantidade} un. de ${i.produto} (pedido #${i.id_pedido}) — ${moeda(i.valor_total)}`),
                    `Total: ${moeda(total)}.`,
                    ...(d.observacao ? [`Observação do comprador: "${d.observacao}"`] : []),
                    "Responda (confirme ou recuse) para não perder a venda."
                ],
                acao: "Responder pedido",
                caminho: itens.length === 1 ? `home.html?pedido=${itens[0].id_pedido}` : "alertas.html"
            };
        }
        case "STATUS_PEDIDO":
            return {
                assunto: `Seu ${pedido} ${d.status === "CANCELADO" ? "foi cancelado" : "foi atualizado"}`,
                titulo: `Atualização do ${pedido}`,
                paragrafos: [`O ${pedido} (${d.quantidade} un. de ${d.produto}) ${STATUS[d.status] ?? "foi atualizado."}`],
                acao: "Ver pedido",
                caminho: linkPedido
            };
        case "PEDIDO_CANCELADO":
            return {
                assunto: `${d.comprador} cancelou o ${pedido}`,
                titulo: "Pedido cancelado pelo comprador",
                paragrafos: [
                    `${d.comprador} cancelou o ${pedido} (${d.quantidade} un. de ${d.produto}).`,
                    `Motivo: "${d.motivo}"`,
                    "Se o estoque tinha sido reservado, ele já voltou ao produto."
                ],
                acao: "Ver pedido",
                caminho: linkPedido
            };
        case "MENSAGEM_NOVA":
            return {
                assunto: `Nova mensagem de ${d.remetente} no ${pedido}`,
                titulo: `${d.remetente} escreveu`,
                paragrafos: [`"${d.trecho}"`],
                acao: "Responder no chat",
                caminho: linkPedido
            };
        case "PAGAMENTO_CONFIRMADO":
            return {
                assunto: `Pagamento confirmado: ${pedido}`,
                titulo: "Pagamento recebido",
                paragrafos: [
                    `${d.comprador} pagou ${moeda(d.valor)} por ${METODOS[d.metodo] ?? d.metodo} no ${pedido}.`,
                    "Emita a NF-e e envie a mercadoria."
                ],
                acao: "Emitir NF-e",
                caminho: linkPedido
            };
        case "PRAZO_SOLICITADO":
            return {
                assunto: `${d.comprador} pediu pagamento a prazo (${pedido})`,
                titulo: "Pedido de pagamento a prazo",
                paragrafos: [`${d.comprador} quer pagar ${moeda(d.valor)} em ${d.prazo_dias} dias. Aprove ou recuse.`],
                acao: "Analisar prazo",
                caminho: linkPedido
            };
        case "NOVO_PRODUTO_SEGMENTO": {
            const itens: Record<string, any>[] = d.itens || [];
            const primeiro = itens[0] ?? {};
            return {
                assunto: itens.length > 1
                    ? `${itens.length} produtos novos em ${d.categoria}`
                    : `Novo em ${d.categoria}: ${primeiro.produto ?? ""}`,
                titulo: `Novidade no segmento ${d.categoria}`,
                paragrafos: [
                    itens.length > 1
                        ? "Fornecedores cadastraram produtos no segmento que você acompanha:"
                        : "Um fornecedor cadastrou um produto no segmento que você acompanha:",
                    ...itens.map(i => `• ${i.produto} — ${i.fornecedor ?? "fornecedor"} · ${moeda(i.preco)}/un. · mín. ${i.quantidade_minima ?? 1} un.`),
                    "Para mudar os segmentos acompanhados, use o botão Segmentos no Radar de Oportunidades."
                ],
                acao: itens.length > 1 ? "Ver no catálogo" : "Ver produto",
                caminho: "catalogo.html"
            };
        }
        case "COTACAO_NOVA": {
            const itens: Record<string, any>[] = d.itens || [];
            return {
                assunto: itens.length > 1
                    ? `${itens.length} cotações novas em ${d.categoria}`
                    : `Cotação nova em ${d.categoria}: ${itens[0]?.titulo ?? ""}`,
                titulo: "Compradores procurando o que você vende",
                paragrafos: [
                    `Pedidos de cotação no segmento ${d.categoria}:`,
                    ...itens.map(i => `• ${i.comprador} quer ${i.quantidade} ${i.unidade ?? "un."} de ${i.titulo}` +
                        (i.preco_alvo ? ` (preço-alvo ${moeda(i.preco_alvo)})` : "")),
                    "Envie sua proposta antes do prazo: o comprador escolhe entre as recebidas."
                ],
                acao: itens.length > 1 ? "Ver cotações" : "Enviar proposta",
                caminho: itens.length === 1 ? `cotacoes.html?cotacao=${itens[0].id_cotacao}` : "cotacoes.html"
            };
        }
        case "PROPOSTA_RECEBIDA":
            return {
                assunto: `Proposta recebida: ${d.titulo}`,
                titulo: "Você recebeu uma proposta",
                paragrafos: [
                    `${d.fornecedor} ofereceu ${d.produto} por ${moeda(d.preco_unitario)}/un., entrega em ${d.prazo_entrega_dias} dia(s).`,
                    "Compare as propostas e aceite a melhor: ela vira um pedido."
                ],
                acao: "Comparar propostas",
                caminho: `cotacoes.html?cotacao=${d.id_cotacao}`
            };
        case "VERIFICACAO_CNPJ": {
            const cnpj = String(d.cnpj ?? "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
            return {
                assunto: "Código para confirmar o CNPJ da sua empresa no S.E.R.F.",
                titulo: "Confirme que esta empresa é sua",
                paragrafos: [
                    `Alguém (${d.solicitante}) pediu para comprovar que representa ${d.razao_social || "a empresa"} (CNPJ ${cnpj}) no S.E.R.F., uma rede de compras e vendas entre empresas.`,
                    "Este e-mail foi enviado para o contato do CNPJ na Receita Federal. Se o pedido é da sua empresa, repasse o código:",
                    `Código: ${d.codigo}`,
                    "Ele vale por 30 minutos.",
                    "Não reconhece este pedido? Ignore este e-mail: sem o código, nada é vinculado à sua empresa."
                ],
                acao: "Abrir o S.E.R.F.",
                caminho: "perfil.html",
                rodape: "Você recebeu este e-mail por ser o contato deste CNPJ na Receita Federal. Não haverá outros envios sem um novo pedido."
            };
        }
        default:
            return { assunto: "Atualização no S.E.R.F.", titulo: "Você tem uma atualização", paragrafos: [], acao: "Abrir o S.E.R.F.", caminho: "home.html" };
    }
}

const RODAPE = "Você recebe estes avisos porque sua empresa usa o S.E.R.F. Para parar, desative os e-mails no seu Perfil.";
const RODAPE_DESCADASTRO = "Você recebe estes avisos porque sua empresa usa o S.E.R.F.";

// linkDescadastro: página de descadastro em um clique (../_shared/descadastro.ts);
// sem ele (segredo não configurado), o rodapé indica o Perfil.
export function montarEmail(tipo: string, dados: Record<string, any>, urlApp: string, linkDescadastro?: string): Email {
    const c = conteudo(tipo, dados || {});
    const link = `${urlApp.replace(/\/$/, "")}/pages/app/${c.caminho}`;

    const rodapeTexto = c.rodape
        ? c.rodape
        : linkDescadastro ? `${RODAPE_DESCADASTRO} Parar de receber: ${linkDescadastro}` : RODAPE;
    const rodapeHtml = c.rodape
        ? escapar(c.rodape)
        : linkDescadastro
            ? `${escapar(RODAPE_DESCADASTRO)} <a href="${escapar(linkDescadastro)}" style="color:#66788A">Parar de receber estes e-mails</a>`
            : escapar(RODAPE);

    const texto = [c.titulo, "", ...c.paragrafos, "", `${c.acao}: ${link}`, "", rodapeTexto].join("\n");

    const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#F7F9FC;font-family:Arial,Helvetica,sans-serif;color:#172536">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:10px;overflow:hidden">
        <tr><td style="background:#082B4C;color:#FFFFFF;padding:16px 24px;font-weight:bold;letter-spacing:1px">S.E.R.F.</td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px;font-size:20px;color:#082B4C">${escapar(c.titulo)}</h1>
          ${c.paragrafos.map(p => `<p style="margin:0 0 10px;font-size:14px;line-height:1.5">${escapar(p)}</p>`).join("\n          ")}
          <p style="margin:20px 0 0"><a href="${escapar(link)}" style="display:inline-block;background:#F47A20;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${escapar(c.acao)}</a></p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#F8FAFC;color:#66788A;font-size:11px">${rodapeHtml}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    return { assunto: c.assunto, texto, html };
}
