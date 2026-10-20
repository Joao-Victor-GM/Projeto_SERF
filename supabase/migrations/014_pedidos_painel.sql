-- S.E.R.F. - View pedidos_painel: pedidos já "achatados" para o front-end
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 013 (usa a coluna motivo_cancelamento).
-- Pode ser executado mais de uma vez (idempotente).
--
-- Por quê:
--   Home, Relatórios, Perfil e Empresas repetiam o mesmo SELECT com JOINs
--   aninhados (pedidos → produtos → fornecedores_publicos, usuarios) e
--   cada página descobria no navegador se a empresa era a compradora ou a
--   fornecedora. A view entrega uma linha por pedido, com nomes prontos e
--   os papéis da empresa logada (sou_comprador / sou_fornecedor), o que
--   permite FILTRAR NO SERVIDOR por papel, período e status.
--
-- Segurança: security_invoker = true → a view roda com as permissões de
-- quem consulta; o RLS de pedidos/produtos/usuarios continua valendo.
-- (fornecedores_publicos expõe só dados comerciais, como antes.)


-- Só cria se ainda não existe: a 018 acrescentou colunas (id_compra) e
-- reexecutar esta definição antiga depois dela falharia ("cannot drop
-- columns from view"). A definição vigente é sempre a da migration mais nova.
DO $migracao$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'pedidos_painel') THEN
        EXECUTE $view$
CREATE VIEW public.pedidos_painel
WITH (security_invoker = true) AS
SELECT pe.id_pedido,
       pe.id_usuario,
       pe.id_produto,
       pe.quantidade,
       pe.valor_unitario,
       pe.valor_total,
       pe.status_pedido,
       pe.observacao,
       pe.motivo_cancelamento,
       pe.data_pedido,
       pe.data_atualizacao,
       pe.data_resposta,
       pe.data_envio,
       pe.data_entrega,
       pe.data_cancelamento,

       pr.nome_produto,
       pr.categoria,
       pr.id_fornecedor,

       fp.razao_social  AS fornecedor_razao_social,
       fp.nome_fantasia AS fornecedor_nome_fantasia,
       fp.cidade        AS fornecedor_cidade,
       fp.estado        AS fornecedor_estado,

       us.nome_empresa  AS comprador_nome,

       -- Papéis da empresa logada (calculados uma vez por consulta)
       COALESCE(pe.id_usuario = (SELECT public.meu_id_usuario()), FALSE)        AS sou_comprador,
       COALESCE(pr.id_fornecedor = (SELECT public.meu_id_fornecedor()), FALSE)  AS sou_fornecedor
  FROM public.pedidos pe
  LEFT JOIN public.produtos pr             ON pr.id_produto = pe.id_produto
  LEFT JOIN public.fornecedores_publicos fp ON fp.id_fornecedor = pr.id_fornecedor
  LEFT JOIN public.usuarios us             ON us.id_usuario = pe.id_usuario
        $view$;
    END IF;
END $migracao$;

REVOKE ALL ON public.pedidos_painel FROM PUBLIC, anon;
GRANT SELECT ON public.pedidos_painel TO authenticated;


-- Home: pedidos movimentados recentemente
CREATE INDEX IF NOT EXISTS idx_pedidos_atualizacao
    ON public.pedidos (data_atualizacao DESC);

NOTIFY pgrst, 'reload schema';
