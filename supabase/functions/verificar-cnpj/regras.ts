// verificar-cnpj: envia o código que prova a posse do CNPJ (migration 029).
// Regras sem rede (tests/unit/verificar-cnpj.test.mjs); rede em index.ts.
//
// REAL:          o código vai para o e-mail que a RECEITA tem do CNPJ
//                (BrasilAPI). Quem recebe é a empresa (ou o contador dela),
//                não quem pediu.
// DEMONSTRACAO:  o código volta na resposta e aparece na tela, com aviso.
//                Para apresentações: não manda e-mail a empresas reais.
// O banco guarda só o hash (registrar_codigo_identidade) e confere o
// código digitado (confirmar_identidade), com validade e tentativas.

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export class ErroDeRegra extends Error {}

// "joao.silva@contabil.com.br" → "j***@contabil.com.br"
export function mascararEmail(email: string): string {
    const [usuario, dominio] = String(email || "").split("@");
    if (!usuario || !dominio) return "e-mail cadastrado";
    return `${usuario[0]}***@${dominio}`;
}

// 6 dígitos com distribuição uniforme (descarta o resto que enviesaria)
export function gerarCodigo(aleatorio: (buf: Uint32Array<ArrayBuffer>) => void = b => { crypto.getRandomValues(b); }): string {
    const limite = Math.floor(0xFFFFFFFF / 1_000_000) * 1_000_000;
    const buffer = new Uint32Array(new ArrayBuffer(4));
    do { aleatorio(buffer); } while (buffer[0] >= limite);
    return String(buffer[0] % 1_000_000).padStart(6, "0");
}

// Igual a public.hash_codigo_identidade(codigo, uid) no banco
export async function hashCodigo(codigo: string, uid: string): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codigo + uid)));
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export interface Dependencias {
    modo: () => Promise<"DEMONSTRACAO" | "REAL">;
    usuario: (token: string) => Promise<{ id: string; email: string } | null>;
    identidade: (uid: string) => Promise<{ cnpj: string; verificada_em: string | null } | null>;
    // Receita: e-mail e razão social do CNPJ; null = consulta indisponível
    receita: (cnpj: string) => Promise<{ email: string | null; razao_social: string } | null>;
    registrar: (uid: string, hash: string, emailMascarado: string) => Promise<void>;   // ErroDeRegra = limite etc.
    enfileirar: (uid: string, destino: string, dados: Record<string, unknown>) => Promise<void>;
    gerar?: () => string;
}

export async function tratarEnvio(req: Request, deps: Dependencias): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json(405, { erro: "Método não permitido." });

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const usuario = token ? await deps.usuario(token) : null;
    if (!usuario) return json(401, { erro: "Sessão expirada. Faça login novamente." });

    const identidade = await deps.identidade(usuario.id);
    if (!identidade) return json(404, { erro: "Conclua o cadastro da empresa antes." });
    if (identidade.verificada_em) return json(409, { erro: "A posse deste CNPJ já foi comprovada." });

    const modo = await deps.modo();
    let destino = usuario.email;
    let razao = "";

    if (modo === "REAL") {
        const receita = await deps.receita(identidade.cnpj);
        if (!receita) return json(503, { erro: "A consulta à Receita Federal está indisponível agora. Tente de novo em alguns minutos." });
        if (!receita.email) {
            return json(422, {
                erro: "A Receita Federal não tem e-mail cadastrado para este CNPJ. " +
                      "Atualize o e-mail na Receita (pelo seu contador) ou fale com o suporte para a verificação por documentos."
            });
        }
        destino = receita.email;
        razao = receita.razao_social;
    }

    const codigo = (deps.gerar ?? gerarCodigo)();
    const mascarado = mascararEmail(destino);

    try {
        await deps.registrar(usuario.id, await hashCodigo(codigo, usuario.id), mascarado);
    } catch (erro) {
        if (erro instanceof ErroDeRegra) return json(409, { erro: erro.message });
        throw erro;
    }

    if (modo === "REAL") {
        await deps.enfileirar(usuario.id, destino, {
            codigo, cnpj: identidade.cnpj, razao_social: razao, solicitante: mascararEmail(usuario.email)
        });
        return json(200, { modo, destino: mascarado });
    }

    // Demonstração: o código volta para a tela (nenhum e-mail é enviado)
    return json(200, { modo, destino: mascarado, codigo });
}
