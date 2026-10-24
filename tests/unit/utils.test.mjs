import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarScripts, simples } from "./carregar-script.mjs";

// Cliente Supabase falso, contando idas ao banco
function clienteFalso() {
    const estado = { consultas: 0, falhar: false, uid: "u1" };

    const consulta = tabela => ({
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
            estado.consultas += 1;
            if (estado.falhar) return { data: null, error: new Error("falha de rede") };
            return tabela === "usuarios"
                ? { data: { id_usuario: 7, nome_empresa: "ACME" }, error: null }
                : { data: { id_fornecedor: 9, razao_social: "ACME LTDA" }, error: null };
        }
    });

    const client = {
        auth: { async getSession() { return { data: { session: estado.uid ? { user: { id: estado.uid } } : null } }; } },
        from: consulta
    };

    return { client, estado };
}

function carregarUtils() {
    const { client, estado } = clienteFalso();
    const janela = carregarScripts(["utils.js"], { obterSupabase: () => client });
    return { U: janela.SERFUtils, estado };
}

test("obterEmpresaLogada: uma ida ao banco para várias chamadas simultâneas", async () => {
    const { U, estado } = carregarUtils();
    const [a, b] = await Promise.all([U.obterEmpresaLogada(), U.obterEmpresaLogada()]);

    assert.equal(estado.consultas, 2); // usuarios + fornecedores, uma vez
    assert.equal(a, b);
    assert.deepEqual(simples([a.perfil, a.idUsuario, a.idFornecedor, a.nome]), ["Ambos", 7, 9, "ACME"]);
});

test("obterEmpresaLogada: erro não fica em cache; troca de usuário recarrega", async () => {
    const { U, estado } = carregarUtils();
    await U.obterEmpresaLogada();

    estado.uid = "u2";
    estado.falhar = true;
    await assert.rejects(U.obterEmpresaLogada());

    estado.falhar = false;
    assert.equal((await U.obterEmpresaLogada()).authUserId, "u2");
});

test("obterEmpresaLogada: sem sessão devolve null", async () => {
    const { U, estado } = carregarUtils();
    estado.uid = null;
    assert.equal(await U.obterEmpresaLogada(), null);
});

test("escaparHTML neutraliza HTML", () => {
    const { U } = carregarUtils();
    assert.equal(U.escaparHTML(`<img src=x onerror="alert('x')">`),
        "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;");
    assert.equal(U.escaparHTML(null), "");
});

test("formatação de CNPJ, moeda e data", () => {
    const { U } = carregarUtils();
    assert.equal(U.formatarCNPJ("12345678000190"), "12.345.678/0001-90");
    assert.equal(U.formatarCNPJ(""), "Não informado");
    assert.match(U.formatarMoeda(1234.5), /R\$\s1\.234,50/);
    assert.equal(U.formatarData("2026-10-17"), "17/10/2026");
});

test("transições de status: estados finais não têm saída", () => {
    const { U } = carregarUtils();
    assert.deepEqual(simples(U.TRANSICOES_STATUS.PENDENTE), ["CONFIRMADO", "CANCELADO"]);
    assert.deepEqual(simples(U.TRANSICOES_STATUS.ENTREGUE), []);
    assert.deepEqual(simples(U.TRANSICOES_STATUS.CANCELADO), []);
});
