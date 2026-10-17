-- S.E.R.F. - Radar de Oportunidades (Home)
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 015.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Oportunidades de negócio REAIS para a empresa logada. O radar da Home
-- apresenta uma por vez, animado, mas nada é inventado: cada linha é um
-- produto, fornecedor ou pedido que existe e pode ser negociado agora.
--
-- security_invoker = true → roda com as permissões de quem consulta (RLS).
--
-- Regras (ao mudar, atualize tests/banco/oportunidades.test.mjs):
--   NOVA_DEMANDA       fornecedor  pedido PENDENTE de um comprador (relevância 4)
--   RECOMPRA           comprador   produto já recebido (ENTREGUE), última
--                                  compra há mais de 15 dias, disponível (3)
--   NOVO_PRODUTO       comprador   produto cadastrado nos últimos 14 dias
--                                  (2; 3 se o fornecedor é do seu nicho)
--   MENOR_PRECO        comprador   oferta mais barata de uma categoria com
--                                  pelo menos 2 ofertas disponíveis (2)
--   FORNECEDOR_NICHO   comprador   fornecedor do seu nicho, com catálogo ativo,
--                                  de quem você ainda não comprou (1; 2 se homologado)
--
-- Produtos só entram se estiverem ativos e com estoque para o pedido mínimo,
-- e nunca os da própria empresa. Oportunidades de compra só aparecem para
-- quem tem papel de comprador.


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
  FROM public.fornecedores_vitrine v
 CROSS JOIN eu
 WHERE eu.id_usuario IS NOT NULL
   AND eu.nicho IS NOT NULL
   AND v.nicho = eu.nicho
   AND v.produtos_ativos > 0
   AND v.id_fornecedor IS DISTINCT FROM eu.id_fornecedor
   AND v.id_fornecedor NOT IN (SELECT mc.id_fornecedor FROM minhas_compras mc WHERE mc.id_fornecedor IS NOT NULL);

REVOKE ALL ON public.oportunidades FROM PUBLIC, anon;
GRANT SELECT ON public.oportunidades TO authenticated;

NOTIFY pgrst, 'reload schema';
