-- S.E.R.F. - Ampliação dos nichos/segmentos (base IBGE CNAE 2.0) e nicho personalizado ("Outros")
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 032.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Referência oficial de classificação setorial:
--   IBGE / CONCLA — CNAE 2.0 (Classificação Nacional de Atividades Econômicas),
--   mesma base utilizada pela Receita Federal no cartão CNPJ das empresas.
--
-- O que este script faz:
--   1. Amplia a tabela oficial `public.categorias` de 7 para 16 segmentos B2B
--      cobrindo indústria de transformação, comércio atacadista, construção,
--      agro e serviços empresariais (mantendo intactos os nomes anteriores e
--      "Outros" na posição 99).
--   2. Higieniza valores em branco de `nicho` em `usuarios` e `fornecedores`
--      e impede gravação de string vazia ou só com espaços.
--   3. Atualiza `atualizar_segmentacao_usuario` para normalizar espaços e
--      validar tamanho (até 100 caracteres) com mensagem amigável quando a
--      empresa escolhe "Outros" e escreve seu próprio ramo de atividade.


-- ==========================================================
-- 1. SEGMENTOS OFICIAIS BASEADOS NA CNAE 2.0 (IBGE)
-- ==========================================================

INSERT INTO public.categorias (nome, ordem) VALUES
    ('Metalurgia & Usinagem', 1),          -- CNAE Seção C (Div. 24–25)
    ('Alimentos & Bebidas', 2),            -- CNAE Seção C (Div. 10–11) / G (46.3)
    ('Construção Civil', 3),               -- CNAE Seção F (Div. 41–43) / G (46.7)
    ('Automotivo & Peças', 4),             -- CNAE Seção C (Div. 29) / G (45)
    ('Embalagens & Logística', 5),         -- CNAE Seção C (Div. 17) / H (Div. 49–52)
    ('Tecnologia & Insumos', 6),           -- CNAE Seção C (Div. 26) / J (Div. 62–63)
    ('Química & Plásticos', 7),            -- CNAE Seção C (Div. 20, 22)
    ('Máquinas & Ferramentas', 8),         -- CNAE Seção C (Div. 28, 33) / G (46.6)
    ('Elétrica & Automação', 9),           -- CNAE Seção C (Div. 27) / D (Div. 35)
    ('Têxtil & EPIs', 10),                 -- CNAE Seção C (Div. 13–15, 32.9)
    ('Saúde & Higiene Profissional', 11),  -- CNAE Seção C (20.6, 21) / Q (Div. 86)
    ('Papelaria & Gráfica', 12),           -- CNAE Seção C (Div. 17–18) / G (46.47)
    ('Móveis & Equipamentos', 13),         -- CNAE Seção C (Div. 31) / G (46.65)
    ('Agro & Jardinagem', 14),             -- CNAE Seção A (Div. 01) / G (46.2)
    ('Serviços & Manutenção B2B', 15),     -- CNAE Seção M (Div. 69–74) / N (Div. 77–82)
    ('Outros', 99)                         -- Demais divisões CNAE (permite especificar no cadastro)
ON CONFLICT (nome) DO UPDATE SET ordem = EXCLUDED.ordem;


-- ==========================================================
-- 2. INTEGRIDADE DO CAMPO NICHO (ACEITA LISTA OFICIAL OU TEXTO LIVRE)
-- ==========================================================

UPDATE public.usuarios
   SET nicho = NULLIF(regexp_replace(btrim(nicho), '\s+', ' ', 'g'), '')
 WHERE nicho IS NOT NULL
   AND nicho IS DISTINCT FROM NULLIF(regexp_replace(btrim(nicho), '\s+', ' ', 'g'), '');

UPDATE public.fornecedores
   SET nicho = NULLIF(regexp_replace(btrim(nicho), '\s+', ' ', 'g'), '')
 WHERE nicho IS NOT NULL
   AND nicho IS DISTINCT FROM NULLIF(regexp_replace(btrim(nicho), '\s+', ' ', 'g'), '');

ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_nicho_valido;
ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_nicho_valido
    CHECK (nicho IS NULL OR char_length(btrim(nicho)) BETWEEN 1 AND 100);

ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS ck_fornecedores_nicho_valido;
ALTER TABLE public.fornecedores ADD CONSTRAINT ck_fornecedores_nicho_valido
    CHECK (nicho IS NULL OR char_length(btrim(nicho)) BETWEEN 1 AND 100);


-- ==========================================================
-- 3. RPC atualizar_segmentacao_usuario COM SUPORTE A NICHO PERSONALIZADO
-- ==========================================================

CREATE OR REPLACE FUNCTION public.atualizar_segmentacao_usuario(p_perfil TEXT, p_nicho TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid           UUID := auth.uid();
    v_nicho         TEXT := NULLIF(regexp_replace(btrim(COALESCE(p_nicho, '')), '\s+', ' ', 'g'), '');
    v_id_usuario    BIGINT;
    v_id_fornecedor BIGINT;
    v_razao         TEXT;
    v_cnpj          TEXT;
    v_email         TEXT;
    v_responsavel   TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sessão expirada. Faça login novamente.';
    END IF;

    IF p_perfil NOT IN ('Comprador', 'Fornecedor', 'Ambos') THEN
        RAISE EXCEPTION 'Perfil inválido: %.', p_perfil;
    END IF;

    IF v_nicho IS NULL THEN
        RAISE EXCEPTION 'Selecione ou digite o nicho de atuação da empresa.';
    END IF;

    IF char_length(v_nicho) > 100 THEN
        RAISE EXCEPTION 'O nicho de atuação deve ter no máximo 100 caracteres.';
    END IF;

    -- Dados atuais da empresa (comprador → fornecedor → metadados do cadastro)
    SELECT id_usuario, nome_empresa, cnpj, email, nome_responsavel
      INTO v_id_usuario, v_razao, v_cnpj, v_email, v_responsavel
      FROM public.usuarios
     WHERE auth_user_id = v_uid;

    SELECT id_fornecedor INTO v_id_fornecedor
      FROM public.fornecedores
     WHERE auth_user_id = v_uid;

    IF v_cnpj IS NULL THEN
        SELECT razao_social, cnpj, email
          INTO v_razao, v_cnpj, v_email
          FROM public.fornecedores
         WHERE auth_user_id = v_uid;
    END IF;

    IF v_cnpj IS NULL THEN
        SELECT raw_user_meta_data ->> 'razao_social',
               regexp_replace(COALESCE(raw_user_meta_data ->> 'cnpj', ''), '\D', '', 'g'),
               email
          INTO v_razao, v_cnpj, v_email
          FROM auth.users
         WHERE id = v_uid;
    END IF;

    IF v_razao IS NULL OR v_cnpj IS NULL OR length(v_cnpj) <> 14 THEN
        RAISE EXCEPTION 'Cadastro da empresa incompleto (CNPJ ou razão social).';
    END IF;

    -- Papel de COMPRADOR (tabela usuarios)
    IF p_perfil IN ('Comprador', 'Ambos') THEN
        IF v_id_usuario IS NULL THEN
            INSERT INTO public.usuarios (auth_user_id, nome_empresa, cnpj, nome_responsavel, email, nicho)
            VALUES (v_uid, v_razao, v_cnpj, COALESCE(v_responsavel, v_razao), v_email, v_nicho);
        ELSE
            UPDATE public.usuarios SET nicho = v_nicho WHERE id_usuario = v_id_usuario;
        END IF;
    ELSIF v_id_usuario IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.pedidos WHERE id_usuario = v_id_usuario) THEN
            RAISE EXCEPTION 'A empresa já possui pedidos de compra. Escolha o perfil "Ambos".';
        END IF;
        DELETE FROM public.usuarios WHERE id_usuario = v_id_usuario;
    END IF;

    -- Papel de FORNECEDOR (tabela fornecedores)
    IF p_perfil IN ('Fornecedor', 'Ambos') THEN
        IF v_id_fornecedor IS NULL THEN
            INSERT INTO public.fornecedores (auth_user_id, razao_social, cnpj, email, nicho)
            VALUES (v_uid, v_razao, v_cnpj, v_email, v_nicho);
        ELSE
            UPDATE public.fornecedores SET nicho = v_nicho WHERE id_fornecedor = v_id_fornecedor;
        END IF;
    ELSIF v_id_fornecedor IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.produtos WHERE id_fornecedor = v_id_fornecedor) THEN
            RAISE EXCEPTION 'A empresa já possui produtos cadastrados. Escolha o perfil "Ambos".';
        END IF;
        DELETE FROM public.fornecedores WHERE id_fornecedor = v_id_fornecedor;
    END IF;

    -- Conclui o onboarding na mesma transação
    UPDATE auth.users
       SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
           || jsonb_build_object('segmentacao_concluida', true, 'perfil', p_perfil, 'nicho', v_nicho)
     WHERE id = v_uid;

    RETURN p_perfil;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_segmentacao_usuario(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atualizar_segmentacao_usuario(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

