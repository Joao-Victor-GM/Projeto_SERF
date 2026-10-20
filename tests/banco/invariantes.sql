-- Invariantes de segurança do banco. Rodam:
--   - no banco em memória dos testes (tests/banco/invariantes.test.mjs);
--   - no Postgres do Supabase de verdade, na CI (job "supabase-real").
-- Qualquer violação interrompe com a lista do que está errado.

DO $$
DECLARE
    v_lista TEXT;
BEGIN
    -- 1. Toda tabela do schema public tem RLS ligado
    SELECT string_agg(tablename, ', ' ORDER BY tablename) INTO v_lista
      FROM pg_tables
     WHERE schemaname = 'public' AND NOT rowsecurity;

    IF v_lista IS NOT NULL THEN
        RAISE EXCEPTION 'Tabelas sem RLS: %', v_lista;
    END IF;

    -- 2. Toda função SECURITY DEFINER fixa o search_path (senão um objeto
    --    criado em outro schema pode ser executado com os privilégios dela)
    SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_lista
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS c WHERE c LIKE 'search_path=%');

    IF v_lista IS NOT NULL THEN
        RAISE EXCEPTION 'SECURITY DEFINER sem search_path fixo: %', v_lista;
    END IF;

    -- 3. Funções só do servidor (Edge Functions / triggers) não são
    --    executáveis por anon nem authenticated
    SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_lista
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('anonimizar_conta', 'pedidos_em_andamento_da_conta', 'registrar_cobranca_pix',
                         'confirmar_pagamento_provedor', 'registrar_nfe_enviada', 'atualizar_nfe_provedor',
                         'reservar_emails', 'notificar', 'enfileirar_email', 'enfileirar_somente_email',
                         'limpar_notificacoes_antigas')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

    IF v_lista IS NOT NULL THEN
        RAISE EXCEPTION 'Funções só-servidor executáveis pelo navegador: %', v_lista;
    END IF;

    -- 4. Visitante sem login (anon) não escreve em tabela nenhuma: nenhuma
    --    política de INSERT/UPDATE/DELETE vale para anon (ou para todos)
    SELECT string_agg(DISTINCT pp.tablename || ':' || pp.cmd, ', ') INTO v_lista
      FROM pg_policies pp
     WHERE pp.schemaname = 'public'
       AND ('anon' = ANY (pp.roles) OR 'public' = ANY (pp.roles))
       AND pp.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

    IF v_lista IS NOT NULL THEN
        RAISE EXCEPTION 'Políticas que deixam visitante sem login escrever: %', v_lista;
    END IF;
END $$;
