/* =========================================================
   SERF - REDE BRASIL
   Expansão da rede pelas 27 unidades federativas
========================================================= */


// =========================================================
// CANVAS
// =========================================================

const canvasBrasil =
    document.getElementById("brasil-particles");

const ctxBrasil =
    canvasBrasil.getContext("2d");

let larguraBrasil;
let alturaBrasil;


// =========================================================
// PONTOS DO MAPA
//
// Coordenadas aproximadas para posicionamento visual
// dentro da silhueta do Brasil.
//
// x = posição horizontal
// y = posição vertical
// =========================================================

const pontosBrasil = {

    // NORTE
    ac: { x: 0.25, y: 0.41 },
    am: { x: 0.35, y: 0.30 },
    rr: { x: 0.39, y: 0.14 },
    ro: { x: 0.34, y: 0.44 },
    pa: { x: 0.51, y: 0.29 },
    ap: { x: 0.55, y: 0.17 },
    to: { x: 0.55, y: 0.39 },

    // NORDESTE
    ma: { x: 0.61, y: 0.29 },
    pi: { x: 0.65, y: 0.34 },
    ce: { x: 0.70, y: 0.30 },
    rn: { x: 0.75, y: 0.31 },
    pb: { x: 0.74, y: 0.34 },
    pe: { x: 0.71, y: 0.37 },
    al: { x: 0.71, y: 0.40 },
    se: { x: 0.69, y: 0.43 },
    ba: { x: 0.63, y: 0.45 },

    // CENTRO-OESTE
    mt: { x: 0.45, y: 0.43 },
    ms: { x: 0.47, y: 0.59 },
    go: { x: 0.54, y: 0.51 },
    df: { x: 0.57, y: 0.49 },

    // SUDESTE
    mg: { x: 0.61, y: 0.56 },
    es: { x: 0.69, y: 0.56 },
    rj: { x: 0.66, y: 0.63 },
    sp: { x: 0.58, y: 0.64 },

    // SUL
    pr: { x: 0.55, y: 0.70 },
    sc: { x: 0.56, y: 0.76 },
    rs: { x: 0.53, y: 0.83 }

};


// =========================================================
// ETAPAS DA EXPANSÃO
//
// Começamos em SP.
//
// 1 ponto
// ↓
// 2
// ↓
// 4
// ↓
// 8
// ↓
// 16
// ↓
// 27 UFs
// =========================================================

const etapasBrasil = [

    // ETAPA 1
    [
        ["sp", "pr"]
    ],


    // ETAPA 2
    [
        ["sp", "mg"],
        ["pr", "sc"]
    ],


    // ETAPA 3
    [
        ["sp", "rj"],
        ["mg", "go"],
        ["pr", "ms"],
        ["sc", "rs"]
    ],


    // ETAPA 4
    [
        ["rj", "es"],
        ["mg", "ba"],
        ["go", "df"],
        ["go", "mt"],
        ["ms", "ro"],
        ["ba", "se"],
        ["ba", "pe"],
        ["mg", "to"]
    ],


    // ETAPA 5
    // Completa as 27 UFs
    [
        ["ro", "ac"],
        ["mt", "am"],
        ["am", "rr"],

        ["to", "pa"],
        ["pa", "ap"],

        ["to", "ma"],
        ["ma", "pi"],
        ["pi", "ce"],

        ["pe", "al"],
        ["pe", "pb"],
        ["ce", "rn"]
    ],
    
    // ETAPA FINAL
    // Conexões extras para preencher melhor o mapa
    [
        ["sp", "go"],
        ["sp", "mg"],
        ["mg", "df"],
        ["mg", "es"],
        ["go", "to"],

        ["mt", "pa"],
        ["mt", "am"],
        ["am", "pa"],
        ["am", "rr"],

        ["pa", "ma"],
        ["to", "ma"],
        ["to", "ba"],

        ["ba", "pe"],
        ["ba", "se"],
        ["pe", "ce"],
        ["ce", "rn"],
        ["pe", "pb"],

        ["sp", "ms"],
        ["pr", "ms"],
        ["pr", "sc"]
    ]
];


// =========================================================
// CONTROLE DA ANIMAÇÃO
// =========================================================

let etapaAtualBrasil = 0;

let progressoEtapaBrasil = 0;

let conexoesConcluidasBrasil = [];

let pontosAtivosBrasil =
    new Set(["sp"]);

let aguardandoReinicioBrasil = false;


// =========================================================
// AJUSTAR CANVAS
// =========================================================

function ajustarCanvasBrasil() {

    larguraBrasil =
        canvasBrasil.offsetWidth;

    alturaBrasil =
        canvasBrasil.offsetHeight;


    // Telas de alta densidade (retina): desenha em resolução real,
    // mas continua trabalhando em pixels CSS (larguraBrasil/alturaBrasil).
    const densidade =
        window.devicePixelRatio || 1;

    canvasBrasil.width =
        Math.round(larguraBrasil * densidade);

    canvasBrasil.height =
        Math.round(alturaBrasil * densidade);

    ctxBrasil.setTransform(
        densidade, 0, 0, densidade, 0, 0
    );
}

// =========================================================
// POSIÇÃO DOS PONTOS NO MAPA
//
// Além de converter as coordenadas em pixels,
// aplicamos uma pequena compactação.
//
// Isso evita que pontos fiquem em cima das bordas
// ou escapem da silhueta do Brasil.
// =========================================================

function posicaoBrasil(nome) {

    const ponto =
        pontosBrasil[nome];


    // Centro aproximado da área do mapa
    const centroX = 0.51;
    const centroY = 0.49;


    // Quanto menor, mais os pontos são puxados
    // para dentro do mapa.
    //
    // 1.00 = posição original
    // 0.90 = compactação leve
    // 0.84 = compactação maior
    const escala = 0.86;


    const xCompactado =
        centroX +
        (ponto.x - centroX) *
        escala;


    const yCompactado =
        centroY +
        (ponto.y - centroY) *
        escala;


    return {

        x:
            xCompactado *
            larguraBrasil,

        y:
            yCompactado *
            alturaBrasil

    };
}

// =========================================================
// DESENHAR PONTO
// =========================================================

function desenharPontoBrasil(
    nome,
    ativo = false
) {

    const ponto =
        posicaoBrasil(nome);


    // PONTO ATIVO
    if (ativo) {

        // Halo bem pequeno
        ctxBrasil.beginPath();

        ctxBrasil.arc(
            ponto.x,
            ponto.y,
            5,
            0,
            Math.PI * 2
        );

        ctxBrasil.fillStyle =
            "rgba(244, 122, 32, 0.16)";

        ctxBrasil.fill();
    }


    // Ponto principal
    ctxBrasil.beginPath();

    ctxBrasil.arc(
        ponto.x,
        ponto.y,

        ativo ? 2.4 : 1.3,

        0,
        Math.PI * 2
    );


    ctxBrasil.fillStyle =
        ativo
            ? "#F47A20"
            : "rgba(244, 122, 32, 0.42)";


    ctxBrasil.fill();
}


// =========================================================
// CALCULAR CURVA
//
// A curva agora é mais discreta.
// Isso reduz o risco de sair da silhueta.
// =========================================================

function calcularPosicaoCurvaBrasil(
    origem,
    destino,
    progresso
) {

    const inicio =
        posicaoBrasil(origem);

    const fim =
        posicaoBrasil(destino);


    const meioX =
        (inicio.x + fim.x) / 2;

    const meioY =
        (inicio.y + fim.y) / 2;


    // Distância entre os pontos
    const distancia =
        Math.hypot(
            fim.x - inicio.x,
            fim.y - inicio.y
        );


    // Curvatura limitada
    const curva =
        Math.min(
            12,
            distancia * 0.06
        );


    const controleX =
        meioX;

    const controleY =
        meioY - curva;


    const t =
        progresso;


    const x =
        (1 - t) * (1 - t) * inicio.x +
        2 * (1 - t) * t * controleX +
        t * t * fim.x;


    const y =
        (1 - t) * (1 - t) * inicio.y +
        2 * (1 - t) * t * controleY +
        t * t * fim.y;


    return { x, y };
}


// =========================================================
// DESENHAR CONEXÃO CONCLUÍDA
// =========================================================

function desenharConexaoBrasil(
    origem,
    destino
) {

    const inicio =
        posicaoBrasil(origem);

    const fim =
        posicaoBrasil(destino);


    const meioX =
        (inicio.x + fim.x) / 2;

    const meioY =
        (inicio.y + fim.y) / 2;


    const distancia =
        Math.hypot(
            fim.x - inicio.x,
            fim.y - inicio.y
        );


    const curva =
        Math.min(
            12,
            distancia * 0.06
        );


    ctxBrasil.beginPath();

    ctxBrasil.moveTo(
        inicio.x,
        inicio.y
    );


    ctxBrasil.quadraticCurveTo(
        meioX,
        meioY - curva,
        fim.x,
        fim.y
    );


    ctxBrasil.strokeStyle =
        "rgba(244, 122, 32, 0.68)";


    ctxBrasil.lineWidth =
        1.15;


    ctxBrasil.stroke();
}


// =========================================================
// BOLINHA + RASTRO
// =========================================================

function desenharBolinhaBrasil(
    origem,
    destino,
    progresso
) {

    // =====================================================
    // RASTRO
    // =====================================================

    const quantidadeRastro =
        4;


    for (
        let i = quantidadeRastro;
        i >= 1;
        i--
    ) {

        const atraso =
            i * 0.025;


        const progressoRastro =
            Math.max(
                0,
                progresso - atraso
            );


        const rastro =
            calcularPosicaoCurvaBrasil(
                origem,
                destino,
                progressoRastro
            );


        ctxBrasil.beginPath();


        ctxBrasil.arc(
            rastro.x,
            rastro.y,
            1.5 - i * 0.18,
            0,
            Math.PI * 2
        );


        ctxBrasil.fillStyle =
            `rgba(244, 122, 32, ${0.40 - i * 0.06})`;


        ctxBrasil.fill();
    }


    // =====================================================
    // PARTÍCULA PRINCIPAL
    // =====================================================

    const atual =
        calcularPosicaoCurvaBrasil(
            origem,
            destino,
            progresso
        );


    // Halo
    ctxBrasil.beginPath();

    ctxBrasil.arc(
        atual.x,
        atual.y,
        4.5,
        0,
        Math.PI * 2
    );

    ctxBrasil.fillStyle =
        "rgba(244, 122, 32, 0.15)";

    ctxBrasil.fill();


    // Bolinha
    ctxBrasil.beginPath();

    ctxBrasil.arc(
        atual.x,
        atual.y,
        2,
        0,
        Math.PI * 2
    );


    ctxBrasil.shadowColor =
        "#F47A20";

    ctxBrasil.shadowBlur =
        7;


    ctxBrasil.fillStyle =
        "#FFFFFF";


    ctxBrasil.fill();


    // Remove sombra
    ctxBrasil.shadowBlur = 0;
}


// =========================================================
// REINICIAR
// =========================================================

function reiniciarRedeBrasil() {

    etapaAtualBrasil = 0;

    progressoEtapaBrasil = 0;

    conexoesConcluidasBrasil = [];

    pontosAtivosBrasil =
        new Set(["sp"]);

    aguardandoReinicioBrasil =
        false;
}


// =========================================================
// LOOP PRINCIPAL
// =========================================================

function animarRedeBrasil() {

    ctxBrasil.clearRect(
        0,
        0,
        larguraBrasil,
        alturaBrasil
    );


    // =====================================================
    // TODOS OS PONTOS
    // =====================================================

    Object
        .keys(pontosBrasil)
        .forEach((nome) => {

            desenharPontoBrasil(
                nome,
                pontosAtivosBrasil.has(nome)
            );

        });


    // =====================================================
    // CONEXÕES JÁ CONCLUÍDAS
    // =====================================================

    conexoesConcluidasBrasil.forEach(
        (conexao) => {

            desenharConexaoBrasil(
                conexao[0],
                conexao[1]
            );

        }
    );


    // =====================================================
    // ETAPA ATUAL
    // =====================================================

    if (
        etapaAtualBrasil <
        etapasBrasil.length
    ) {

        const etapa =
            etapasBrasil[
                etapaAtualBrasil
            ];


        // Todas as conexões da etapa
        // são animadas simultaneamente
        etapa.forEach(
            (conexao) => {

                desenharBolinhaBrasil(
                    conexao[0],
                    conexao[1],
                    progressoEtapaBrasil
                );

            }
        );


        // Velocidade
        progressoEtapaBrasil +=
            0.014;


        // =================================================
        // ETAPA TERMINOU
        // =================================================

        if (
            progressoEtapaBrasil >= 1
        ) {

            etapa.forEach(
                (conexao) => {

                    conexoesConcluidasBrasil.push(
                        conexao
                    );


                    // Origem e destino permanecem acesos
                    pontosAtivosBrasil.add(
                        conexao[0]
                    );

                    pontosAtivosBrasil.add(
                        conexao[1]
                    );

                }
            );


            etapaAtualBrasil++;

            progressoEtapaBrasil = 0;
        }

    }


    // =====================================================
    // REDE COMPLETA
    // =====================================================

    else if (
        !aguardandoReinicioBrasil &&
        !movimentoReduzidoBrasil
    ) {

        aguardandoReinicioBrasil =
            true;


        setTimeout(
            reiniciarRedeBrasil,
            4500
        );

    }


    agendarRedeBrasil();
}


// =========================================================
// QUANDO ANIMAR
// Só com o mapa na tela e sem "reduzir movimento": a página é
// longa e o mapa fica a maior parte do tempo fora de vista.
// =========================================================

const preferenciaMovimentoBrasil =
    window.matchMedia("(prefers-reduced-motion: reduce)");

let movimentoReduzidoBrasil =
    preferenciaMovimentoBrasil.matches;


// "Reduzir movimento": em vez do primeiro quadro (só SP aceso, que
// parece quebrado), mostra a rede COMPLETA, parada — a mesma mensagem
// ("o Brasil todo conectado"), sem animação.
function completarRedeBrasil() {

    conexoesConcluidasBrasil =
        etapasBrasil.flat();

    pontosAtivosBrasil =
        new Set(Object.keys(pontosBrasil));

    etapaAtualBrasil =
        etapasBrasil.length;

    progressoEtapaBrasil = 0;

    aguardandoReinicioBrasil = false;
}


// A preferência pode mudar com a página aberta (Configurações do sistema)
preferenciaMovimentoBrasil.addEventListener(
    "change",
    (evento) => {

        movimentoReduzidoBrasil =
            evento.matches;

        if (movimentoReduzidoBrasil) {
            completarRedeBrasil();
            animarRedeBrasil();         // desenha o quadro estático
        } else {
            reiniciarRedeBrasil();
            agendarRedeBrasil();        // volta a animar do começo
        }
    }
);

let mapaVisivelBrasil = true;
let quadroAgendadoBrasil = false;

function agendarRedeBrasil() {

    if (movimentoReduzidoBrasil || !mapaVisivelBrasil || quadroAgendadoBrasil) {
        return;
    }

    quadroAgendadoBrasil = true;

    requestAnimationFrame(() => {
        quadroAgendadoBrasil = false;
        animarRedeBrasil();
    });
}

if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entrada]) => {
        mapaVisivelBrasil = entrada.isIntersecting;
        agendarRedeBrasil();   // retoma ao voltar para a tela
    }).observe(canvasBrasil);
}


// =========================================================
// RESPONSIVIDADE
// =========================================================

// Remede sempre que a área do mapa mudar de tamanho (layout inicial,
// rotação do celular, redimensionamento) — não só no resize da janela.
// Com animação parada ("reduzir movimento"), redesenha o quadro estático.
if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
        ajustarCanvasBrasil();
        if (movimentoReduzidoBrasil) animarRedeBrasil();
    }).observe(canvasBrasil);
} else {
    window.addEventListener(
        "resize",
        ajustarCanvasBrasil
    );
}


// =========================================================
// INICIALIZAÇÃO
// =========================================================

ajustarCanvasBrasil();

if (movimentoReduzidoBrasil) {
    completarRedeBrasil();
}

animarRedeBrasil();