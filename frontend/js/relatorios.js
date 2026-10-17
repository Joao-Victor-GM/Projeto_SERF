/* =========================================================================
   S.E.R.F. — RELATÓRIOS COMERCIAIS (relatorios.js)

   Duas perspectivas, sobre os pedidos reais do Supabase:
   - VENDAS (fornecedor): resumo, evolução, funil, categorias, curva ABC de
     produtos, carteira de clientes e saúde do estoque.
   - COMPRAS (comprador): resumo de gastos, evolução, status, categorias,
     produtos mais comprados e concentração em fornecedores.

   Todos os gráficos são HTML puro (sem bibliotecas), com tooltip por marca,
   tabela equivalente e exportação CSV.

   Datas por etapa (resposta, envio, entrega) vêm do banco (migration 008):
   faturamento usa a data de entrega; tempos de resposta e entrega são medidos
   a partir da data do pedido.
   ========================================================================= */

"use strict";

(function () {
    const {
        escaparHTML,
        formatarMoeda,
        formatarData,
        dataLocalISO,
        statusDoPedido
    } = window.SERFUtils;

    const DIA_MS = 86400000;
    const STATUS_EM_ANDAMENTO = ["CONFIRMADO", "EM_SEPARACAO", "ENVIADO"];

    const estado = {
        perspectiva: "vendas",
        serieEvolucao: "pedidos",   // "pedidos" (data do pedido) | "entregas" (data de entrega)
        dias: 30
    };

    const empresa = {
        idUsuario: null,
        idFornecedor: null,
        nome: null
    };

    let pedidos = [];            // todos os pedidos visíveis (RLS), normalizados
    let produtosProprios = [];   // produtos do fornecedor (estoque)
    let carregadoEm = null;

    // Dados de cada relatório para a tabela/CSV: chave → { colunas, linhas, arquivo }
    const relatoriosAtuais = {};

    const el = id => document.getElementById(id);


    /* =====================================================================
       1. FORMATAÇÃO
       ===================================================================== */

    const formatoCompacto = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "compact",
        maximumFractionDigits: 1
    });

    function moedaCompacta(valor) {
        return Math.abs(valor) < 1000 ? formatarMoeda(valor) : formatoCompacto.format(valor);
    }

    function inteiro(valor) {
        return new Intl.NumberFormat("pt-BR").format(valor || 0);
    }

    function percentual(fracao, casas = 0) {
        if (fracao === null || fracao === undefined || Number.isNaN(fracao)) return "—";
        return `${(fracao * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`;
    }

    function plural(n, singular, pluralTexto) {
        return `${inteiro(n)} ${n === 1 ? singular : pluralTexto}`;
    }

    const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];


    /* =====================================================================
       2. CARGA DOS DADOS
       ===================================================================== */

    // Leitura canônica (pedidos.js) + nomes usados nesta página
    function normalizarPedido(linha) {
        const p = window.SERFPedidos.normalizar(linha);

        return {
            ...p,
            data: p.dataPedido,
            dataISO: p.criadoEm,
            valor: p.valorTotal,
            produtoNome: p.produto,
            categoria: p.categoria || "Sem categoria"
        };
    }

    async function carregarDados() {
        const client = obterSupabase();
        const logada = await window.SERFUtils.obterEmpresaLogada();

        empresa.idUsuario = logada?.idUsuario ?? null;
        empresa.idFornecedor = logada?.idFornecedor ?? null;
        empresa.nome = logada?.nome ?? null;

        // Histórico completo das duas perspectivas: "novo x recorrente" e o
        // período anterior (deltas) dependem de pedidos fora do período atual.
        const consultaPedidos = window.SERFPedidos.consultar(client)
            .order("data_pedido", { ascending: true });

        const consultaProdutos = empresa.idFornecedor === null
            ? Promise.resolve({ data: [], error: null })
            : client
                .from("produtos")
                .select("id_produto, nome_produto, categoria, quantidade_estoque, quantidade_minima, ativo")
                .eq("id_fornecedor", empresa.idFornecedor);

        const [resPedidos, resProdutos] = await Promise.all([consultaPedidos, consultaProdutos]);

        if (resPedidos.error) throw resPedidos.error;
        if (resProdutos.error) throw resProdutos.error;

        pedidos = (resPedidos.data || []).map(normalizarPedido);
        produtosProprios = resProdutos.data || [];
        carregadoEm = new Date();
    }


    /* =====================================================================
       3. RECORTE: PERSPECTIVA + PERÍODO
       ===================================================================== */

    function pedidosDaPerspectiva() {
        return estado.perspectiva === "vendas"
            ? pedidos.filter(p => p.souFornecedor)
            : pedidos.filter(p => p.souComprador);
    }

    // Período atual e anterior (mesma duração) para os deltas.
    function intervalos(lista) {
        const fim = new Date();

        if (estado.dias === 0) {
            const primeiro = lista.length ? lista[0].data : fim;
            return { inicio: primeiro, fim, anterior: null, diasPeriodo: Math.max(1, Math.ceil((fim - primeiro) / DIA_MS)) };
        }

        const inicio = new Date(fim.getTime() - estado.dias * DIA_MS);
        const inicioAnterior = new Date(inicio.getTime() - estado.dias * DIA_MS);

        return {
            inicio,
            fim,
            anterior: { inicio: inicioAnterior, fim: inicio },
            diasPeriodo: estado.dias
        };
    }

    function filtrarIntervalo(lista, inicio, fim) {
        return lista.filter(p => p.data >= inicio && p.data <= fim);
    }


    /* =====================================================================
       4. MÉTRICAS
       ===================================================================== */

    function soma(lista) {
        return lista.reduce((total, p) => total + p.valor, 0);
    }

    function calcularMetricas(lista) {
        const validos = lista.filter(p => p.statusBanco !== "CANCELADO");
        const entregues = lista.filter(p => p.statusBanco === "ENTREGUE");
        const andamento = lista.filter(p => STATUS_EM_ANDAMENTO.includes(p.statusBanco));
        const pendentes = lista.filter(p => p.statusBanco === "PENDENTE");
        const cancelados = lista.filter(p => p.statusBanco === "CANCELADO");
        const enviados = lista.filter(p => p.statusBanco === "ENVIADO" || p.statusBanco === "ENTREGUE");

        const respondidos = lista.length - pendentes.length;
        const aceitos = andamento.length + entregues.length;
        const chaveParceiro = estado.perspectiva === "vendas" ? "idUsuario" : "idFornecedor";

        return {
            total: lista.length,
            validos: validos.length,
            entregues: entregues.length,
            andamento: andamento.length,
            pendentes: pendentes.length,
            cancelados: cancelados.length,
            enviados: enviados.length,
            aceitos,
            valorNegociado: soma(validos),
            valorEntregue: soma(entregues),
            valorAndamento: soma(andamento),
            valorPendente: soma(pendentes),
            ticket: validos.length ? soma(validos) / validos.length : null,
            taxaAceite: respondidos ? aceitos / respondidos : null,
            taxaCancelamento: lista.length ? cancelados.length / lista.length : null,
            parceiros: new Set(validos.map(p => p[chaveParceiro])).size
        };
    }

    // Delta vs período anterior. tipo: "relativo" (%) ou "pontos" (p.p.)
    function delta(atual, anterior, { tipo = "relativo", bomSeSobe = true } = {}) {
        if (anterior === null || anterior === undefined || atual === null || atual === undefined) return null;

        let diferenca;
        let texto;

        if (tipo === "pontos") {
            diferenca = (atual - anterior) * 100;
            if (Math.abs(diferenca) < 0.05) return { texto: "estável", classe: "neutro", seta: "→" };
            texto = `${diferenca > 0 ? "+" : ""}${diferenca.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`;
        } else {
            if (anterior === 0) {
                return atual > 0 ? { texto: "novo no período", classe: "neutro", seta: "↑" } : null;
            }
            diferenca = (atual - anterior) / anterior;
            if (Math.abs(diferenca) < 0.005) return { texto: "estável", classe: "neutro", seta: "→" };
            texto = `${diferenca > 0 ? "+" : ""}${(diferenca * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
        }

        const subiu = diferenca > 0;
        const classe = bomSeSobe === null ? "neutro" : (subiu === bomSeSobe ? "bom" : "ruim");

        return { texto, classe, seta: subiu ? "↑" : "↓" };
    }


    /* =====================================================================
       5. TOOLTIP COMPARTILHADO (enhance, nunca gate: tudo está na tabela)
       ===================================================================== */

    const tooltip = el("relTooltip");

    function mostrarTooltip(alvo, evento) {
        const { tipValor, tipRotulo, tipDetalhe } = alvo.dataset;
        if (!tipValor) return;

        tooltip.replaceChildren();

        const valor = document.createElement("span");
        valor.className = "rel-tooltip-valor";
        valor.textContent = tipValor;
        tooltip.appendChild(valor);

        if (tipRotulo) {
            const rotulo = document.createElement("span");
            rotulo.className = "rel-tooltip-rotulo";
            rotulo.textContent = tipRotulo;
            tooltip.appendChild(rotulo);
        }

        if (tipDetalhe) {
            const detalhe = document.createElement("span");
            detalhe.className = "rel-tooltip-detalhe";
            detalhe.textContent = tipDetalhe;
            tooltip.appendChild(detalhe);
        }

        tooltip.hidden = false;

        const caixa = alvo.getBoundingClientRect();
        const x = evento && evento.clientX ? evento.clientX : caixa.left + caixa.width / 2;
        const y = evento && evento.clientY ? evento.clientY : caixa.top;
        const largura = tooltip.offsetWidth;
        const altura = tooltip.offsetHeight;

        const esquerda = Math.min(Math.max(8, x - largura / 2), window.innerWidth - largura - 8);
        const topo = y - altura - 12 < 8 ? y + 16 : y - altura - 12;

        tooltip.style.left = `${esquerda}px`;
        tooltip.style.top = `${topo}px`;
    }

    function esconderTooltip() {
        tooltip.hidden = true;
    }

    function configurarTooltip() {
        const conteudo = el("relConteudo");

        conteudo.addEventListener("pointermove", evento => {
            const alvo = evento.target.closest("[data-tip-valor]");
            if (alvo) mostrarTooltip(alvo, evento);
            else esconderTooltip();
        });

        conteudo.addEventListener("pointerleave", esconderTooltip);

        conteudo.addEventListener("focusin", evento => {
            const alvo = evento.target.closest("[data-tip-valor]");
            if (alvo) mostrarTooltip(alvo, null);
        });

        conteudo.addEventListener("focusout", esconderTooltip);
        window.addEventListener("scroll", esconderTooltip, { passive: true });
    }

    function atributosTooltip(valor, rotulo, detalhe = "") {
        return `tabindex="0" data-tip-valor="${escaparHTML(valor)}" data-tip-rotulo="${escaparHTML(rotulo)}" data-tip-detalhe="${escaparHTML(detalhe)}" aria-label="${escaparHTML(`${rotulo}: ${valor}${detalhe ? `, ${detalhe}` : ""}`)}"`;
    }


    /* =====================================================================
       6. COMPONENTES DE GRÁFICO
       ===================================================================== */

    // Escala "limpa" para o eixo: 0 → máximo arredondado, 4 divisões.
    function escalaLimpa(maximo) {
        if (maximo <= 0) return { topo: 1, passos: [0, 1] };

        const bruto = maximo / 4;
        const magnitude = 10 ** Math.floor(Math.log10(bruto));
        const fator = [1, 2, 2.5, 5, 10].find(f => f * magnitude >= bruto);
        const passo = fator * magnitude;
        const topo = passo * Math.ceil(maximo / passo);

        const passos = [];
        for (let v = 0; v <= topo + passo / 2; v += passo) passos.push(v);

        return { topo, passos };
    }

    function renderizarColunas(container, pontos, { formatar, formatarEixo }) {
        if (!pontos.length || pontos.every(p => p.valor === 0)) {
            container.innerHTML = `<p class="rel-vazio">Nenhum valor no período selecionado.</p>`;
            return;
        }

        const { topo, passos } = escalaLimpa(Math.max(...pontos.map(p => p.valor)));

        // Quantos rótulos cabem no eixo X sem colidir (~52px por rótulo "dd/mm").
        const larguraPlot = Math.max(container.clientWidth - 56, 120);
        const rotulosQueCabem = Math.max(2, Math.floor(larguraPlot / 52));
        const intervaloRotulo = Math.max(1, Math.ceil(pontos.length / rotulosQueCabem));

        const grade = passos.map(v => `<div class="rel-grade-linha" style="bottom:${(v / topo) * 100}%"></div>`).join("");
        const eixoY = passos.map(v => `<span style="bottom:${(v / topo) * 100}%">${escaparHTML(formatarEixo(v))}</span>`).join("");

        const colunas = pontos.map(p => `
            <div class="rel-faixa" ${atributosTooltip(formatar(p.valor), p.rotuloLongo, p.detalhe)}>
                <div class="rel-coluna" style="height:${(p.valor / topo) * 100}%"></div>
            </div>
        `).join("");

        const eixoX = pontos.map((p, i) =>
            `<span>${i % intervaloRotulo === 0 ? `<i>${escaparHTML(p.rotulo)}</i>` : ""}</span>`
        ).join("");

        container.innerHTML = `
            <div class="rel-colunas">
                <div class="rel-eixo-y" aria-hidden="true">${eixoY}</div>
                <div class="rel-area-plot">
                    <div class="rel-plot">${grade}${colunas}</div>
                    <div class="rel-eixo-x" aria-hidden="true">${eixoX}</div>
                </div>
            </div>
        `;
    }

    // itens: { rotulo, valor, textoValor, classe?, detalhe?, separadorAntes? }
    function renderizarBarras(container, itens, { maximo } = {}) {
        if (!itens.length) {
            container.innerHTML = `<p class="rel-vazio">Nenhum dado no período selecionado.</p>`;
            return;
        }

        const topo = maximo ?? Math.max(...itens.map(i => i.valor), 1);

        container.innerHTML = `
            <div class="rel-barras">
                ${itens.map(item => `
                    ${item.separadorAntes ? '<div class="rel-separador" aria-hidden="true"></div>' : ""}
                    <div class="rel-barra-linha" ${atributosTooltip(item.textoValor, item.rotulo, item.detalhe || "")}>
                        <span class="rel-barra-rotulo" title="${escaparHTML(item.rotulo)}">${escaparHTML(item.rotulo)}</span>
                        <span class="rel-barra-trilho">
                            <span class="rel-barra ${item.classe || ""} ${item.valor ? "" : "zero"}" style="--fracao:${topo ? item.valor / topo : 0}"></span>
                            <span class="rel-barra-valor">${escaparHTML(item.textoValor)}</span>
                        </span>
                    </div>
                `).join("")}
            </div>
        `;
    }

    // colunas: { titulo, num? } ; linhas: arrays de { texto, html? }
    function renderizarTabela(container, colunas, linhas) {
        if (!linhas.length) {
            container.innerHTML = `<p class="rel-vazio">Sem registros para exibir.</p>`;
            return;
        }

        container.innerHTML = `
            <table class="rel-tabela">
                <thead>
                    <tr>${colunas.map(c => `<th class="${c.num ? "num" : ""}" scope="col">${escaparHTML(c.titulo)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${linhas.map(linha => `
                        <tr>${linha.map((celula, i) => `
                            <td class="${colunas[i].num ? "num" : ""}">${celula.html ?? escaparHTML(celula.texto)}</td>
                        `).join("")}</tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    }

    // Guarda a versão "dados puros" de um relatório (tabela + CSV).
    function registrarRelatorio(chave, colunas, linhas, arquivo) {
        relatoriosAtuais[chave] = { colunas, linhas, arquivo };
    }


    /* =====================================================================
       7. RELATÓRIO: RESUMO EXECUTIVO
       ===================================================================== */

    function tileKpi({ rotulo, valor, ajuda, variacao }) {
        const deltaHtml = variacao
            ? `<span class="rel-delta ${variacao.classe}"><span aria-hidden="true">${variacao.seta}</span> ${escaparHTML(variacao.texto)}</span>
               <span class="rel-kpi-ajuda">vs. período anterior</span>`
            : `<span class="rel-kpi-ajuda">${escaparHTML(ajuda || "")}</span>`;

        return `
            <div class="rel-kpi">
                <div class="rel-kpi-rotulo">${escaparHTML(rotulo)}</div>
                <div class="rel-kpi-valor">${escaparHTML(valor)}</div>
                <div>${deltaHtml}</div>
            </div>
        `;
    }

    // Pedidos ENTREGUES cuja data de entrega cai no intervalo (faturamento real).
    function entreguesNoIntervalo(lista, inicio, fim) {
        return lista.filter(p =>
            p.statusBanco === "ENTREGUE" &&
            p.dataEntrega &&
            p.dataEntrega >= inicio &&
            p.dataEntrega <= fim
        );
    }

    // Média, em ms, entre a data do pedido e outra data da etapa.
    function mediaDuracao(lista, campo) {
        const duracoes = lista
            .filter(p => p[campo] && p[campo] >= p.data)
            .map(p => p[campo] - p.data);

        return duracoes.length
            ? duracoes.reduce((t, d) => t + d, 0) / duracoes.length
            : null;
    }

    function formatarDuracao(ms) {
        if (ms === null || ms === undefined) return "—";

        const minutos = ms / 60000;
        if (minutos < 60) return `${Math.max(1, Math.round(minutos))} min`;

        const horas = minutos / 60;
        if (horas < 48) return `${horas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;

        return `${(horas / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
    }

    function renderizarResumo(atual, anterior, lista, periodo) {
        const vendas = estado.perspectiva === "vendas";
        const a = calcularMetricas(atual);
        const b = anterior ? calcularMetricas(anterior) : null;

        // Faturamento pela DATA DE ENTREGA (não pela data do pedido)
        const faturado = soma(entreguesNoIntervalo(lista, periodo.inicio, periodo.fim));
        const faturadoAnterior = periodo.anterior
            ? soma(entreguesNoIntervalo(lista, periodo.anterior.inicio, periodo.anterior.fim))
            : null;

        // Tempos das etapas (pedidos feitos no período)
        const resposta = mediaDuracao(atual, "dataResposta");
        const respostaAnterior = anterior ? mediaDuracao(anterior, "dataResposta") : null;
        const entrega = mediaDuracao(atual, "dataEntrega");
        const entregaAnterior = anterior ? mediaDuracao(anterior, "dataEntrega") : null;

        const variacaoHero = b ? delta(a.valorNegociado, b.valorNegociado, { bomSeSobe: vendas ? true : null }) : null;

        el("relHero").innerHTML = `
            <div class="rel-hero-rotulo">${vendas ? "Valor vendido no período" : "Total comprado no período"}</div>
            <div class="rel-hero-valor">${escaparHTML(formatarMoeda(a.valorNegociado))}</div>
            ${variacaoHero
                ? `<span class="rel-delta ${variacaoHero.classe}"><span aria-hidden="true">${variacaoHero.seta}</span> ${escaparHTML(variacaoHero.texto)}</span>
                   <span class="rel-kpi-ajuda">vs. período anterior · exclui pedidos cancelados</span>`
                : `<span class="rel-kpi-ajuda">Exclui pedidos cancelados</span>`}
        `;

        const tiles = vendas ? [
            { rotulo: "Faturado (entregue)", valor: formatarMoeda(faturado), variacao: delta(faturado, faturadoAnterior), ajuda: "pela data de entrega" },
            { rotulo: "Tempo médio de resposta", valor: formatarDuracao(resposta), variacao: delta(resposta, respostaAnterior, { bomSeSobe: false }), ajuda: "do pedido até aceitar ou recusar" },
            { rotulo: "Prazo médio de entrega", valor: formatarDuracao(entrega), variacao: delta(entrega, entregaAnterior, { bomSeSobe: false }), ajuda: "do pedido até a entrega" },
            { rotulo: "Em carteira", valor: formatarMoeda(a.valorAndamento), ajuda: `${plural(a.andamento, "pedido", "pedidos")} em andamento` },
            { rotulo: "Pedidos recebidos", valor: inteiro(a.total), variacao: b && delta(a.total, b.total) },
            { rotulo: "Ticket médio", valor: a.ticket === null ? "—" : formatarMoeda(a.ticket), variacao: b && delta(a.ticket, b.ticket) },
            { rotulo: "Taxa de aceite", valor: percentual(a.taxaAceite), variacao: b && delta(a.taxaAceite, b.taxaAceite, { tipo: "pontos" }), ajuda: "aceitos ÷ respondidos" },
            { rotulo: "Taxa de cancelamento", valor: percentual(a.taxaCancelamento), variacao: b && delta(a.taxaCancelamento, b.taxaCancelamento, { tipo: "pontos", bomSeSobe: false }) },
            { rotulo: "Clientes ativos", valor: inteiro(a.parceiros), variacao: b && delta(a.parceiros, b.parceiros) },
            { rotulo: "Aguardando sua resposta", valor: inteiro(a.pendentes), ajuda: formatarMoeda(a.valorPendente) }
        ] : [
            { rotulo: "Recebido (entregue)", valor: formatarMoeda(faturado), variacao: delta(faturado, faturadoAnterior, { bomSeSobe: null }), ajuda: "pela data de entrega" },
            { rotulo: "Resposta dos fornecedores", valor: formatarDuracao(resposta), variacao: delta(resposta, respostaAnterior, { bomSeSobe: false }), ajuda: "do pedido até aceitar ou recusar" },
            { rotulo: "Prazo médio de entrega", valor: formatarDuracao(entrega), variacao: delta(entrega, entregaAnterior, { bomSeSobe: false }), ajuda: "do pedido até receber" },
            { rotulo: "Em aberto", valor: formatarMoeda(a.valorAndamento + a.valorPendente), ajuda: `${plural(a.andamento + a.pendentes, "pedido", "pedidos")} a receber` },
            { rotulo: "Pedidos feitos", valor: inteiro(a.total), variacao: b && delta(a.total, b.total, { bomSeSobe: null }) },
            { rotulo: "Ticket médio", valor: a.ticket === null ? "—" : formatarMoeda(a.ticket), variacao: b && delta(a.ticket, b.ticket, { bomSeSobe: null }) },
            { rotulo: "Taxa de cancelamento", valor: percentual(a.taxaCancelamento), variacao: b && delta(a.taxaCancelamento, b.taxaCancelamento, { tipo: "pontos", bomSeSobe: false }) },
            { rotulo: "Fornecedores ativos", valor: inteiro(a.parceiros), variacao: b && delta(a.parceiros, b.parceiros, { bomSeSobe: null }) }
        ];

        el("relKpis").innerHTML = tiles.map(tileKpi).join("");
    }


    /* =====================================================================
       8. RELATÓRIO: EVOLUÇÃO NO TEMPO
       ===================================================================== */

    function granularidade() {
        if (estado.dias !== 0 && estado.dias <= 31) return "dia";
        if (estado.dias !== 0 && estado.dias <= 90) return "semana";
        return "mes";
    }

    function inicioDoBalde(data, tipo) {
        const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
        if (tipo === "semana") {
            const diaSemana = (d.getDay() + 6) % 7; // segunda = 0
            d.setDate(d.getDate() - diaSemana);
        }
        if (tipo === "mes") d.setDate(1);
        return d;
    }

    function avancarBalde(data, tipo) {
        const d = new Date(data);
        if (tipo === "dia") d.setDate(d.getDate() + 1);
        if (tipo === "semana") d.setDate(d.getDate() + 7);
        if (tipo === "mes") d.setMonth(d.getMonth() + 1);
        return d;
    }

    function rotularBalde(data, tipo) {
        const dd = String(data.getDate()).padStart(2, "0");
        const mm = String(data.getMonth() + 1).padStart(2, "0");

        if (tipo === "mes") {
            return {
                curto: `${MESES[data.getMonth()]}/${String(data.getFullYear()).slice(2)}`,
                longo: `${MESES[data.getMonth()]} de ${data.getFullYear()}`
            };
        }

        if (tipo === "semana") {
            const fim = new Date(data);
            fim.setDate(fim.getDate() + 6);
            return {
                curto: `${dd}/${mm}`,
                longo: `Semana de ${dd}/${mm} a ${String(fim.getDate()).padStart(2, "0")}/${String(fim.getMonth() + 1).padStart(2, "0")}`
            };
        }

        return { curto: `${dd}/${mm}`, longo: formatarData(dataLocalISO(data)) };
    }

    function renderizarEvolucao(atual, lista, { inicio, fim }) {
        const vendas = estado.perspectiva === "vendas";
        const tipo = granularidade();
        const porEntrega = estado.serieEvolucao === "entregas";

        // "Pedidos feitos": data do pedido, exceto cancelados.
        // "Faturado/Recebido": pedidos entregues, pela data de entrega.
        const registros = porEntrega
            ? entreguesNoIntervalo(lista, inicio, fim)
            : atual.filter(p => p.statusBanco !== "CANCELADO");
        const dataDe = p => (porEntrega ? p.dataEntrega : p.data);

        const baldes = new Map();
        for (let d = inicioDoBalde(inicio, tipo); d <= fim; d = avancarBalde(d, tipo)) {
            baldes.set(d.getTime(), { data: new Date(d), valor: 0, pedidos: 0 });
        }

        registros.forEach(p => {
            const chave = inicioDoBalde(dataDe(p), tipo).getTime();
            const balde = baldes.get(chave);
            if (balde) {
                balde.valor += p.valor;
                balde.pedidos += 1;
            }
        });

        const pontos = [...baldes.values()].map(b => {
            const rotulos = rotularBalde(b.data, tipo);
            return {
                rotulo: rotulos.curto,
                rotuloLongo: rotulos.longo,
                valor: b.valor,
                pedidos: b.pedidos,
                detalhe: plural(b.pedidos, "pedido", "pedidos")
            };
        });

        const nomeTipo = { dia: "por dia", semana: "por semana", mes: "por mês" }[tipo];
        el("tituloEvolucao").textContent = vendas ? "Evolução das vendas" : "Evolução das compras";
        el("descEvolucao").textContent = porEntrega
            ? `Valor ${vendas ? "faturado" : "recebido"} ${nomeTipo}, pela data de entrega`
            : `Valor dos pedidos feitos ${nomeTipo}, exceto cancelados`;
        el("serieEntregasRotulo").textContent = vendas ? "Faturado" : "Recebido";

        renderizarColunas(el("graficoEvolucao"), pontos, {
            formatar: formatarMoeda,
            formatarEixo: v => (v === 0 ? "0" : moedaCompacta(v).replace("R$", "").trim())
        });

        const colunas = [{ titulo: "Período" }, { titulo: "Pedidos", num: true }, { titulo: "Valor", num: true }];
        const linhas = pontos.map(p => [
            { texto: p.rotuloLongo },
            { texto: inteiro(p.pedidos) },
            { texto: formatarMoeda(p.valor) }
        ]);

        renderizarTabela(el("tabelaEvolucao"), colunas, linhas);
        registrarRelatorio("evolucao", colunas, linhas, `${vendas ? "evolucao-vendas" : "evolucao-compras"}-${porEntrega ? "por-entrega" : "por-pedido"}`);
    }


    /* =====================================================================
       9. RELATÓRIO: FUNIL DE PEDIDOS
       ===================================================================== */

    function renderizarFunil(atual) {
        const vendas = estado.perspectiva === "vendas";
        const m = calcularMetricas(atual);
        const base = m.total || 1;

        const etapas = [
            { rotulo: vendas ? "Recebidos" : "Feitos", valor: m.total, classe: "funil-1" },
            { rotulo: vendas ? "Aceitos" : "Aceitos pelo fornecedor", valor: m.aceitos, classe: "funil-2" },
            { rotulo: "Enviados", valor: m.enviados, classe: "funil-3" },
            { rotulo: vendas ? "Entregues" : "Recebidos", valor: m.entregues, classe: "funil-4" },
            { rotulo: vendas ? "Aguardando resposta" : "Aguardando fornecedor", valor: m.pendentes, classe: "cinza", separadorAntes: true },
            { rotulo: "Cancelados", valor: m.cancelados, classe: "cinza" }
        ].map(etapa => ({
            ...etapa,
            textoValor: `${inteiro(etapa.valor)} · ${percentual(etapa.valor / base)}`,
            detalhe: "percentual sobre o total de pedidos do período"
        }));

        el("tituloFunil").textContent = vendas ? "Funil de pedidos" : "Status das compras";
        el("descFunil").textContent = m.total
            ? `${plural(m.total, "pedido", "pedidos")} no período; cada etapa inclui as seguintes`
            : "Nenhum pedido no período";

        if (m.total === 0) {
            el("graficoFunil").innerHTML = `<p class="rel-vazio">Nenhum pedido no período selecionado.</p>`;
        } else {
            renderizarBarras(el("graficoFunil"), etapas, { maximo: m.total });
        }

        const colunas = [{ titulo: "Etapa" }, { titulo: "Pedidos", num: true }, { titulo: "% do total", num: true }];
        const linhas = m.total ? etapas.map(e => [
            { texto: e.rotulo },
            { texto: inteiro(e.valor) },
            { texto: percentual(e.valor / base) }
        ]) : [];

        renderizarTabela(el("tabelaFunil"), colunas, linhas);
        registrarRelatorio("funil", colunas, linhas, vendas ? "funil-vendas" : "status-compras");
    }


    /* =====================================================================
       10. RELATÓRIO: CATEGORIAS
       ===================================================================== */

    function agrupar(lista, chave) {
        const grupos = new Map();

        lista.forEach(p => {
            const id = chave(p);
            const grupo = grupos.get(id) || { itens: [], valor: 0, quantidade: 0 };
            grupo.itens.push(p);
            grupo.valor += p.valor;
            grupo.quantidade += p.quantidade;
            grupos.set(id, grupo);
        });

        return grupos;
    }

    function renderizarCategorias(atual) {
        const vendas = estado.perspectiva === "vendas";
        const validos = atual.filter(p => p.statusBanco !== "CANCELADO");
        const total = soma(validos);

        const categorias = [...agrupar(validos, p => p.categoria).entries()]
            .map(([nome, g]) => ({ nome, valor: g.valor, pedidos: g.itens.length }))
            .sort((a, b) => b.valor - a.valor);

        // Até 6 categorias + "Outras" (cinza)
        const principais = categorias.slice(0, 6);
        const resto = categorias.slice(6);
        if (resto.length) {
            principais.push({
                nome: `Outras (${resto.length})`,
                valor: resto.reduce((t, c) => t + c.valor, 0),
                pedidos: resto.reduce((t, c) => t + c.pedidos, 0),
                outras: true
            });
        }

        el("descCategorias").textContent = vendas
            ? "Participação de cada categoria no valor vendido"
            : "Onde está concentrado o seu gasto";

        renderizarBarras(el("graficoCategorias"), principais.map(c => ({
            rotulo: c.nome,
            valor: c.valor,
            classe: c.outras ? "cinza" : "",
            textoValor: `${moedaCompacta(c.valor)} · ${percentual(total ? c.valor / total : 0)}`,
            detalhe: plural(c.pedidos, "pedido", "pedidos")
        })));

        const colunas = [{ titulo: "Categoria" }, { titulo: "Pedidos", num: true }, { titulo: "Valor", num: true }, { titulo: "% do total", num: true }];
        const linhas = categorias.map(c => [
            { texto: c.nome },
            { texto: inteiro(c.pedidos) },
            { texto: formatarMoeda(c.valor) },
            { texto: percentual(total ? c.valor / total : 0, 1) }
        ]);

        renderizarTabela(el("tabelaCategorias"), colunas, linhas);
        registrarRelatorio("categorias", colunas, linhas, vendas ? "categorias-vendas" : "categorias-compras");
    }


    /* =====================================================================
       11. RELATÓRIO: PRODUTOS (CURVA ABC)
       A = itens que somam até 80% do valor; B = até 95%; C = restante.
       ===================================================================== */

    function renderizarProdutos(atual) {
        const vendas = estado.perspectiva === "vendas";
        const validos = atual.filter(p => p.statusBanco !== "CANCELADO");
        const total = soma(validos);

        let acumulado = 0;
        const produtos = [...agrupar(validos, p => p.idProduto).values()]
            .map(g => ({
                nome: g.itens[0].produtoNome,
                parceiro: vendas ? null : g.itens[0].fornecedorNome,
                valor: g.valor,
                quantidade: g.quantidade,
                pedidos: g.itens.length
            }))
            .sort((a, b) => b.valor - a.valor)
            .map(p => {
                const inicioFaixa = total ? acumulado / total : 0;
                acumulado += p.valor;
                const classe = inicioFaixa < 0.8 ? "A" : inicioFaixa < 0.95 ? "B" : "C";
                return { ...p, classe, participacao: total ? p.valor / total : 0 };
            });

        const contagem = { A: 0, B: 0, C: 0 };
        produtos.forEach(p => { contagem[p.classe] += 1; });

        el("tituloProdutos").textContent = vendas ? "Produtos mais vendidos · Curva ABC" : "Produtos mais comprados · Curva ABC";
        el("descProdutos").textContent = produtos.length
            ? `A: ${contagem.A} produto(s) somam ~80% do valor · B: ${contagem.B} · C: ${contagem.C}`
            : "Nenhum produto no período";

        renderizarBarras(el("graficoProdutos"), produtos.slice(0, 8).map(p => ({
            rotulo: p.nome,
            valor: p.valor,
            textoValor: moedaCompacta(p.valor),
            detalhe: `${inteiro(p.quantidade)} un. em ${plural(p.pedidos, "pedido", "pedidos")} · classe ${p.classe}`
        })));

        const colunas = [
            { titulo: "Produto" },
            ...(vendas ? [] : [{ titulo: "Fornecedor" }]),
            { titulo: "Classe" },
            { titulo: "Qtd.", num: true },
            { titulo: "Pedidos", num: true },
            { titulo: "Valor", num: true },
            { titulo: "% do total", num: true }
        ];

        const linhas = produtos.map(p => [
            { texto: p.nome },
            ...(vendas ? [] : [{ texto: p.parceiro }]),
            { texto: p.classe, html: `<span class="rel-abc ${p.classe === "A" ? "a" : ""}" title="Classe ${p.classe}">${p.classe}</span>` },
            { texto: inteiro(p.quantidade) },
            { texto: inteiro(p.pedidos) },
            { texto: formatarMoeda(p.valor) },
            { texto: percentual(p.participacao, 1) }
        ]);

        renderizarTabela(el("tabelaProdutos"), colunas, linhas);
        registrarRelatorio("produtos", colunas, linhas, vendas ? "curva-abc-vendas" : "curva-abc-compras");
    }


    /* =====================================================================
       12. RELATÓRIO: CLIENTES / FORNECEDORES
       ===================================================================== */

    function renderizarParceiros(atual, { inicio }) {
        const vendas = estado.perspectiva === "vendas";
        const chave = vendas ? "idUsuario" : "idFornecedor";
        const nomeDe = p => (vendas ? p.compradorNome : p.fornecedorNome);
        const validos = atual.filter(p => p.statusBanco !== "CANCELADO");
        const total = soma(validos);

        // Histórico completo da perspectiva: define "novo" x "recorrente"
        const historico = pedidosDaPerspectiva().filter(p => p.statusBanco !== "CANCELADO");

        const parceiros = [...agrupar(validos, p => p[chave]).entries()]
            .map(([id, g]) => {
                const anteriores = historico.filter(p => p[chave] === id && p.data < inicio).length;
                const ultimo = g.itens.reduce((max, p) => (p.data > max ? p.data : max), g.itens[0].data);
                return {
                    nome: nomeDe(g.itens[0]),
                    valor: g.valor,
                    pedidos: g.itens.length,
                    ticket: g.valor / g.itens.length,
                    ultimo,
                    tipo: anteriores > 0 ? "Recorrente" : "Novo"
                };
            })
            .sort((a, b) => b.valor - a.valor);

        el("tituloParceiros").textContent = vendas ? "Carteira de clientes" : "Fornecedores";
        el("descParceiros").textContent = vendas
            ? "Quem mais compra de você, ticket médio e recorrência"
            : "Com quem você mais gasta e frequência de compra";

        // Insight de concentração (risco de dependência)
        if (parceiros.length >= 2 && total > 0) {
            const top = parceiros.slice(0, 3);
            const fatia = top.reduce((t, p) => t + p.valor, 0) / total;
            const novos = parceiros.filter(p => p.tipo === "Novo").length;
            const texto = vendas
                ? `Os ${top.length} principais clientes respondem por <strong>${percentual(fatia)}</strong> do valor vendido${fatia >= 0.6 ? " — alta dependência: vale prospectar novos compradores" : ""}. ${plural(novos, "cliente novo", "clientes novos")} no período.`
                : `Os ${top.length} principais fornecedores concentram <strong>${percentual(fatia)}</strong> do seu gasto${fatia >= 0.6 ? " — considere cotar com outros fornecedores para reduzir risco" : ""}. ${plural(novos, "fornecedor novo", "fornecedores novos")} no período.`;
            el("insightParceiros").innerHTML = texto;
        } else {
            el("insightParceiros").innerHTML = "";
        }

        renderizarBarras(el("graficoParceiros"), parceiros.slice(0, 8).map(p => ({
            rotulo: p.nome,
            valor: p.valor,
            textoValor: moedaCompacta(p.valor),
            detalhe: `${plural(p.pedidos, "pedido", "pedidos")} · ${p.tipo.toLowerCase()}`
        })));

        const colunas = [
            { titulo: vendas ? "Cliente" : "Fornecedor" },
            { titulo: "Tipo" },
            { titulo: "Pedidos", num: true },
            { titulo: "Ticket médio", num: true },
            { titulo: "Valor", num: true },
            { titulo: "% do total", num: true },
            { titulo: "Último pedido", num: true }
        ];

        const linhas = parceiros.map(p => [
            { texto: p.nome },
            { texto: p.tipo },
            { texto: inteiro(p.pedidos) },
            { texto: formatarMoeda(p.ticket) },
            { texto: formatarMoeda(p.valor) },
            { texto: percentual(total ? p.valor / total : 0, 1) },
            { texto: formatarData(dataLocalISO(p.ultimo)) }
        ]);

        renderizarTabela(el("tabelaParceiros"), colunas, linhas);
        registrarRelatorio("parceiros", colunas, linhas, vendas ? "carteira-clientes" : "fornecedores");
    }


    /* =====================================================================
       13. RELATÓRIO: SAÚDE DO ESTOQUE (somente vendas)
       ===================================================================== */

    const SITUACOES_ESTOQUE = {
        critico: { ordem: 0, icone: "!", rotulo: "Repor já" },
        atencao: { ordem: 1, icone: "!", rotulo: "Atenção" },
        bom: { ordem: 2, icone: "✓", rotulo: "Saudável" },
        parado: { ordem: 3, icone: "–", rotulo: "Sem giro" }
    };

    function renderizarEstoque(atual, { diasPeriodo }) {
        const ativos = produtosProprios.filter(p => p.ativo);

        if (!ativos.length) {
            el("resumoEstoque").innerHTML = "";
            el("tabelaEstoque").innerHTML = `<p class="rel-vazio">Nenhum produto ativo no catálogo. Cadastre produtos no modo Vender do catálogo.</p>`;
            registrarRelatorio("estoque", [], [], "saude-estoque");
            return;
        }

        const vendidoPorProduto = agrupar(
            atual.filter(p => p.statusBanco !== "CANCELADO"),
            p => p.idProduto
        );

        const linhasEstoque = ativos.map(produto => {
            const estoque = Number(produto.quantidade_estoque) || 0;
            const minimo = Number(produto.quantidade_minima) || 1;
            const vendido = vendidoPorProduto.get(produto.id_produto)?.quantidade || 0;
            const mediaDiaria = vendido / diasPeriodo;
            const cobertura = mediaDiaria > 0 ? estoque / mediaDiaria : null;

            let situacao;
            let motivo;

            if (estoque < minimo) {
                situacao = "critico";
                motivo = estoque === 0 ? "sem estoque" : "abaixo do lote mínimo";
            } else if (cobertura === null) {
                situacao = "parado";
                motivo = "sem vendas no período";
            } else if (cobertura < 7) {
                situacao = "critico";
                motivo = "acaba em menos de 7 dias";
            } else if (cobertura < 30) {
                situacao = "atencao";
                motivo = "acaba em menos de 30 dias";
            } else {
                situacao = "bom";
                motivo = "cobertura acima de 30 dias";
            }

            return { nome: produto.nome_produto, estoque, minimo, vendido, mediaDiaria, cobertura, situacao, motivo };
        }).sort((a, b) =>
            SITUACOES_ESTOQUE[a.situacao].ordem - SITUACOES_ESTOQUE[b.situacao].ordem ||
            (a.cobertura ?? Infinity) - (b.cobertura ?? Infinity)
        );

        const contagem = { critico: 0, atencao: 0, bom: 0, parado: 0 };
        linhasEstoque.forEach(l => { contagem[l.situacao] += 1; });

        const selo = situacao => {
            const s = SITUACOES_ESTOQUE[situacao];
            return `<span class="rel-status ${situacao}"><span class="rel-status-icone" aria-hidden="true">${s.icone}</span>${s.rotulo}</span>`;
        };

        el("resumoEstoque").innerHTML = Object.keys(contagem).map(situacao => `
            <span class="rel-chip">${selo(situacao)} <strong>${contagem[situacao]}</strong></span>
        `).join("");

        const colunas = [
            { titulo: "Produto" },
            { titulo: "Situação" },
            { titulo: "Estoque", num: true },
            { titulo: "Lote mín.", num: true },
            { titulo: "Vendido no período", num: true },
            { titulo: "Média/dia", num: true },
            { titulo: "Cobertura", num: true }
        ];

        const linhas = linhasEstoque.map(l => [
            { texto: l.nome },
            { texto: `${SITUACOES_ESTOQUE[l.situacao].rotulo} (${l.motivo})`, html: `${selo(l.situacao)} <span class="rel-kpi-ajuda">${escaparHTML(l.motivo)}</span>` },
            { texto: inteiro(l.estoque) },
            { texto: inteiro(l.minimo) },
            { texto: inteiro(l.vendido) },
            { texto: l.mediaDiaria.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) },
            { texto: l.cobertura === null ? "—" : `${Math.round(l.cobertura)} dias` }
        ]);

        renderizarTabela(el("tabelaEstoque"), colunas, linhas);
        registrarRelatorio("estoque", colunas, linhas, "saude-estoque");
    }


    /* =====================================================================
       14. EXPORTAÇÃO CSV (separador ";" e BOM para abrir certo no Excel)
       ===================================================================== */

    function exportarCSV(chave) {
        const relatorio = relatoriosAtuais[chave];

        if (!relatorio || !relatorio.linhas.length) {
            Swal.fire({ ...window.SERFUtils.swalConfig, title: "Nada para exportar", text: "Este relatório não tem dados no período selecionado.", icon: "info" });
            return;
        }

        const escapar = texto => `"${String(texto ?? "").replace(/"/g, '""')}"`;
        const conteudo = [
            relatorio.colunas.map(c => escapar(c.titulo)).join(";"),
            ...relatorio.linhas.map(linha => linha.map(c => escapar(c.texto)).join(";"))
        ].join("\r\n");

        const periodo = estado.dias === 0 ? "tudo" : `${estado.dias}d`;
        const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8" });
        const link = document.createElement("a");

        link.href = URL.createObjectURL(blob);
        link.download = `serf-${relatorio.arquivo}-${periodo}-${dataLocalISO(new Date())}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
    }


    /* =====================================================================
       15. ORQUESTRAÇÃO
       ===================================================================== */

    function mostrarAviso(titulo, texto) {
        const aviso = el("relAviso");
        aviso.innerHTML = `<strong>${escaparHTML(titulo)}</strong>${escaparHTML(texto)}`;
        aviso.hidden = false;
        el("relConteudo").hidden = true;
    }

    function renderizarTudo() {
        const lista = pedidosDaPerspectiva();
        const periodo = intervalos(lista);
        const atual = filtrarIntervalo(lista, periodo.inicio, periodo.fim);
        const anterior = periodo.anterior ? filtrarIntervalo(lista, periodo.anterior.inicio, periodo.anterior.fim) : null;
        const vendas = estado.perspectiva === "vendas";

        el("relAviso").hidden = true;
        el("relConteudo").hidden = false;

        el("relSubtitulo").textContent = vendas
            ? "Desempenho das suas vendas: faturamento, funil, produtos, clientes e estoque"
            : "Análise das suas compras: gastos, status, produtos e fornecedores";

        el("relPeriodoTexto").textContent = estado.dias === 0
            ? `Desde ${formatarData(dataLocalISO(periodo.inicio))}`
            : `${formatarData(dataLocalISO(periodo.inicio))} a ${formatarData(dataLocalISO(periodo.fim))}`;

        el("descResumo").textContent = anterior
            ? "Indicadores do período comparados ao período anterior de mesma duração"
            : "Indicadores de todo o histórico";

        renderizarResumo(atual, anterior, lista, periodo);
        renderizarEvolucao(atual, lista, periodo);
        renderizarFunil(atual);
        renderizarCategorias(atual);
        renderizarProdutos(atual);
        renderizarParceiros(atual, periodo);

        el("secEstoque").hidden = !vendas;
        if (vendas) renderizarEstoque(atual, periodo);

        el("relRodape").textContent =
            `${plural(atual.length, "pedido", "pedidos")} no período · dados atualizados às ` +
            `${carregadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ` +
            "datas de resposta e entrega registradas pelo banco; pedidos anteriores a esse registro usam a data do pedido como aproximação.";
    }

    function selecionarSegmento(grupo, botaoAtivo) {
        grupo.querySelectorAll(".rel-segmento").forEach(botao => {
            const ativo = botao === botaoAtivo;
            botao.classList.toggle("active", ativo);
            botao.setAttribute("aria-pressed", String(ativo));
        });
    }

    function configurarFiltros() {
        el("filtroPerspectiva").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-perspectiva]");
            if (!botao || botao.dataset.perspectiva === estado.perspectiva) return;

            estado.perspectiva = botao.dataset.perspectiva;
            selecionarSegmento(el("filtroPerspectiva"), botao);
            renderizarTudo();
        });

        el("filtroPeriodoRel").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-dias]");
            if (!botao) return;

            estado.dias = Number(botao.dataset.dias);
            selecionarSegmento(el("filtroPeriodoRel"), botao);
            renderizarTudo();
        });

        // Evolução: pedidos feitos (data do pedido) ↔ faturado/recebido (data de entrega)
        el("serieEvolucao").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-serie]");
            if (!botao || botao.dataset.serie === estado.serieEvolucao) return;

            estado.serieEvolucao = botao.dataset.serie;
            selecionarSegmento(el("serieEvolucao"), botao);
            renderizarTudo();
        });

        // "Ver tabela" ↔ "Ver gráfico"
        document.querySelectorAll("[data-alternar-tabela]").forEach(botao => {
            botao.addEventListener("click", () => {
                const nome = botao.dataset.alternarTabela;
                const sufixo = nome.charAt(0).toUpperCase() + nome.slice(1);
                const grafico = el(`grafico${sufixo}`);
                const tabela = el(`tabela${sufixo}`);
                const mostrarTabela = tabela.hidden;

                tabela.hidden = !mostrarTabela;
                grafico.hidden = mostrarTabela;
                botao.textContent = mostrarTabela ? "Ver gráfico" : "Ver tabela";
            });
        });

        document.querySelectorAll("[data-exportar]").forEach(botao => {
            botao.addEventListener("click", () => exportarCSV(botao.dataset.exportar));
        });

        el("btnImprimir").addEventListener("click", () => window.print());

        // Recalcula os rótulos do eixo X quando a largura muda (ex.: girar o celular)
        let redimensionamento = null;
        let larguraAnterior = window.innerWidth;
        window.addEventListener("resize", () => {
            if (window.innerWidth === larguraAnterior || !carregadoEm || el("relConteudo").hidden) return;
            larguraAnterior = window.innerWidth;
            clearTimeout(redimensionamento);
            redimensionamento = setTimeout(renderizarTudo, 200);
        });

        // Menu lateral em telas menores: js/ui/layout.js
    }

    function exibirEmpresa() {
        let nome = empresa.nome;

        if (!nome) {
            try {
                nome = JSON.parse(localStorage.getItem("usuario_logado") || "{}").razaoSocial;
            } catch (e) { /* cache de exibição */ }
        }

        nome = nome || "Empresa";
        el("empresaAtiva").textContent = nome;

        const avatar = document.querySelector(".profile-avatar");
        if (avatar) avatar.textContent = nome.trim().charAt(0).toUpperCase();
    }

    async function iniciarRelatorios() {
        configurarFiltros();
        configurarTooltip();

        el("relConteudo").classList.add("carregando");

        try {
            await carregarDados();
        } catch (erro) {
            console.error("[SERF:Relatorios] Falha ao carregar dados:", erro);
            exibirEmpresa();
            mostrarAviso("Não foi possível carregar os relatórios.", erro.message || "Erro de comunicação com o Supabase.");
            return;
        } finally {
            el("relConteudo").classList.remove("carregando");
        }

        exibirEmpresa();

        const comprador = empresa.idUsuario !== null;
        const fornecedor = empresa.idFornecedor !== null;

        if (!comprador && !fornecedor) {
            mostrarAviso("Perfil da empresa pendente.", "Conclua a segmentação para acessar os relatórios.");
            return;
        }

        // Perspectiva inicial: vendas para fornecedores; seletor só para "Ambos"
        estado.perspectiva = fornecedor ? "vendas" : "compras";
        el("filtroPerspectivaGrupo").hidden = !(comprador && fornecedor);
        selecionarSegmento(
            el("filtroPerspectiva"),
            el("filtroPerspectiva").querySelector(`[data-perspectiva="${estado.perspectiva}"]`)
        );

        renderizarTudo();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciarRelatorios);
    } else {
        iniciarRelatorios();
    }
})();
