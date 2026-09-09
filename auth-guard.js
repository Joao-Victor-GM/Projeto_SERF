// =========================================================================
// S.E.R.F. - AUTH GUARD (SCRUM-11)
// Middleware leve para páginas protegidas.
//
// Como usar, sempre nesta ordem e antes dos scripts da página:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase-config.js"></script>
//   <script src="auth-guard.js"></script>
//
// Regras:
//   sem sessão                     -> indexfront.html
//   com sessão + onboarding falso  -> onboarding.html
//   com sessão + onboarding ok     -> libera a página
//
// Ao liberar, o guard expõe window.SERF_SESSAO e dispara o evento
// 'serf:autorizado', para a página só carregar dados depois da checagem.
// =========================================================================

(function () {
  'use strict';

  if (!window.SERF || !window.SERF.db) {
    console.error('[auth-guard] supabase-config.js precisa ser carregado antes deste arquivo.');
    return;
  }

  const cliente = window.SERF.db;
  const PAGINA_LOGIN = window.SERF.PAGINAS.LOGIN;
  const PAGINA_ONBOARDING = window.SERF.PAGINAS.ONBOARDING;

  // Páginas que exigem login mas não devem cair no loop de onboarding.
  const ISENTAS_DE_ONBOARDING = ['onboarding.html', 'redefinir-senha.html'];

  const paginaAtual = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

  // ------------------------------------------------- esconder conteúdo
  // Evita o "flash" da página protegida enquanto a sessão é verificada.
  const raiz = document.documentElement;
  raiz.style.visibility = 'hidden';

  let liberado = false;

  function liberarTela() {
    liberado = true;
    raiz.style.visibility = '';
  }

  // Rede lenta não pode deixar a tela em branco para sempre.
  const salvaVidas = setTimeout(() => {
    if (!liberado) {
      console.warn('[auth-guard] Verificação demorou demais. Exibindo a página.');
      liberarTela();
    }
  }, 8000);

  function redirecionar(destino) {
    clearTimeout(salvaVidas);
    // replace evita que o botão "voltar" retorne à página bloqueada.
    window.location.replace(destino);
  }

  // ------------------------------------------------- verificação
  async function verificar() {
    try {
      const { data: { session }, error } = await cliente.auth.getSession();

      if (error) throw error;

      if (!session) {
        redirecionar(PAGINA_LOGIN);
        return;
      }

      const userId = session.user.id;

      if (ISENTAS_DE_ONBOARDING.includes(paginaAtual)) {
        finalizar(session, null);
        return;
      }

      const [comprador, fornecedor] = await Promise.all([
        cliente.from('usuarios')
          .select('auth_user_id, onboarding_completo')
          .eq('auth_user_id', userId)
          .maybeSingle(),
        cliente.from('fornecedores')
          .select('auth_user_id, onboarding_completo')
          .eq('auth_user_id', userId)
          .maybeSingle()
      ]);

      const registros = [comprador.data, fornecedor.data].filter(Boolean);

      // Conta autenticada sem registro de empresa: o cadastro não terminou.
      if (registros.length === 0) {
        redirecionar(PAGINA_ONBOARDING);
        return;
      }

      // No perfil híbrido, basta um dos perfis pendente para voltar ao onboarding.
      const pendente = registros.some((r) => r.onboarding_completo !== true);

      if (pendente) {
        redirecionar(PAGINA_ONBOARDING);
        return;
      }

      finalizar(session, {
        comprador: Boolean(comprador.data),
        fornecedor: Boolean(fornecedor.data)
      });
    } catch (erro) {
      console.error('[auth-guard] Falha ao validar a sessão:', erro);
      redirecionar(PAGINA_LOGIN);
    }
  }

  function finalizar(session, perfis) {
    clearTimeout(salvaVidas);

    window.SERF_SESSAO = {
      userId: session.user.id,
      email: session.user.email,
      perfis: perfis
    };

    liberarTela();
    document.dispatchEvent(new CustomEvent('serf:autorizado', { detail: window.SERF_SESSAO }));
  }

  // Se o usuário sair em outra aba, esta também volta para o login.
  cliente.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') redirecionar(PAGINA_LOGIN);
  });

  verificar();
})();
