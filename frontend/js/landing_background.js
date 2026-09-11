/* =========================================================
   SERF - REDE ANIMADA GLOBAL

   Responsável pela animação de fundo de toda a Landing.

   A rede possui:
   - partículas em movimento;
   - mais conexões simultâneas;
   - pontos com brilho;
   - interação sutil com o mouse.

   A ideia visual é representar empresas criando conexões
   dentro da rede SERF.
========================================================= */


/* =========================================================
   CANVAS
========================================================= */

const canvasLanding =
    document.getElementById("landing-background");

const ctxLanding =
    canvasLanding.getContext("2d");

let larguraLanding;
let alturaLanding;


/* =========================================================
   CONFIGURAÇÕES DA REDE GLOBAL

   Mais partículas, porém menores e mais discretas.
========================================================= */

let quantidadeLanding = 115;

/* Distância para criação das linhas */
const distanciaConexao = 120;

/* Movimento lento para manter aparência corporativa */
const velocidadeBase = 0.18;

// Lista que guarda todas as partículas
const particulasLanding = [];


/* =========================================================
   POSIÇÃO DO MOUSE
   Cria uma interação discreta com a rede.
========================================================= */

const mouseLanding = {
    x: null,
    y: null,
    raio: 170
};


/* =========================================================
   AJUSTAR CANVAS
========================================================= */

function ajustarCanvasLanding() {

    larguraLanding = window.innerWidth;
    alturaLanding = window.innerHeight;

    canvasLanding.width = larguraLanding;
    canvasLanding.height = alturaLanding;

    // Menos partículas em telas menores
    // para preservar o desempenho.

    if (larguraLanding < 700) {

        quantidadeLanding = 45;

    } else if (larguraLanding < 1100) {

        quantidadeLanding = 65;

    } else {

        quantidadeLanding = 85;

    }
}


/* =========================================================
   PARTÍCULA
========================================================= */

class ParticulaLanding {

    constructor() {

        this.x =
            Math.random() *
            larguraLanding;

        this.y =
            Math.random() *
            alturaLanding;


        this.velocidadeX =
            (Math.random() - 0.5) *
            velocidadeBase;

        this.velocidadeY =
            (Math.random() - 0.5) *
            velocidadeBase;


        // Tamanho dos pontos
        /* Pontos menores deixam a rede mais técnica e discreta */

        this.raio =
            (Math.random() *
                0.55 +
                0.45);
    }


    /* =====================================================
       MOVIMENTO
    ====================================================== */

    atualizar() {

        this.x +=
            this.velocidadeX;

        this.y +=
            this.velocidadeY;


        /* -----------------------------------------
           INTERAÇÃO COM O MOUSE
        ----------------------------------------- */

        if (
            mouseLanding.x !== null &&
            mouseLanding.y !== null
        ) {

            const dx =
                mouseLanding.x -
                this.x;

            const dy =
                mouseLanding.y -
                this.y;


            const distancia =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );


            // Quando a partícula está próxima do mouse,
            // ela se aproxima levemente dele.

            if (
                distancia <
                mouseLanding.raio &&
                distancia > 0
            ) {

                const forca =
                    (
                        mouseLanding.raio -
                        distancia
                    ) /
                    mouseLanding.raio;


                this.x +=
                    (
                        dx /
                        distancia
                    ) *
                    forca *
                    0.18;


                this.y +=
                    (
                        dy /
                        distancia
                    ) *
                    forca *
                    0.18;
            }
        }


        /* -----------------------------------------
           REPOSICIONAMENTO NAS BORDAS

           Quando um ponto sai da tela,
           ele reaparece no lado oposto.
        ----------------------------------------- */

        if (
            this.x >
            larguraLanding
        ) {

            this.x = 0;
        }


        if (
            this.x < 0
        ) {

            this.x =
                larguraLanding;
        }


        if (
            this.y >
            alturaLanding
        ) {

            this.y = 0;
        }


        if (
            this.y < 0
        ) {

            this.y =
                alturaLanding;
        }
    }


    /* =====================================================
       DESENHO DA PARTÍCULA
    ====================================================== */

    desenhar() {


        // -----------------------------------------
        // HALO EXTERNO
        // -----------------------------------------

        ctxLanding.beginPath();


        ctxLanding.arc(
            this.x,
            this.y,
            this.raio * 2.5,
            0,
            Math.PI * 2
        );


        ctxLanding.fillStyle =
            "rgba(255, 255, 255, 0.045)";


        ctxLanding.fill();



        // -----------------------------------------
        // PONTO PRINCIPAL
        // -----------------------------------------

        ctxLanding.beginPath();


        ctxLanding.arc(
            this.x,
            this.y,
            this.raio,
            0,
            Math.PI * 2
        );


        // Brilho do ponto

        ctxLanding.shadowColor =
            "rgba(255, 255, 255, 0.80)";

        ctxLanding.shadowBlur =
            4;


        ctxLanding.fillStyle =
            "rgba(255, 255, 255, 0.62)";


        ctxLanding.fill();


        // Remove sombra dos próximos elementos

        ctxLanding.shadowBlur =
            0;
    }

}


/* =========================================================
   CRIAR PARTÍCULAS
========================================================= */
/* =========================================================
   CRIAR PARTÍCULAS COM DISTRIBUIÇÃO EQUILIBRADA

   Em vez de posicionar todos os pontos de forma totalmente
   aleatória, dividimos a tela em uma grade invisível.

   Cada célula recebe aproximadamente uma partícula.
   Isso reduz grandes espaços vazios sem criar um padrão rígido.
========================================================= */

function criarParticulasLanding() {

    particulasLanding.length = 0;


    /* Quantidade aproximada de colunas */

    const colunas =
        Math.ceil(
            Math.sqrt(
                quantidadeLanding *
                (
                    larguraLanding /
                    alturaLanding
                )
            )
        );


    /* Quantidade de linhas */

    const linhas =
        Math.ceil(
            quantidadeLanding /
            colunas
        );


    /* Tamanho de cada espaço da grade */

    const larguraCelula =
        larguraLanding /
        colunas;

    const alturaCelula =
        alturaLanding /
        linhas;


    let contador = 0;


    for (
        let linha = 0;
        linha < linhas;
        linha++
    ) {

        for (
            let coluna = 0;
            coluna < colunas;
            coluna++
        ) {

            if (
                contador >=
                quantidadeLanding
            ) {
                return;
            }


            const particula =
                new ParticulaLanding();


            /*
               Colocamos o ponto próximo ao centro da célula,
               com uma pequena variação aleatória.
            */

            particula.x =
                coluna *
                larguraCelula +
                larguraCelula *
                (
                    0.25 +
                    Math.random() *
                    0.50
                );


            particula.y =
                linha *
                alturaCelula +
                alturaCelula *
                (
                    0.25 +
                    Math.random() *
                    0.50
                );


            particulasLanding.push(
                particula
            );


            contador++;
        }
    }
}

function conectarParticulasLanding() {


    for (
        let i = 0;
        i < particulasLanding.length;
        i++
    ) {


        for (
            let j = i + 1;
            j < particulasLanding.length;
            j++
        ) {


            const dx =
                particulasLanding[i].x -
                particulasLanding[j].x;


            const dy =
                particulasLanding[i].y -
                particulasLanding[j].y;


            const distancia =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );


            if (
                distancia <
                distanciaConexao
            ) {


                // Quanto mais próximos,
                // mais forte fica a linha.

                const intensidade =
                    1 -
                    distancia /
                    distanciaConexao;


                ctxLanding.beginPath();


                ctxLanding.moveTo(
                    particulasLanding[i].x,
                    particulasLanding[i].y
                );


                ctxLanding.lineTo(
                    particulasLanding[j].x,
                    particulasLanding[j].y
                );


                ctxLanding.strokeStyle =
                    `rgba(
                        255,
                        255,
                        255,
                        ${intensidade * 0.18}
                    )`;


                ctxLanding.lineWidth =
                    0.45;


                ctxLanding.stroke();
            }
        }
    }
}


/* =========================================================
   CONEXÕES COM O CURSOR

   As partículas próximas do mouse também criam
   linhas em tom laranja.

   Isso reforça a ideia de interação e oportunidade.
========================================================= */

function conectarMouseLanding() {


    if (
        mouseLanding.x === null ||
        mouseLanding.y === null
    ) {

        return;

    }


    particulasLanding.forEach(
        (particula) => {


            const dx =
                mouseLanding.x -
                particula.x;


            const dy =
                mouseLanding.y -
                particula.y;


            const distancia =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );


            if (
                distancia <
                mouseLanding.raio
            ) {


                const intensidade =
                    1 -
                    distancia /
                    mouseLanding.raio;


                ctxLanding.beginPath();


                ctxLanding.moveTo(
                    particula.x,
                    particula.y
                );


                ctxLanding.lineTo(
                    mouseLanding.x,
                    mouseLanding.y
                );


                ctxLanding.strokeStyle =
                    `rgba(
                        244,
                        122,
                        32,
                        ${intensidade * 0.11}
                    )`;


                ctxLanding.lineWidth =
                    0.8;


                ctxLanding.stroke();
            }
        }
    );
}


/* =========================================================
   LOOP PRINCIPAL

   Executa continuamente:

   1. limpa o Canvas;
   2. movimenta os pontos;
   3. desenha os pontos;
   4. cria conexões;
   5. cria interação com mouse;
   6. solicita o próximo quadro.
========================================================= */

function animarLandingBackground() {


    ctxLanding.clearRect(
        0,
        0,
        larguraLanding,
        alturaLanding
    );


    particulasLanding.forEach(
        (particula) => {


            particula.atualizar();

            particula.desenhar();

        }
    );


    conectarParticulasLanding();

    conectarMouseLanding();


    requestAnimationFrame(
        animarLandingBackground
    );
}


/* =========================================================
   EVENTOS DO MOUSE
========================================================= */

window.addEventListener(
    "mousemove",
    (evento) => {


        mouseLanding.x =
            evento.clientX;


        mouseLanding.y =
            evento.clientY;

    }
);


/* Quando o mouse sai da janela,
   removemos a posição armazenada. */

window.addEventListener(
    "mouseleave",
    () => {


        mouseLanding.x =
            null;


        mouseLanding.y =
            null;

    }
);


/* =========================================================
   RESPONSIVIDADE

   Quando a janela muda de tamanho,
   ajustamos o Canvas e recriamos os pontos.
========================================================= */

window.addEventListener(
    "resize",
    () => {


        ajustarCanvasLanding();

        criarParticulasLanding();

    }
);


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

ajustarCanvasLanding();

criarParticulasLanding();

animarLandingBackground();