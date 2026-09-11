particlesJS("particles-js", {
  "particles": {
    "number": {
      "value": 60, // Quantidade equilibrada para não poluir a tela
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
      "value": 2, // Nós de conexão com tamanho elegante
      "random": true
    },
    "line_linked": {
      "enable": true,
      "distance": 160,
      "color": "#ff8c00", // Conexões laranjas
      "opacity": 0.25, // Linhas de fundo bem suaves para não cansar a vista
      "width": 1
    },
    "move": {
      "enable": true,
      "speed": 1.5, // Movimentação de fundo lenta e flutuante ("devagar")
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
        "enable": false,
        "mode": "push"
      },
      "resize": true
    },
    "modes": {
      "grab": {
        "distance": 115, // Distância confortável para atração
        "line_linked": {
          "opacity": 0.50 // As linhas acendem gradualmente e brilham ao conectar com o mouse
        }
      }
    }
  },
  "retina_detect": true
});