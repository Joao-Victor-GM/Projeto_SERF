-- S.E.R.F. - CORREÇÃO DE SEGURANÇA: escrita pelas views públicas
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 027. APLICAR O QUANTO ANTES em produção.
-- Pode ser executado mais de uma vez (idempotente).
--
-- O problema: os privilégios padrão do Supabase dão ALL (inclusive INSERT,
-- UPDATE e DELETE) a anon/authenticated em tudo o que é criado no schema
-- public, VIEWS inclusive. fornecedores_publicos é uma view simples (uma
-- tabela só), portanto ATUALIZÁVEL, e roda com os privilégios do dono, que
-- ignoram o RLS. Resultado: qualquer empresa logada podia, pela API REST,
--   PATCH  /rest/v1/fornecedores_publicos?id_fornecedor=eq.N  (renomear)
--   DELETE /rest/v1/fornecedores_publicos?id_fornecedor=eq.N  (apagar, com
--          produtos, pedidos, pagamentos e NF-e em cascata)
-- de QUALQUER fornecedor.
--
-- A correção:
--   1. Views só podem ser LIDAS pelo navegador (nenhuma escrita, em nenhuma).
--   2. TRUNCATE/TRIGGER/REFERENCES saem de todas as tabelas para os papéis
--      do navegador (TRUNCATE ignora o RLS; nada no app usa os três).
--   3. pagamento_libera_envio deixa de ser chamável pelo navegador (revelava
--      se o pedido de outra empresa estava pago).
--   4. Os privilégios PADRÃO deixam de conceder isso a objetos futuros.
-- tests/banco/invariantes.sql passa a reprovar qualquer recaída.


-- 1. Views: só leitura (e só para quem tem login)
DO $$
DECLARE
    v RECORD;
BEGIN
    FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', v.viewname);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', v.viewname);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v.viewname);
    END LOOP;
END $$;

-- 2. Tabelas: nada de TRUNCATE/TRIGGER/REFERENCES pelo navegador
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t.tablename);
    END LOOP;
END $$;

-- 3. pagamento_libera_envio(id) respondia a QUALQUER usuário se o pedido de
--    outra empresa estava pago. Só é usada dentro de funções do servidor.
REVOKE ALL ON FUNCTION public.pagamento_libera_envio(BIGINT) FROM PUBLIC, anon, authenticated;

-- 4. Objetos criados daqui em diante já nascem sem esses privilégios
--    (cada migration continua liberando explicitamente o que precisa)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
