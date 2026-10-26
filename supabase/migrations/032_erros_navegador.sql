-- S.E.R.F. - Monitoramento de erros do navegador
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 031.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Antes: um erro de JavaScript na tela de um usuário não chegava a ninguém.
-- Agora js/monitor-erros.js registra aqui os erros das páginas internas
-- (sem serviço externo: os dados ficam no próprio Supabase, LGPD).
--
--   - Só quem tem login grava, e só em nome próprio. Ninguém lê pela API:
--     a consulta é pelo painel (SQL Editor / Table Editor), por exemplo
--       SELECT * FROM public.erros_resumo;
--   - Mesmo erro do mesmo usuário em 1 hora: soma em "quantidade" (não
--     cria linha nova). No máximo 30 erros diferentes por usuário por hora.
--   - Erros com mais de 30 dias são apagados sozinhos.
--   - Só o caminho da página (sem ?parâmetros, que podem ter tokens).


-- ==========================================================
-- 1. TABELA
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.erros_navegador (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    auth_user_id UUID NOT NULL DEFAULT auth.uid(),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quantidade INT NOT NULL DEFAULT 1,
    pagina VARCHAR(200) NOT NULL,
    mensagem VARCHAR(500) NOT NULL,
    origem VARCHAR(300),
    pilha VARCHAR(4000),
    navegador VARCHAR(300),
    versao VARCHAR(40),

    CONSTRAINT pk_erros_navegador PRIMARY KEY (id),
    CONSTRAINT fk_erros_navegador_auth FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    -- Caminho de página do site, sem query string nem domínio
    CONSTRAINT ck_erros_navegador_pagina CHECK (pagina ~ '^/[A-Za-z0-9/_.-]*$')
);

CREATE INDEX IF NOT EXISTS idx_erros_navegador_usuario ON public.erros_navegador (auth_user_id, ultimo_em DESC);
CREATE INDEX IF NOT EXISTS idx_erros_navegador_data ON public.erros_navegador (criado_em);

ALTER TABLE public.erros_navegador ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erros_navegador_insert_proprio ON public.erros_navegador;
CREATE POLICY erros_navegador_insert_proprio ON public.erros_navegador
    FOR INSERT TO authenticated
    WITH CHECK (auth_user_id = (SELECT auth.uid()));

-- Só INSERT, e só das colunas do relato (data, contador e dono são do banco)
REVOKE ALL ON public.erros_navegador FROM PUBLIC, anon, authenticated;
GRANT INSERT (pagina, mensagem, origem, pilha, navegador, versao) ON public.erros_navegador TO authenticated;


-- ==========================================================
-- 2. AGRUPAR, LIMITAR E LIMPAR (antes de cada INSERT)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.erros_navegador_registrar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existente BIGINT;
BEGIN
    NEW.auth_user_id := auth.uid();
    NEW.criado_em := NOW();
    NEW.ultimo_em := NOW();
    NEW.quantidade := 1;

    -- Mesmo erro, mesmo usuário, na última hora: só conta mais uma vez
    SELECT id INTO v_existente
      FROM public.erros_navegador
     WHERE auth_user_id = NEW.auth_user_id
       AND mensagem = NEW.mensagem
       AND pagina = NEW.pagina
       AND ultimo_em > NOW() - INTERVAL '1 hour'
     ORDER BY ultimo_em DESC
     LIMIT 1;

    IF v_existente IS NOT NULL THEN
        UPDATE public.erros_navegador
           SET quantidade = LEAST(quantidade + 1, 1000000), ultimo_em = NOW()
         WHERE id = v_existente;
        RETURN NULL;   -- não cria linha nova (e não é erro para o navegador)
    END IF;

    -- Teto por usuário: descarta em silêncio (o navegador não reage a isso)
    IF (SELECT COUNT(*) FROM public.erros_navegador
         WHERE auth_user_id = NEW.auth_user_id AND criado_em > NOW() - INTERVAL '1 hour') >= 30 THEN
        RETURN NULL;
    END IF;

    -- Retenção de 30 dias, sem depender do pg_cron
    DELETE FROM public.erros_navegador WHERE criado_em < NOW() - INTERVAL '30 days';

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_erros_navegador_registrar ON public.erros_navegador;
CREATE TRIGGER trg_erros_navegador_registrar
    BEFORE INSERT ON public.erros_navegador
    FOR EACH ROW
    EXECUTE FUNCTION public.erros_navegador_registrar();


-- ==========================================================
-- 3. RESUMO PARA O PAINEL (só SQL Editor / Table Editor)
-- ==========================================================

CREATE OR REPLACE VIEW public.erros_resumo AS
SELECT mensagem,
       pagina,
       SUM(quantidade)              AS ocorrencias,
       COUNT(DISTINCT auth_user_id) AS usuarios,
       MIN(criado_em)               AS primeira_vez,
       MAX(ultimo_em)               AS ultima_vez,
       (array_agg(origem ORDER BY ultimo_em DESC))[1]    AS origem,
       (array_agg(navegador ORDER BY ultimo_em DESC))[1] AS navegador
  FROM public.erros_navegador
 WHERE ultimo_em > NOW() - INTERVAL '7 days'
 GROUP BY mensagem, pagina
 ORDER BY MAX(ultimo_em) DESC;

-- View ignora o RLS: ninguém pela API (só o painel, como dono)
REVOKE ALL ON public.erros_resumo FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
