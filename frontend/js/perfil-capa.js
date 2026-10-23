// Perfil: botão "Editar dados" e partículas da capa (antes era script inline).

document.addEventListener('DOMContentLoaded', () => {
    // Menu responsivo (☰): js/ui/layout.js

    // "Editar dados" abre a aba de dados cadastrais
    const btnEditar = document.getElementById('btnEditarPerfil');
    if (btnEditar) {
        btnEditar.addEventListener('click', () => {
            const abaDados = document.querySelector('.profile-tab-btn[data-tab="dados"]');
            if (abaDados) {
                abaDados.click();
                abaDados.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    // Partículas laranjas na capa, mesma identidade do login
    if (typeof particlesJS === 'function') {
        particlesJS('perfilParticles', {
            particles: {
                number: { value: 45, density: { enable: true, value_area: 700 } },
                color: { value: '#F47A20' },
                shape: { type: 'circle' },
                opacity: { value: 0.6, random: true },
                size: { value: 2.2, random: true },
                line_linked: { enable: true, distance: 130, color: '#F47A20', opacity: 0.3, width: 1 },
                move: { enable: true, speed: 1.2, random: true, out_mode: 'out' }
            },
            interactivity: {
                detect_on: 'canvas',
                events: { onhover: { enable: true, mode: 'grab' }, onclick: { enable: false }, resize: true },
                modes: { grab: { distance: 120, line_linked: { opacity: 0.6 } } }
            },
            retina_detect: true
        });
    }
});
