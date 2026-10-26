// Fumaça contra um Supabase DE VERDADE (PostgREST, Auth e Storage reais).
//
// Os testes de interface usam um Supabase simulado, que aceita qualquer
// consulta: foi assim que "Minhas cotações" quebrou no ar (PGRST201) com
// todos os testes verdes. Aqui as consultas são as da própria camada de
// dados do site (tests/api/carregar-dados.mjs), contra o servidor real.
//
// Roda na CI (job "supabase-api", com `supabase start`). Localmente, com
// Docker:  supabase start  →  npm run test:api
// Sem as variáveis abaixo, o arquivo é pulado.
//   SUPABASE_API_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// NUNCA aponte para o projeto de produção: o teste cria contas e dados.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { carregarDados } from "./carregar-dados.mjs";

const URL_API = process.env.SUPABASE_API_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pular = !(URL_API && ANON && SERVICO) && "defina SUPABASE_API_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY";

// Na CI o job existe para isto: pular em silêncio daria um verde falso
if (pular && process.env.EXIGIR_SUPABASE_API) throw new Error(`Supabase local não configurado: ${pular}`);

if (!pular && /rparlqdgcwzoanpqqeof/.test(URL_API)) {
    throw new Error("Este teste cria contas e dados: não rode contra o projeto de produção.");
}

const semSessao = { auth: { persistSession: false, autoRefreshToken: false } };
const sufixo = Date.now().toString(36);
const cnpjAleatorio = () => String(Math.floor(Math.random() * 1e14)).padStart(14, "0");

const admin = pular ? null : createClient(URL_API, SERVICO, semSessao);

// Conta + empresa (trigger do cadastro) + perfil + posse do CNPJ comprovada
async function criarEmpresa(nome, perfil) {
    const email = `${perfil.toLowerCase()}-${sufixo}@teste.serf.invalid`;
    const senha = `Senha-${sufixo}-forte`;
    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true,
        user_metadata: { cnpj: cnpjAleatorio(), razao_social: nome }
    });
    if (erroCriar) throw erroCriar;

    const cliente = createClient(URL_API, ANON, semSessao);
    const { error: erroLogin } = await cliente.auth.signInWithPassword({ email, password: senha });
    if (erroLogin) throw erroLogin;

    const { error: erroPerfil } = await cliente.rpc("atualizar_segmentacao_usuario", { p_perfil: perfil, p_nicho: "Alimentos" });
    if (erroPerfil) throw erroPerfil;

    const { error: erroIdentidade } = await admin.from("identidade_empresas")
        .update({ verificada_em: new Date().toISOString(), metodo: "TESTE" }).eq("auth_user_id", criado.user.id);
    if (erroIdentidade) throw erroIdentidade;

    const [{ data: idUsuario }, { data: idFornecedor }] = await Promise.all([
        cliente.rpc("meu_id_usuario"), cliente.rpc("meu_id_fornecedor")
    ]);
    return { uid: criado.user.id, nome, cliente, idUsuario, idFornecedor, ...carregarDados(cliente) };
}

const contexto = {};

before(async () => {
    if (pular) return;
    contexto.fornecedor = await criarEmpresa(`Distribuidora Fumaça ${sufixo}`, "Fornecedor");
    contexto.comprador = await criarEmpresa(`Mercado Fumaça ${sufixo}`, "Comprador");

    const { data, error } = await contexto.fornecedor.cliente.from("produtos").insert({
        id_fornecedor: contexto.fornecedor.idFornecedor,
        nome_produto: `Arroz Fumaça ${sufixo}`,
        categoria: "Alimentos & Bebidas",
        preco_atacado: 25.5,
        quantidade_minima: 10,
        quantidade_estoque: 500
    }).select("id_produto").single();
    if (error) throw error;
    contexto.idProduto = data.id_produto;
});

test("catálogo: busca no servidor com o fornecedor embutido (view fornecedores_publicos)", { skip: pular }, async () => {
    const { dados } = contexto.comprador;
    const { produtos, total } = await dados.produtos.catalogo({ termo: `Fumaça ${sufixo}`, categoria: "Alimentos & Bebidas", ordem: "menor_preco" });

    assert.equal(total, 1);
    assert.equal(produtos[0].id_produto, contexto.idProduto);
    assert.equal(produtos[0].fornecedores.razao_social, contexto.fornecedor.nome);
});

test("pedido: compra, painel dos dois lados, mudança de status e chat", async t => {
    if (pular) return t.skip(pular);
    const { comprador, fornecedor } = contexto;

    const [linha] = await comprador.dados.pedidos.criarCompra([{ id_produto: contexto.idProduto, quantidade: 20 }], "teste de fumaça");
    contexto.idPedido = linha.id_pedido;

    const desde = new Date(Date.now() - 86400000).toISOString();
    for (const lado of [comprador, fornecedor]) {
        const painel = await lado.dados.pedidos.consultarPainel({ desde, limite: 1000 });
        assert.ok(painel.some(p => p.id_pedido === contexto.idPedido), `pedido no painel de ${lado.nome}`);
    }

    const atualizado = await fornecedor.dados.pedidos.atualizarStatus(contexto.idPedido, "CONFIRMADO");
    assert.equal(atualizado.status_pedido, "CONFIRMADO");

    await comprador.dados.mensagens.enviar(contexto.idPedido, comprador.uid, "Olá, tudo certo?");
    const conversa = await fornecedor.dados.mensagens.listarDoPedido(contexto.idPedido);
    assert.equal(conversa.at(-1).texto, "Olá, tudo certo?");
    await fornecedor.dados.mensagens.marcarComoLidas(contexto.idPedido, fornecedor.uid);
    assert.ok((await fornecedor.dados.mensagens.listarRecentes(20)).length >= 1);
});

test("cotação reversa: publicar, propor e o comprador ver a proposta (PGRST201)", async t => {
    if (pular) return t.skip(pular);
    const { comprador, fornecedor } = contexto;

    const [cotacao] = [].concat(await comprador.dados.cotacoes.publicar({
        titulo: `Arroz para revenda ${sufixo}`, categoria: "Alimentos & Bebidas", quantidade: 100, unidade: "un.", dias: 7
    }));

    const abertas = await fornecedor.dados.cotacoes.cotacoesAbertas(["Alimentos & Bebidas"]);
    assert.ok(abertas.some(c => c.id_cotacao === cotacao.id_cotacao));

    await fornecedor.dados.cotacoes.enviarProposta({ idCotacao: cotacao.id_cotacao, idProduto: contexto.idProduto, preco: 24, prazo: 5 });
    assert.equal((await fornecedor.dados.cotacoes.minhasPropostas(fornecedor.idFornecedor)).length, 1);

    // A consulta que quebrou no ar: cotações COM as propostas embutidas
    const minhas = await comprador.dados.cotacoes.minhasCotacoes(comprador.idUsuario);
    const encontrada = minhas.find(c => c.id_cotacao === cotacao.id_cotacao);
    assert.equal(encontrada.propostas.length, 1);
    assert.equal(Number(encontrada.propostas[0].preco_unitario), 24);
});

test("telas de apoio: vitrine, notificações, pendências, identidade, sugestões e LGPD", async t => {
    if (pular) return t.skip(pular);
    const { comprador, fornecedor } = contexto;

    const vitrine = await comprador.cliente.from("fornecedores_vitrine").select("*").eq("id_fornecedor", fornecedor.idFornecedor);
    assert.equal(vitrine.error, null);
    assert.equal(vitrine.data[0].produtos_ativos, 1);

    await fornecedor.dados.notificacoes.listar();
    await fornecedor.dados.pendencias.listarAlertas();
    await comprador.dados.pendencias.listarOportunidades(10);
    await comprador.dados.pendencias.primeirosPassos();
    await comprador.dados.pendencias.meusSegmentos();

    const identidade = await fornecedor.dados.empresa.identidade();
    assert.ok(identidade.verificada_em);
    assert.ok(["DEMONSTRACAO", "REAL"].includes(await fornecedor.dados.empresa.modoIdentidade()));

    assert.ok((await comprador.dados.fornecedores.sugerir("Distribuidora Fumaça")).length >= 1);
    assert.ok((await comprador.dados.produtos.sugerir(`Arroz Fumaça ${sufixo}`)).length >= 1);

    const exportado = await comprador.dados.empresa.exportarDados();
    assert.ok(exportado && typeof exportado === "object");
});

test("Storage: logo só na pasta da própria empresa", async t => {
    if (pular) return t.skip(pular);
    const { fornecedor, comprador } = contexto;
    const imagem = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });

    const proprio = await fornecedor.cliente.storage.from("logos").upload(`${fornecedor.uid}/logo`, imagem, { upsert: true, contentType: "image/png" });
    assert.equal(proprio.error, null);

    const alheio = await fornecedor.cliente.storage.from("logos").upload(`${comprador.uid}/logo`, imagem, { upsert: true, contentType: "image/png" });
    assert.ok(alheio.error, "gravou na pasta de outra empresa");

    const svg = await fornecedor.cliente.storage.from("logos")
        .upload(`${fornecedor.uid}/logo`, new Blob(["<svg/>"], { type: "image/svg+xml" }), { upsert: true, contentType: "image/svg+xml" });
    assert.ok(svg.error, "aceitou SVG");
});

test("monitor de erros: grava em nome próprio e não lê", async t => {
    if (pular) return t.skip(pular);
    const { cliente } = contexto.comprador;

    const gravou = await cliente.from("erros_navegador").insert({ pagina: "/pages/app/home.html", mensagem: `fumaça ${sufixo}` });
    assert.equal(gravou.error, null);

    const leu = await cliente.from("erros_navegador").select("*");
    assert.ok(leu.error, "conseguiu ler os erros");
});

test("visitante sem login não lê dados das empresas", async t => {
    if (pular) return t.skip(pular);
    const visitante = createClient(URL_API, ANON, semSessao);
    for (const tabela of ["produtos", "pedidos", "usuarios", "fornecedores_publicos"]) {
        const { data, error } = await visitante.from(tabela).select("*").limit(1);
        assert.ok(error || data.length === 0, `visitante leu ${tabela}`);
    }
});
