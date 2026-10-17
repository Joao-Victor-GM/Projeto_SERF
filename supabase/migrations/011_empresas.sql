-- S.E.R.F. - Página "Empresas": vitrine de fornecedores e favoritos
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 008 (usa data_resposta / data_entrega dos pedidos).
-- Pode ser executado mais de uma vez (idempotente).
--
-- O que este script faz:
--   1. View fornecedores_vitrine: dados públicos + reputação AGREGADA de cada
--      fornecedor (taxa de entrega, tempo de resposta, prazo de entrega).
--      Só números consolidados: nenhum pedido, valor ou cliente é exposto.
--   2. Tabela favoritos_fornecedores: cada empresa marca os fornecedores
--      que quer acompanhar (só ela vê e altera os próprios favoritos).


-- ==========================================================
-- 1. VITRINE DE FORNECEDORES
-- A view roda com o dono (postgres) de propósito: o RLS impede que um
-- usuário leia pedidos de outras empresas, então a agregação precisa ser
-- feita aqui, entregando apenas totais. O linter do Supabase mostra
-- "Security Definer View": esperado.
-- ==========================================================

CREATE OR REPLACE VIEW public.fornecedores_vitrine AS
WITH estatisticas AS (
    SELECT pr.id_fornecedor,
           COUNT(*) FILTER (WHERE pe.status_pedido = 'ENTREGUE')                  AS pedidos_entregues,
           COUNT(*) FILTER (WHERE pe.status_pedido = 'CANCELADO')                 AS pedidos_cancelados,
           COUNT(DISTINCT pe.id_usuario) FILTER (WHERE pe.status_pedido <> 'CANCELADO') AS clientes_atendidos,
           AVG(EXTRACT(EPOCH FROM (pe.data_resposta - pe.data_pedido)) / 3600.0)
               FILTER (WHERE pe.data_resposta IS NOT NULL AND pe.data_resposta >= pe.data_pedido)
                                                                                  AS tempo_resposta_horas,
           AVG(EXTRACT(EPOCH FROM (pe.data_entrega - pe.data_pedido)) / 86400.0)
               FILTER (WHERE pe.data_entrega IS NOT NULL AND pe.data_entrega >= pe.data_pedido)
                                                                                  AS prazo_entrega_dias
      FROM public.pedidos pe
      JOIN public.produtos pr ON pr.id_produto = pe.id_produto
     GROUP BY pr.id_fornecedor
),
catalogo AS (
    SELECT id_fornecedor,
           COUNT(*)                     AS produtos_ativos,
           array_agg(DISTINCT categoria) FILTER (WHERE categoria IS NOT NULL) AS categorias,
           MIN(preco_atacado)           AS menor_preco
      FROM public.produtos
     WHERE ativo
     GROUP BY id_fornecedor
)
SELECT f.id_fornecedor,
       f.razao_social,
       f.nome_fantasia,
       f.cidade,
       f.estado,
       f.nicho,
       (f.status_cadastro = 'APROVADO')                         AS homologado,
       f.data_cadastro,
       COALESCE(c.produtos_ativos, 0)                           AS produtos_ativos,
       COALESCE(c.categorias, ARRAY[]::VARCHAR[])               AS categorias,
       c.menor_preco,
       COALESCE(e.pedidos_entregues, 0)                         AS pedidos_entregues,
       COALESCE(e.pedidos_cancelados, 0)                        AS pedidos_cancelados,
       COALESCE(e.clientes_atendidos, 0)                        AS clientes_atendidos,
       CASE WHEN COALESCE(e.pedidos_entregues, 0) + COALESCE(e.pedidos_cancelados, 0) > 0
            THEN round(e.pedidos_entregues::NUMERIC / (e.pedidos_entregues + e.pedidos_cancelados), 4)
       END                                                      AS taxa_entrega,
       round(e.tempo_resposta_horas::NUMERIC, 1)                AS tempo_resposta_horas,
       round(e.prazo_entrega_dias::NUMERIC, 1)                  AS prazo_entrega_dias
  FROM public.fornecedores f
  LEFT JOIN catalogo c     ON c.id_fornecedor = f.id_fornecedor
  LEFT JOIN estatisticas e ON e.id_fornecedor = f.id_fornecedor
 WHERE f.ativo;

REVOKE ALL ON public.fornecedores_vitrine FROM PUBLIC, anon;
GRANT SELECT ON public.fornecedores_vitrine TO authenticated;


-- ==========================================================
-- 2. FAVORITOS
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.favoritos_fornecedores (
    id_favorito BIGINT GENERATED ALWAYS AS IDENTITY,
    auth_user_id UUID NOT NULL DEFAULT auth.uid(),
    id_fornecedor BIGINT NOT NULL,
    data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_favoritos_fornecedores PRIMARY KEY (id_favorito),
    CONSTRAINT uq_favoritos_usuario_fornecedor UNIQUE (auth_user_id, id_fornecedor),

    CONSTRAINT fk_favoritos_auth
        FOREIGN KEY (auth_user_id)
        REFERENCES auth.users (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_favoritos_fornecedores
        FOREIGN KEY (id_fornecedor)
        REFERENCES public.fornecedores (id_fornecedor)
        ON DELETE CASCADE
);

ALTER TABLE public.favoritos_fornecedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS favoritos_select_proprio ON public.favoritos_fornecedores;
CREATE POLICY favoritos_select_proprio
    ON public.favoritos_fornecedores
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS favoritos_insert_proprio ON public.favoritos_fornecedores;
CREATE POLICY favoritos_insert_proprio
    ON public.favoritos_fornecedores
    FOR INSERT
    TO authenticated
    WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS favoritos_delete_proprio ON public.favoritos_fornecedores;
CREATE POLICY favoritos_delete_proprio
    ON public.favoritos_fornecedores
    FOR DELETE
    TO authenticated
    USING (auth_user_id = auth.uid());

REVOKE UPDATE ON public.favoritos_fornecedores FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
