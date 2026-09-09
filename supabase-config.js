// =========================================================================
// S.E.R.F. - CONFIGURAÇÃO CENTRAL
// Único lugar com as credenciais e o único cliente Supabase da aplicação.
//
// Carregue SEMPRE nesta ordem, em toda página:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase-config.js"></script>
//   <script src="auth-guard.js"></script>   (só em páginas protegidas)
//   <script src="app-v2.js"> ou "onboarding.js"</script>
//
// Criar dois clientes na mesma página faz o SDK avisar
// "Multiple GoTrueClient instances detected" e pode embaralhar a sessão.
// Por isso todo mundo usa window.SERF.db.
// =========================================================================

(function () {
  'use strict';

  const SUPABASE_URL = 'https://rparlqdgcwzoanpqqeof.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_6qr9OUA3nojtAt5SJb06TQ_QdumnPbC';

  if (typeof supabase === 'undefined') {
    console.error('[SERF] SDK do Supabase não carregou. Inclua o script do CDN antes deste arquivo.');
    return;
  }

  window.SERF = window.SERF || {};

  // Reaproveita o cliente se outro script já criou.
  window.SERF.db = window.SERF.db || supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  window.SERF.PAGINAS = {
    LOGIN: 'indexfront.html',
    ONBOARDING: 'onboarding.html',
    HOME: 'home.html'
  };

  // Lista fixa de nichos, usada no onboarding e depois nos filtros de busca.
  window.SERF.NICHOS = [
    'Alimentos e bebidas',
    'Embalagens',
    'Limpeza e higiene',
    'Papelaria e escritório',
    'Informática e tecnologia',
    'Móveis e utensílios',
    'Uniformes e têxtil',
    'Construção e reforma',
    'Máquinas e equipamentos',
    'EPI e segurança',
    'Logística e transporte',
    'Serviços profissionais'
  ];

  // Traduz erros técnicos do Postgres/Auth para algo que o lojista entenda.
  window.SERF.traduzirErro = function (erro) {
    const texto = (erro && (erro.message || erro.error_description)) || 'Erro desconhecido.';

    if (/Database error saving new user/i.test(texto)) {
      return 'Já existe uma conta com este CNPJ ou e-mail.';
    }
    if (/duplicate key|already registered|already exists/i.test(texto)) {
      return 'Já existe uma conta com este CNPJ ou e-mail.';
    }
    if (/Invalid login credentials/i.test(texto)) {
      return 'CNPJ ou senha incorretos.';
    }
    if (/Email not confirmed/i.test(texto)) {
      return 'Confirme o e-mail que enviamos antes de entrar.';
    }
    if (/Muitas tentativas/i.test(texto)) {
      return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
    }
    if (/row-level security|violates row-level/i.test(texto)) {
      return 'Sua conta não tem permissão para esta ação.';
    }
    return texto;
  };
})();
