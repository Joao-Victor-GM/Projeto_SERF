-- S.E.R.F. - Categorias (segmentos) de produto validadas pelo banco
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 021.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Até aqui a lista oficial só existia no front-end (SERFUtils.CATEGORIAS_PRODUTO):
-- pela API dava para gravar "alimentos" ou "Grãos", e o produto sumia do
-- filtro do Radar e dos e-mails de segmento. Agora:
--   - a tabela categorias guarda a lista oficial (mesma ordem do front;
--     tests/banco/categorias.test.mjs confere as duas);
--   - produtos.categoria e segmentos_interesse.categoria apontam para ela (FK);
--   - categorias antigas fora da lista são convertidas ANTES da FK:
--     mesmo nome ignorando maiúsculas/acentos/espaços → oficial;
--     começa com a primeira palavra de uma oficial ("Alimentos") → oficial;
--     o resto → "Outros". Segmentos que não casam são apagados.
-- Renomear uma categoria (UPDATE categorias SET nome = ...) propaga sozinho.


-- ==========================================================
-- 1. LISTA OFICIAL (leitura pública; só o servidor altera)
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.categorias (
    nome VARCHAR(100) NOT NULL,
    ordem SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT pk_categorias PRIMARY KEY (nome),
    CONSTRAINT ck_categorias_nome CHECK (char_length(btrim(nome)) BETWEEN 1 AND 100)
);

INSERT INTO public.categorias (nome, ordem) VALUES
    ('Metalurgia & Usinagem', 1),
    ('Alimentos & Bebidas', 2),
    ('Construção Civil', 3),
    ('Automotivo & Peças', 4),
    ('Embalagens & Logística', 5),
    ('Tecnologia & Insumos', 6),
    ('Outros', 99)
ON CONFLICT (nome) DO UPDATE SET ordem = EXCLUDED.ordem;

ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categorias_select_todos ON public.categorias;
CREATE POLICY categorias_select_todos ON public.categorias
    FOR SELECT TO anon, authenticated USING (TRUE);

REVOKE INSERT, UPDATE, DELETE ON public.categorias FROM anon, authenticated;


-- ==========================================================
-- 2. CONVERSÃO DOS DADOS ANTIGOS
-- ==========================================================

-- Chave de comparação: minúsculas, sem acentos, sem pontuação/espaços
CREATE OR REPLACE FUNCTION public.chave_categoria(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(
        translate(lower(COALESCE(p_texto, '')),
                  'áàâãäéèêëíìîïóòôõöúùûüç',
                  'aaaaaeeeeiiiiooooouuuuc'),
        '[^a-z0-9]', '', 'g');
$$;

-- Categoria oficial equivalente a um texto livre (NULL se vazio)
CREATE OR REPLACE FUNCTION public.categoria_oficial(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN NULLIF(btrim(p_texto), '') IS NULL THEN NULL
        ELSE COALESCE(
            (SELECT c.nome FROM public.categorias c
              WHERE public.chave_categoria(c.nome) = public.chave_categoria(p_texto)),
            (SELECT c.nome FROM public.categorias c
              WHERE c.nome <> 'Outros'
                AND public.chave_categoria(p_texto) LIKE
                    public.chave_categoria(split_part(c.nome, ' ', 1)) || '%'
              ORDER BY c.ordem LIMIT 1),
            'Outros')
    END;
$$;

DO $$
DECLARE
    v_produtos INT;
    v_segmentos INT;
BEGIN
    UPDATE public.produtos p
       SET categoria = public.categoria_oficial(p.categoria)
     WHERE p.categoria IS DISTINCT FROM public.categoria_oficial(p.categoria);
    GET DIAGNOSTICS v_produtos = ROW_COUNT;

    -- Segmentos: os que têm equivalente viram a oficial (sem duplicar);
    -- os sem equivalente somem (não viram "Outros", que ninguém escolheu)
    INSERT INTO public.segmentos_interesse (auth_user_id, categoria, criado_em)
    SELECT s.auth_user_id, public.categoria_oficial(s.categoria), MIN(s.criado_em)
      FROM public.segmentos_interesse s
     WHERE NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.nome = s.categoria)
       AND public.categoria_oficial(s.categoria) <> 'Outros'
     GROUP BY 1, 2
    ON CONFLICT (auth_user_id, categoria) DO NOTHING;

    DELETE FROM public.segmentos_interesse s
     WHERE NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.nome = s.categoria);
    GET DIAGNOSTICS v_segmentos = ROW_COUNT;

    IF v_produtos > 0 OR v_segmentos > 0 THEN
        RAISE NOTICE '[SERF] Categorias convertidas: % produto(s), % segmento(s).', v_produtos, v_segmentos;
    END IF;
END $$;


-- ==========================================================
-- 3. CHAVES ESTRANGEIRAS
-- ==========================================================

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS fk_produtos_categoria;
ALTER TABLE public.produtos ADD CONSTRAINT fk_produtos_categoria
    FOREIGN KEY (categoria) REFERENCES public.categorias (nome) ON UPDATE CASCADE;

ALTER TABLE public.segmentos_interesse DROP CONSTRAINT IF EXISTS fk_segmentos_categoria;
ALTER TABLE public.segmentos_interesse ADD CONSTRAINT fk_segmentos_categoria
    FOREIGN KEY (categoria) REFERENCES public.categorias (nome) ON UPDATE CASCADE ON DELETE CASCADE;


-- ==========================================================
-- 4. definir_segmentos: segmento desconhecido vira mensagem clara
-- (em vez do erro técnico da FK)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.definir_segmentos(p_categorias TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_limpas TEXT[];
    v_desconhecida TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sessão expirada. Faça login novamente.';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT btrim(c)), ARRAY[]::TEXT[])
      INTO v_limpas
      FROM unnest(COALESCE(p_categorias, ARRAY[]::TEXT[])) AS c
     WHERE NULLIF(btrim(c), '') IS NOT NULL;

    IF array_length(v_limpas, 1) > 20 THEN
        RAISE EXCEPTION 'Escolha no máximo 20 segmentos.';
    END IF;

    SELECT c INTO v_desconhecida
      FROM unnest(v_limpas) AS c
     WHERE NOT EXISTS (SELECT 1 FROM public.categorias k WHERE k.nome = c)
     LIMIT 1;

    IF v_desconhecida IS NOT NULL THEN
        RAISE EXCEPTION 'Segmento desconhecido: %. Atualize a página e tente de novo.', v_desconhecida;
    END IF;

    DELETE FROM public.segmentos_interesse
     WHERE auth_user_id = v_uid
       AND NOT (categoria = ANY (v_limpas));

    INSERT INTO public.segmentos_interesse (auth_user_id, categoria)
    SELECT v_uid, c FROM unnest(v_limpas) AS c
    ON CONFLICT (auth_user_id, categoria) DO NOTHING;

    RETURN v_limpas;
END;
$$;

REVOKE ALL ON FUNCTION public.definir_segmentos(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_segmentos(TEXT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
