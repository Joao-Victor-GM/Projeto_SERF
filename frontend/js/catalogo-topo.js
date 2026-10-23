// Catálogo: nome da empresa no topo e atalho do perfil (antes era script inline).

document.addEventListener('DOMContentLoaded', () => {
    // Menu responsivo (☰): js/ui/layout.js

    // Exibe nome da empresa do localStorage se disponível
    const usuarioSalvo = localStorage.getItem('usuario_logado');
    if (usuarioSalvo) {
        try {
            const dados = JSON.parse(usuarioSalvo);
            if (dados.razaoSocial) {
                const el = document.getElementById('empresaAtiva');
                if (el) el.textContent = dados.razaoSocial;
                const av = document.querySelector('.profile-avatar');
                if (av) av.textContent = dados.razaoSocial.trim().charAt(0).toUpperCase();
            }
        } catch(e){}
    }

    // Acesso ao perfil corporativo
    const btnPerfil = document.getElementById('btnPerfil');
    if (btnPerfil) {
        btnPerfil.addEventListener('click', () => {
            window.location.href = 'perfil.html';
        });
    }
});
