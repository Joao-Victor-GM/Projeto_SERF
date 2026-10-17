-- S.E.R.F. - Desempenho: Radar de Oportunidades e alertas de mensagens
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 016.
-- Pode ser executado mais de uma vez (idempotente).
--
-- 1. FORNECEDOR_NICHO deixa de ler a view fornecedores_vitrine, que agrega
--    TODOS os pedidos de TODOS os fornecedores a cada consulta (o radar
--    consulta a cada 2 min por usuário: custo crescia com a plataforma
--    inteira). A função fornecedores_do_nicho() calcula só o necessário
--    (produtos ativos e menor preço) e só para o nicho da empresa.
--    O resultado é idêntico (mesmas colunas e regras da 016).
-- 2. Índice parcial para mensagens não lidas (alerta MENSAGENS e contadores).


-- ==========================================================
-- 1. FORNECEDORES DO NICHO (sem agregar pedidos)
-- SECURITY DEFINER: lê status_cadastro/data_cadastro, que o RLS de
-- fornecedores esconde; expõe só dados comerciais (como a vitrine).
-- ==========================================================

CREATE OR REPLACE FUNCTION public.fornecedores_do_nicho(p_nicho TEXT)
RETURNS TABLE (
    id_fornecedor   BIGINT,
    razao_social    VARCHAR,
    nome_fantasia   VARCHAR,
    cidade          VARCHAR,
    estado          CHAR(2),
    homologado      BOOLEAN,
    data_cadastro   TIMESTAMPTZ,
    produtos_ativos BIGINT,
    menor_preco     NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT f.id_fornecedor, f.razao_social, f.nome_fantasia, f.cidade, f.estado,
           f.status_cadastro = 'APROVADO', f.data_cadastro,
           COUNT(pr.id_produto), MIN(pr.preco_atacado)
      FROM public.fornecedores f
      JOIN public.produtos pr ON pr.id_fornecedor = f.id_fornecedor AND pr.ativo
     WHERE f.ativo
       AND f.nicho = p_nicho
     GROUP BY f.id_fornecedor;
$$;

REVOKE ALL ON FUNCTION public.fornecedores_do_nicho(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fornecedores_do_nicho(TEXT) TO authenticated;

-- Fornecedores por nicho (a função filtra por ele)
CREATE INDEX IF NOT EXISTS idx_fornecedores_nicho
    ON public.fornecedores (nicho)
    WHERE ativo;


-- ==========================================================
-- 2. VIEW OPORTUNIDADES (igual à 016, exceto FORNECEDOR_NICHO)
-- ==========================================================

CREATE OR REPLACE VIEW public.oportunidades
WITH (security_invoker = true) AS
WITH
eu AS (
    SELECT (SELECT public.meu_id_usuario())    AS id_usuario,
           (SELECT public.meu_id_fornecedor()) AS id_fornecedor,
           COALESCE(
               (SELECT u.nicho FROM public.usuarios u WHERE u.auth_user_id = (SELECT auth.uid())),
               (SELECT f.nicho FROM public.fornecedores f WHERE f.auth_user_id = (SELECT auth.uid()))
           ) AS nicho
),
-- Ofertas que a empresa pode comprar agora
catalogo AS (
    SELECT pr.id_produto, pr.id_fornecedor, pr.nome_produto, pr.categoria,
           pr.preco_atacado, pr.quantidade_minima, pr.quantidade_estoque, pr.data_cadastro,
           fp.razao_social, fp.nome_fantasia, fp.cidade, fp.estado, fp.nicho
      FROM public.produtos pr
      JOIN public.fornecedores_publicos fp ON fp.id_fornecedor = pr.id_fornecedor
     CROSS JOIN eu
     WHERE eu.id_usuario IS NOT NULL
       AND pr.ativo
       AND pr.quantidade_estoque >= pr.quantidade_minima
       AND pr.id_fornecedor IS DISTINCT FROM eu.id_fornecedor
),
minhas_compras AS (
    SELECT pp.id_produto, pp.id_fornecedor, pp.status_pedido, pp.data_pedido
      FROM public.pedidos_painel pp
     WHERE pp.sou_comprador
)

-- ---------------- VENDER ----------------

SELECT 'NOVA_DEMANDA'::TEXT AS tipo,
       4 AS relevancia,
       pp.id_pedido,
       pp.id_produto,
       pp.id_fornecedor,
       pp.nome_produto           AS produto_nome,
       pp.categoria,
       pp.valor_unitario         AS preco,
       NULL::INTEGER             AS quantidade_minima,
       NULL::INTEGER             AS quantidade_estoque,
       NULL::TEXT                AS fornecedor_nome,
       NULL::TEXT                AS cidade,
       NULL::TEXT                AS estado,
       pp.comprador_nome         AS parceiro_nome,
       pp.valor_total            AS valor,
       pp.quantidade,
       pp.data_pedido            AS referencia,
       NULL::TEXT                AS detalhe
  FROM public.pedidos_painel pp
 WHERE pp.sou_fornecedor
   AND pp.status_pedido = 'PENDENTE'

-- ---------------- COMPRAR ----------------

UNION ALL
SELECT 'RECOMPRA', 3,
       NULL, c.id_produto, c.id_fornecedor, c.nome_produto, c.categoria, c.preco_atacado,
       c.quantidade_minima, c.quantidade_estoque,
       COALESCE(c.nome_fantasia, c.razao_social), c.cidade, c.estado,
       NULL, NULL, NULL,
       h.ultima_compra, h.compras::TEXT
  FROM catalogo c
  JOIN (
        SELECT id_produto, MAX(data_pedido) AS ultima_compra, COUNT(*) AS compras
          FROM minhas_compras
         WHERE status_pedido = 'ENTREGUE'
         GROUP BY id_produto
  ) h ON h.id_produto = c.id_produto
 WHERE h.ultima_compra < NOW() - INTERVAL '15 days'

UNION ALL
SELECT 'NOVO_PRODUTO',
       CASE WHEN c.nicho IS NOT NULL AND c.nicho = eu.nicho THEN 3 ELSE 2 END,
       NULL, c.id_produto, c.id_fornecedor, c.nome_produto, c.categoria, c.preco_atacado,
       c.quantidade_minima, c.quantidade_estoque,
       COALESCE(c.nome_fantasia, c.razao_social), c.cidade, c.estado,
       NULL, NULL, NULL,
       c.data_cadastro,
       CASE WHEN c.nicho IS NOT NULL AND c.nicho = eu.nicho THEN 'seu nicho' END
  FROM catalogo c
 CROSS JOIN eu
 WHERE c.data_cadastro > NOW() - INTERVAL '14 days'

UNION ALL
SELECT 'MENOR_PRECO', 2,
       NULL, m.id_produto, m.id_fornecedor, m.nome_produto, m.categoria, m.preco_atacado,
       m.quantidade_minima, m.quantidade_estoque,
       COALESCE(m.nome_fantasia, m.razao_social), m.cidade, m.estado,
       NULL, NULL, NULL,
       m.data_cadastro, m.ofertas::TEXT
  FROM (
        SELECT c.*,
               ROW_NUMBER() OVER (PARTITION BY c.categoria ORDER BY c.preco_atacado, c.id_produto) AS posicao,
               COUNT(*)     OVER (PARTITION BY c.categoria) AS ofertas
          FROM catalogo c
         WHERE c.categoria IS NOT NULL
  ) m
 WHERE m.posicao = 1
   AND m.ofertas >= 2

UNION ALL
SELECT 'FORNECEDOR_NICHO',
       CASE WHEN v.homologado THEN 2 ELSE 1 END,
       NULL, NULL, v.id_fornecedor, NULL, NULL, v.menor_preco,
       NULL, NULL,
       COALESCE(v.nome_fantasia, v.razao_social), v.cidade, v.estado,
       NULL, NULL, NULL,
       v.data_cadastro, v.produtos_ativos::TEXT
  FROM eu
 CROSS JOIN LATERAL public.fornecedores_do_nicho(eu.nicho) v
 WHERE eu.id_usuario IS NOT NULL
   AND eu.nicho IS NOT NULL
   AND v.id_fornecedor IS DISTINCT FROM eu.id_fornecedor
   AND v.id_fornecedor NOT IN (SELECT mc.id_fornecedor FROM minhas_compras mc WHERE mc.id_fornecedor IS NOT NULL);

REVOKE ALL ON public.oportunidades FROM PUBLIC, anon;
GRANT SELECT ON public.oportunidades TO authenticated;


-- ==========================================================
-- 3. MENSAGENS NÃO LIDAS
-- O alerta MENSAGENS e os contadores do painel só olham as não lidas,
-- que são poucas: o índice parcial fica pequeno e evita varrer o histórico.
-- ==========================================================

CREATE INDEX IF NOT EXISTS idx_mensagens_nao_lidas
    ON public.mensagens_pedidos (id_pedido)
    WHERE NOT lida;

NOTIFY pgrst, 'reload schema';
