// Mercado Pago — Pix (API de pagamentos v1). Funções puras: montam o que
// enviar, leem o que volta e conferem a assinatura dos webhooks. A rede
// fica nas Edge Functions pix-criar e pix-webhook.
// Testes: tests/unit/mercadopago.test.mjs.
//
// Referências: POST/GET https://api.mercadopago.com/v1/payments
// Assinatura do webhook: cabeçalho x-signature "ts=...,v1=..." =
//   HMAC-SHA256(segredo, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;")

export const API_MP = "https://api.mercadopago.com/v1/payments";

export interface DadosDoPedido {
    id_pedido: number;
    valor: number | string;
    descricao: string;
    email: string;
    cnpj: string;
    nome: string;
}

// "2026-10-20T15:30:00.000-03:00" (o Mercado Pago pede data com fuso)
export function dataComFuso(data: Date): string {
    const local = new Date(data.getTime() - 3 * 3600000);   // Brasília, sem horário de verão
    return local.toISOString().replace("Z", "-03:00");
}

export function montarCobrancaPix(pedido: DadosDoPedido, { urlWebhook, minutos = 30, agora = new Date() }:
    { urlWebhook: string; minutos?: number; agora?: Date }) {
    return {
        transaction_amount: Number(pedido.valor),
        description: pedido.descricao,
        payment_method_id: "pix",
        external_reference: `serf-pedido-${pedido.id_pedido}`,
        notification_url: urlWebhook,
        date_of_expiration: dataComFuso(new Date(agora.getTime() + minutos * 60000)),
        payer: {
            email: pedido.email,
            first_name: pedido.nome,
            identification: { type: "CNPJ", number: String(pedido.cnpj).replace(/\D/g, "") }
        }
    };
}

// Cliques repetidos no mesmo minuto = a mesma cobrança no provedor
export const chaveDeIdempotencia = (idPedido: number, agora = new Date()) =>
    `serf-pix-${idPedido}-${Math.floor(agora.getTime() / 60000)}`;

export function lerCobranca(resposta: Record<string, any>) {
    const dados = resposta?.point_of_interaction?.transaction_data || {};
    if (!resposta?.id || !dados.qr_code) throw new Error("Resposta do Mercado Pago sem QR Code Pix.");
    return {
        id: String(resposta.id),
        codigo: String(dados.qr_code),
        qrBase64: dados.qr_code_base64 ? String(dados.qr_code_base64) : null,
        expiraEm: String(resposta.date_of_expiration),
        valor: Number(resposta.transaction_amount)
    };
}

export function lerPagamento(resposta: Record<string, any>) {
    return {
        id: String(resposta.id),
        status: String(resposta.status),             // approved | pending | in_process | rejected | cancelled | expired ...
        valor: Number(resposta.transaction_amount),
        referencia: String(resposta.external_reference || "")
    };
}

const codificador = new TextEncoder();

async function hmacHex(segredo: string, texto: string): Promise<string> {
    const chave = await crypto.subtle.importKey("raw", codificador.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", chave, codificador.encode(texto)));
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function iguais(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diferenca = 0;
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diferenca === 0;
}

export async function assinaturaValida({ assinatura, idRequisicao, idDado, segredo }:
    { assinatura: string | null; idRequisicao: string | null; idDado: string; segredo: string }): Promise<boolean> {
    if (!assinatura || !segredo || !idDado) return false;

    const partes = Object.fromEntries(assinatura.split(",").map(parte => {
        const [chave, ...valor] = parte.trim().split("=");
        return [chave, valor.join("=")];
    }));
    if (!partes.ts || !partes.v1) return false;

    // Id alfanumérico vai em minúsculas no manifesto (regra do Mercado Pago)
    const id = /^[0-9]+$/.test(idDado) ? idDado : idDado.toLowerCase();
    const manifesto = `id:${id};${idRequisicao ? `request-id:${idRequisicao};` : ""}ts:${partes.ts};`;
    return iguais(await hmacHex(segredo, manifesto), partes.v1);
}
