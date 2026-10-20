/* ==========================================================
   S.E.R.F. — HOME / EVENTOS.JS
   Navegação lateral, eventos dos filtros, indicadores e ações da
   Home (seções 16–19).

   A Home é um conjunto de MÓDULOS ES (sem build): cada arquivo importa
   o que usa dos outros e exporta o que oferece. A entrada é
   inicializacao.js (<script type="module"> na home.html), a única que
   executa algo ao carregar (iniciarHome()). O que outros scripts da
   página usam fica em window.SERFHome.
   ========================================================== */

import { elementos, estado, formatarMoeda, obterPedido } from "./estado.js";
import {
    abrirConversa,
    alterarModo,
    atualizarDashboard,
    atualizarListagem,
    mostrarMaisPedidos,
    obterConversasDoModo
} from "./dashboard.js";
import { abrirDetalhesPedido } from "./pedido-modal.js";


/* ==========================================================
   16 — NAVEGAÇÃO LATERAL
   Controla o menu responsivo e os links existentes.
   ========================================================== */

export function configurarNavegacao() {

    // Abre ou recolhe o menu em telas menores.
    // Botão ☰ do celular: tratado por js/ui/layout.js (todas as páginas)

    // Mantém os links internos sem gerar navegação inválida.
    document.querySelectorAll(".nav-item").forEach(link => {

        link.addEventListener("click", evento => {

            const destino = link.getAttribute("href");

            // Links para páginas externas (.html) devem navegar normalmente.
            if (destino && destino.includes(".html")) {
                return;
            }

            const secao = destino
                ? document.querySelector(destino)
                : null;

            // Âncora sem seção nesta página: deixa o navegador seguir o link
            if (!secao) return;

            // Destaca o link selecionado.
            document.querySelectorAll(".nav-item").forEach(item => {
                item.classList.remove("active");
            });

            link.classList.add("active");

            // Fecha o menu no celular após selecionar a seção.
            elementos.sidebar.classList.remove("open");
            elementos.menuToggle.setAttribute(
                "aria-expanded",
                "false"
            );
        });
    });
}


/* ==========================================================
   17 — EVENTOS DOS FILTROS
   Atualiza os registros quando o usuário muda critérios.
   ========================================================== */

// Espera após a última tecla antes de filtrar (digitação contínua = 1 render)
const ATRASO_BUSCA_MS = 150;

export function configurarFiltros() {

    elementos.filtroPeriodo.addEventListener("change", evento => {
        estado.periodo = Number(evento.target.value);
        atualizarDashboard();
    });

    // Status e empresa afetam só a listagem (gráfico/radar/conversas não mudam)
    elementos.filtroStatus.addEventListener("change", evento => {
        estado.status = evento.target.value;
        atualizarListagem();
    });

    elementos.filtroEmpresa.addEventListener("change", evento => {
        estado.empresa = evento.target.value;
        atualizarListagem();
    });

    // Busca com debounce: uma renderização por pausa na digitação,
    // não uma por tecla. Só tabela e KPIs dependem da busca.
    // As sugestões de fornecedores ficam em configurarSugestoesFornecedores().
    let buscaAgendada = null;
    elementos.buscaGlobal.addEventListener("input", evento => {
        estado.busca = evento.target.value.trim().toLowerCase();
        clearTimeout(buscaAgendada);
        buscaAgendada = setTimeout(atualizarListagem, ATRASO_BUSCA_MS);
    });

    // Restaura os filtros para os valores iniciais.
    elementos.btnLimparFiltros.addEventListener("click", () => {

        estado.periodo = 30;
        estado.status = "todos";
        estado.empresa = "todas";
        estado.busca = "";
        estado.indicador = null;

        elementos.filtroPeriodo.value = "30";
        elementos.filtroStatus.value = "todos";
        elementos.filtroEmpresa.value = "todas";
        elementos.buscaGlobal.value = "";

        document.querySelectorAll(".metric-item").forEach(item => {
            item.classList.remove("active");
        });

        atualizarDashboard();
    });

    configurarSugestoesFornecedores();
}


/* ==========================================================
   17.1 — SUGESTÕES DE FORNECEDORES (auto-complete da busca)
   Os dados vêm de SERFDados.fornecedores (camada de dados);
   aqui só há DOM e eventos.
   ========================================================== */

// Espera maior que a da tabela: cada pausa gera uma consulta ao servidor
const ATRASO_SUGESTOES_MS = 300;

function configurarSugestoesFornecedores() {

    const campo = elementos.buscaGlobal;
    const lista = document.getElementById("resultadoBusca");
    const fornecedores = window.SERFDados?.fornecedores;
    const produtos = window.SERFDados?.produtos;

    if (!campo || !lista) return;

    if (!fornecedores && !produtos) {
        console.warn("[SERF:Home] Repositórios de busca não carregados: busca sem sugestões.");
        return;
    }

    // Padrão ARIA "combobox com lista": leitores de tela anunciam as
    // sugestões e a opção ativa; setas, Enter e Esc funcionam pelo teclado.
    campo.setAttribute("role", "combobox");
    campo.setAttribute("aria-autocomplete", "list");
    campo.setAttribute("aria-controls", lista.id);
    campo.setAttribute("aria-expanded", "false");
    lista.setAttribute("role", "listbox");
    lista.setAttribute("aria-label", "Sugestões de fornecedores e produtos");

    let sugestaoAgendada = null;
    let opcoes = [];   // [{ tipo: "fornecedor", nome } | { tipo: "produto", nome, produto }]
    let ativa = -1;

    const escolher = opcao => {
        if (opcao.tipo === "fornecedor") {
            window.location.href = `empresas.html?busca=${encodeURIComponent(opcao.nome)}`;
            return;
        }

        esconder();
        if (window.CatalogoModule?.abrirModalNegociacao) {
            window.CatalogoModule.abrirModalNegociacao(opcao.produto);
        } else {
            window.location.href = "catalogo.html";
        }
    };

    const marcarAtiva = indice => {
        ativa = indice;
        lista.querySelectorAll('[role="option"]').forEach(item =>
            item.setAttribute("aria-selected", String(Number(item.dataset.indice) === ativa)));

        if (ativa >= 0) campo.setAttribute("aria-activedescendant", `sugestao-fornecedor-${ativa}`);
        else campo.removeAttribute("aria-activedescendant");
    };

    function esconder() {
        lista.hidden = true;
        campo.setAttribute("aria-expanded", "false");
        marcarAtiva(-1);
    }

    const titulo = texto => {
        const item = document.createElement("li");
        item.className = "busca-grupo";
        item.setAttribute("role", "presentation");
        item.textContent = texto;
        return item;
    };

    const desenhar = () => {
        const itens = [];
        let grupoAtual = null;

        opcoes.forEach((opcao, indice) => {
            if (opcao.tipo !== grupoAtual) {
                grupoAtual = opcao.tipo;
                itens.push(titulo(opcao.tipo === "fornecedor" ? "Fornecedores" : "Produtos"));
            }

            const item = document.createElement("li");
            item.id = `sugestao-fornecedor-${indice}`;
            item.className = `busca-sugestao busca-${opcao.tipo}`;
            item.dataset.indice = String(indice);
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", "false");

            if (opcao.tipo === "produto") {
                const nome = document.createElement("span");
                nome.textContent = opcao.nome;
                const detalhe = document.createElement("small");
                detalhe.textContent = `${opcao.fornecedor} · ${formatarMoeda(opcao.produto.preco_atacado)}/un.`;
                item.append(nome, detalhe);
            } else {
                item.textContent = opcao.nome;
            }

            // mousedown: escolhe antes do campo perder o foco
            item.addEventListener("mousedown", evento => {
                evento.preventDefault();
                escolher(opcao);
            });

            itens.push(item);
        });

        lista.replaceChildren(...itens);
        lista.hidden = false;
        campo.setAttribute("aria-expanded", "true");
        marcarAtiva(-1);
    };

    // As duas buscas em paralelo; se uma falhar, mostra a outra
    async function buscar(termo) {
        const [resFornecedores, resProdutos] = await Promise.allSettled([
            fornecedores ? fornecedores.sugerir(termo) : Promise.resolve([]),
            produtos ? produtos.sugerir(termo) : Promise.resolve([])
        ]);

        if (resFornecedores.status === "rejected") console.error("[SERF:Home] Sugestões de fornecedores:", resFornecedores.reason);
        if (resProdutos.status === "rejected") console.error("[SERF:Home] Sugestões de produtos:", resProdutos.reason);

        const deFornecedores = resFornecedores.status === "fulfilled" ? resFornecedores.value : [];
        const deProdutos = resProdutos.status === "fulfilled" ? resProdutos.value : [];

        return [
            ...deFornecedores.map(f => ({ tipo: "fornecedor", nome: f.nome })),
            ...deProdutos.map(p => {
                const fornecedor = Array.isArray(p.fornecedores) ? p.fornecedores[0] : p.fornecedores;
                return {
                    tipo: "produto",
                    nome: p.nome_produto,
                    fornecedor: fornecedor?.nome_fantasia || fornecedor?.razao_social || "Fornecedor",
                    produto: p
                };
            })
        ];
    }

    campo.addEventListener("input", () => {
        clearTimeout(sugestaoAgendada);

        const termo = campo.value.trim();

        if (termo.length < 2) {
            esconder();
            return;
        }

        sugestaoAgendada = setTimeout(async () => {
            const resultado = await buscar(termo);

            // Resposta atrasada de um termo que já mudou: ignora
            if (campo.value.trim() !== termo) return;

            opcoes = resultado;

            if (opcoes.length === 0) {
                esconder();
                return;
            }

            desenhar();
        }, ATRASO_SUGESTOES_MS);
    });

    campo.addEventListener("keydown", evento => {
        const aberta = !lista.hidden && opcoes.length > 0;

        if (evento.key === "Escape") {
            esconder();
            return;
        }

        if (!aberta) return;

        if (evento.key === "ArrowDown") {
            evento.preventDefault();
            marcarAtiva((ativa + 1) % opcoes.length);
        } else if (evento.key === "ArrowUp") {
            evento.preventDefault();
            marcarAtiva(ativa <= 0 ? opcoes.length - 1 : ativa - 1);
        } else if (evento.key === "Enter" && ativa >= 0) {
            evento.preventDefault();
            escolher(opcoes[ativa]);
        }
    });

    // Fecha ao sair do campo (clique fora, Tab)
    campo.addEventListener("blur", esconder);
}


/* ==========================================================
   18 — INTERAÇÃO DOS INDICADORES
   Permite filtrar pedidos ao clicar em uma métrica.
   ========================================================== */

export function configurarIndicadores() {

    document.querySelectorAll(".metric-item").forEach(botao => {

        botao.addEventListener("click", () => {

            const indicador = botao.dataset.metric;

            // Mensagens direciona o usuário à área de conversas.
            if (indicador === "mensagens") {
                document.getElementById("mensagens")
                    .scrollIntoView({ behavior: "smooth" });

                return;
            }

            // Segundo clique remove o filtro selecionado.
            estado.indicador =
                estado.indicador === indicador ? null : indicador;

            document.querySelectorAll(".metric-item").forEach(item => {
                item.classList.toggle(
                    "active",
                    item.dataset.metric === estado.indicador
                );
            });

            atualizarListagem();
        });
    });
}


/* ==========================================================
   19 — AÇÕES DA HOME
   Botões da tabela, atalhos e funcionalidades futuras.
   ========================================================== */

export function configurarAcoes() {

    // Alternância de contexto Comprar/Vender.
    document.querySelectorAll(".modo-btn").forEach(botao => {
        botao.addEventListener("click", () => {
            alterarModo(botao.dataset.mode);
        });
    });

    // Ação contextual de comprador ou fornecedor.
    // Comprar: vai ao catálogo (pedido unitário ou carrinho).
    // Vender: o catalogo.js intercepta e abre o cadastro aqui mesmo; se não
    // puder (sem cadastro de fornecedor carregado), abre no catálogo.
    elementos.btnAcaoPrincipal.addEventListener("click", () => {
        window.location.href = estado.modo === "comprar"
            ? "catalogo.html"
            : "catalogo.html?modo=vender&novo=1";
    });

    // Ações da tabela por delegação de eventos.
    elementos.pedidosTableBody.addEventListener("click", evento => {

        const botao = evento.target.closest("[data-pedido]");

        if (!botao) return;

        const pedido = obterPedido(Number(botao.dataset.pedido));

        if (pedido) {
            abrirDetalhesPedido(pedido);
        }
    });

    // Tabela paginada: acrescenta mais linhas sem refiltrar o resto do painel
    elementos.btnMaisPedidos?.addEventListener("click", mostrarMaisPedidos);

    // Acesso ao futuro módulo de mensagens.
    // "Ver todas": abre a conversa mais recente com mensagens não lidas
    // (ou simplesmente a mais recente).
    elementos.btnTodasMensagens.addEventListener("click", () => {
        const conversas = obterConversasDoModo();
        const alvo = conversas.find(conversa => conversa.naoLidas > 0) || conversas[0];

        if (alvo) {
            abrirConversa(alvo.idPedido);
        } else {
            SERFAvisos.info("Nenhuma conversa ainda", "Abra um pedido na tabela e use o chat para falar com a outra empresa.");
        }
    });

    // Clique (ou Enter) numa conversa abre o chat do pedido.
    elementos.conversasRecentes.addEventListener("click", evento => {
        const item = evento.target.closest("[data-conversa]");
        if (item) abrirConversa(Number(item.dataset.conversa));
    });

    elementos.conversasRecentes.addEventListener("keydown", evento => {
        const item = evento.target.closest("[data-conversa]");
        if (item && (evento.key === "Enter" || evento.key === " ")) {
            evento.preventDefault();
            abrirConversa(Number(item.dataset.conversa));
        }
    });

    // Acesso ao perfil corporativo
    if (elementos.btnPerfil) {
        elementos.btnPerfil.addEventListener("click", () => {
            window.location.href = "perfil.html";
        });
    }
}
