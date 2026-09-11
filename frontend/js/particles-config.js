/* =========================================================
   SERF - PARTÍCULAS DO HERO
   Cria e movimenta partículas no fundo da seção principal.
   ========================================================= */

// Localiza o canvas criado no HTML
const canvas = document.getElementById("hero-particles");

// Permite desenhar dentro do canvas
const ctx = canvas.getContext("2d");

// Lista que armazenará todas as partículas
const particulas = [];

// Quantidade máxima de partículas
const QUANTIDADE_PARTICULAS = 45;


// Ajusta o tamanho interno do canvas ao tamanho do Hero
function ajustarCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}


// Representa uma partícula
class Particula {

    constructor() {

        // Posição inicial aleatória
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;

        // Tamanho
        this.raio = Math.random() * 1.5 + 0.5;

        // Velocidade
        this.velocidadeX = (Math.random() - 0.5) * 0.4;
        this.velocidadeY = (Math.random() - 0.5) * 0.4;
    }

    atualizar() {

        this.x += this.velocidadeX;
        this.y += this.velocidadeY;

        // Faz a partícula retornar ao ultrapassar as bordas
        if (this.x < 0 || this.x > canvas.width) {
            this.velocidadeX *= -1;
        }

        if (this.y < 0 || this.y > canvas.height) {
            this.velocidadeY *= -1;
        }
    }

    desenhar() {

        ctx.beginPath();

        ctx.arc(
            this.x,
            this.y,
            this.raio,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
        ctx.fill();
    }
}


// Cria as partículas apenas uma vez
function criarParticulas() {

    particulas.length = 0;

    for (let i = 0; i < QUANTIDADE_PARTICULAS; i++) {
        particulas.push(new Particula());
    }
}


// Cria conexões entre partículas próximas
function conectarParticulas() {

    for (let i = 0; i < particulas.length; i++) {

        for (let j = i + 1; j < particulas.length; j++) {

            const distanciaX = particulas[i].x - particulas[j].x;
            const distanciaY = particulas[i].y - particulas[j].y;

            const distancia = Math.sqrt(
                distanciaX * distanciaX +
                distanciaY * distanciaY
            );

            if (distancia < 120) {

                ctx.beginPath();

                ctx.moveTo(
                    particulas[i].x,
                    particulas[i].y
                );

                ctx.lineTo(
                    particulas[j].x,
                    particulas[j].y
                );

                ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
                ctx.lineWidth = 1;

                ctx.stroke();
            }
        }
    }
}


// Mantém a animação funcionando
function animar() {

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particulas.forEach(function(particula) {
        particula.atualizar();
        particula.desenhar();
    });

    conectarParticulas();

    requestAnimationFrame(animar);
}


// Reajusta o canvas quando a janela mudar de tamanho
window.addEventListener("resize", ajustarCanvas);


// Inicialização
ajustarCanvas();
criarParticulas();
animar();

particlesJS("particles-js", {
  "particles": {
    "number": {
      "value": 70, // Quantidade equilibrada para não poluir a tela
      "density": {
        "enable": true,
        "value_area": 800
      }
    },
    "color": {
      "value": "#ff8c00" // Laranja oficial do SERF
    },
    "shape": {
      "type": "circle"
    },
    "opacity": {
      "value": 0.5, // Partículas normais ficam mais discretas no fundo
      "random": true
    },
    "size": {
      "value": 3.5, // Nós de conexão com tamanho elegante
      "random": true
    },
    "line_linked": {
      "enable": true,
      "distance": 140,
      "color": "#ff8c00", // Conexões laranjas
      "opacity": 0.25, // Linhas de fundo bem suaves para não cansar a vista
      "width": 1
    },
    "move": {
      "enable": true,
      "speed": 1.8, // Movimentação de fundo lenta e flutuante ("devagar")
      "direction": "none",
      "random": true,
      "straight": false,
      "out_mode": "out",
      "bounce": false
    }
  },
  "interactivity": {
    "detect_on": "window", // 🔥 CORREÇÃO CRÍTICA: Detecta o mouse mesmo por cima do card de login!
    "events": {
      "onhover": {
        "enable": true,
        "mode": "grab" // Ativa a teia de conexões no cursor
      },
      "onclick": {
        "enable": true,
        "mode": "push"
      },
      "resize": true
    },
    "modes": {
      "grab": {
        "distance": 180, // Distância confortável para atração
        "line_linked": {
          "opacity": 0.75 // As linhas acendem gradualmente e brilham ao conectar com o mouse
        }
      }
    }
  },
  "retina_detect": true
});