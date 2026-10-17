-- S.E.R.F. - Central de alertas
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 014 (usa a view pedidos_painel).
-- Pode ser executado mais de uma vez (idempotente).
--
-- Os alertas são DERIVADOS do estado atual (não há tabela de notificações):
-- cada linha é uma pendência que ainda existe. Quando a empresa resolve
-- (responde o pedido, paga, emite a NF...), o alerta some sozinho — nada a
-- marcar como lido, nada que fique desatualizado.
--
-- security_invoker = true → roda com as permissões de quem consulta:
-- cada empresa só vê alertas dos próprios pedidos e produtos (RLS).
--
-- Colunas:
--   codigo       tipo do alerta (o front-end monta o texto a partir dele)
--   severidade   'urgente' | 'atencao' | 'info'
--   papel        'comprador' | 'fornecedor' (quem precisa agir)
--   id_pedido / id_produto, parceiro_nome, produto_nome, valor, quantidade
--   referencia   desde quando a pendência existe
--   vencimento   prazo da cobrança, quando houver
--   detalhe      complemento (nº de mensagens, estoque mínimo, motivo...)
--
-- Regras (ao mudar, atualize os testes em tests/banco/alertas.test.mjs):
--   RESPONDER_PEDIDO    fornecedor  pedido PENDENTE (urgente após 24 h)
--   APROVAR_PRAZO       fornecedor  pedido de pagamento a prazo em análise
--   EMITIR_NFE          fornecedor  pagamento liberado e sem NF-e autorizada
--   PRONTO_PARA_ENVIO   fornecedor  NF-e autorizada, falta marcar ENVIADO
--   CONFIRMAR_ENTREGA   fornecedor  ENVIADO há 3 dias ou mais
--   SEM_ESTOQUE         fornecedor  produto ativo abaixo do pedido mínimo
--   ESTOQUE_BAIXO       fornecedor  estoque menor que 2× o pedido mínimo
--   CANCELADO_COMPRADOR fornecedor  comprador cancelou nos últimos 7 dias
--   PAGAR_PEDIDO        comprador   confirmado e ainda sem cobrança paga
--   COBRANCA_VENCIDA    comprador   Pix/boleto/cartão gerado e vencido
--   FATURA_A_PRAZO      comprador   fatura a prazo em aberto (urgente a 3 dias)
--   MENSAGENS           ambos       mensagens recebidas não lidas no pedido


CREATE OR REPLACE VIEW public.alertas
WITH (security_invoker = true) AS
WITH
pedido AS (
    SELECT pp.*,
           CASE WHEN pp.sou_fornecedor THEN 'fornecedor' ELSE 'comprador' END AS papel,
           CASE WHEN pp.sou_fornecedor THEN pp.comprador_nome
                ELSE COALESCE(pp.fornecedor_nome_fantasia, pp.fornecedor_razao_social) END AS parceiro
      FROM public.pedidos_painel pp
),
pagamento AS (
    SELECT id_pedido, metodo, status, vencimento, valor, data_atualizacao
      FROM public.pagamentos
),
nota AS (
    SELECT DISTINCT id_pedido
      FROM public.notas_fiscais
     WHERE status = 'AUTORIZADA'
),
-- Pagamento que libera NF-e e envio (mesma regra de pagamento_libera_envio)
liberado AS (
    SELECT id_pedido
      FROM pagamento
     WHERE status = 'PAGO'
        OR (metodo = 'PRAZO' AND status = 'AGUARDANDO_PAGAMENTO')
)

-- ---------------- FORNECEDOR ----------------

SELECT 'RESPONDER_PEDIDO'::TEXT AS codigo,
       CASE WHEN p.data_pedido < NOW() - INTERVAL '24 hours' THEN 'urgente' ELSE 'atencao' END AS severidade,
       'fornecedor'::TEXT AS papel,
       p.id_pedido, p.id_produto, p.parceiro AS parceiro_nome, p.nome_produto AS produto_nome,
       p.valor_total AS valor, p.quantidade,
       p.data_pedido AS referencia, NULL::TIMESTAMPTZ AS vencimento, NULL::TEXT AS detalhe
  FROM pedido p
 WHERE p.sou_fornecedor AND p.status_pedido = 'PENDENTE'

UNION ALL
SELECT 'APROVAR_PRAZO', 'urgente', 'fornecedor',
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, p.valor_total, p.quantidade,
       g.data_atualizacao, NULL, NULL
  FROM pedido p
  JOIN pagamento g ON g.id_pedido = p.id_pedido
 WHERE p.sou_fornecedor
   AND p.status_pedido IN ('CONFIRMADO', 'EM_SEPARACAO')
   AND g.status = 'AGUARDANDO_APROVACAO'

UNION ALL
SELECT 'EMITIR_NFE', 'atencao', 'fornecedor',
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, p.valor_total, p.quantidade,
       p.data_atualizacao, NULL, NULL
  FROM pedido p
 WHERE p.sou_fornecedor
   AND p.status_pedido IN ('CONFIRMADO', 'EM_SEPARACAO')
   AND p.id_pedido IN (SELECT id_pedido FROM liberado)
   AND p.id_pedido NOT IN (SELECT id_pedido FROM nota)

UNION ALL
SELECT 'PRONTO_PARA_ENVIO', 'atencao', 'fornecedor',
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, p.valor_total, p.quantidade,
       p.data_atualizacao, NULL, NULL
  FROM pedido p
 WHERE p.sou_fornecedor
   AND p.status_pedido IN ('CONFIRMADO', 'EM_SEPARACAO')
   AND p.id_pedido IN (SELECT id_pedido FROM liberado)
   AND p.id_pedido IN (SELECT id_pedido FROM nota)

UNION ALL
SELECT 'CONFIRMAR_ENTREGA', 'atencao', 'fornecedor',
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, p.valor_total, p.quantidade,
       COALESCE(p.data_envio, p.data_atualizacao), NULL, NULL
  FROM pedido p
 WHERE p.sou_fornecedor
   AND p.status_pedido = 'ENVIADO'
   AND COALESCE(p.data_envio, p.data_atualizacao) < NOW() - INTERVAL '3 days'

UNION ALL
SELECT CASE WHEN pr.quantidade_estoque < pr.quantidade_minima THEN 'SEM_ESTOQUE' ELSE 'ESTOQUE_BAIXO' END,
       CASE WHEN pr.quantidade_estoque < pr.quantidade_minima THEN 'urgente' ELSE 'atencao' END,
       'fornecedor',
       NULL::BIGINT, pr.id_produto, NULL, pr.nome_produto, NULL::NUMERIC, pr.quantidade_estoque,
       NULL, NULL, pr.quantidade_minima::TEXT
  FROM public.produtos pr
 WHERE pr.id_fornecedor = (SELECT public.meu_id_fornecedor())
   AND pr.ativo
   AND pr.quantidade_estoque < pr.quantidade_minima * 2

UNION ALL
SELECT 'CANCELADO_COMPRADOR', 'info', 'fornecedor',
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, p.valor_total, p.quantidade,
       p.data_cancelamento, NULL, p.motivo_cancelamento
  FROM pedido p
 WHERE p.sou_fornecedor
   AND p.status_pedido = 'CANCELADO'
   AND p.motivo_cancelamento IS NOT NULL      -- só a RPC do comprador grava o motivo
   AND p.data_cancelamento > NOW() - INTERVAL '7 days'

-- ---------------- COMPRADOR ----------------

UNION ALL
SELECT 'PAGAR_PEDIDO', 'atencao', 'comprador',
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, p.valor_total, p.quantidade,
       COALESCE(p.data_resposta, p.data_atualizacao), g.vencimento,
       CASE WHEN g.status = 'RECUSADO' THEN 'prazo recusado' END
  FROM pedido p
  LEFT JOIN pagamento g ON g.id_pedido = p.id_pedido
 WHERE p.sou_comprador
   AND p.status_pedido IN ('CONFIRMADO', 'EM_SEPARACAO')
   AND (
        g.id_pedido IS NULL
        OR g.status IN ('RECUSADO', 'CANCELADO')
        OR (g.status = 'AGUARDANDO_PAGAMENTO' AND g.metodo <> 'PRAZO'
            AND (g.vencimento IS NULL OR g.vencimento >= NOW()))
   )

UNION ALL
SELECT 'COBRANCA_VENCIDA', 'urgente', 'comprador',
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, p.valor_total, p.quantidade,
       g.data_atualizacao, g.vencimento, g.metodo
  FROM pedido p
  JOIN pagamento g ON g.id_pedido = p.id_pedido
 WHERE p.sou_comprador
   AND p.status_pedido IN ('CONFIRMADO', 'EM_SEPARACAO')
   AND g.status = 'AGUARDANDO_PAGAMENTO'
   AND g.metodo <> 'PRAZO'
   AND g.vencimento < NOW()

UNION ALL
SELECT 'FATURA_A_PRAZO',
       CASE WHEN g.vencimento < NOW() + INTERVAL '3 days' THEN 'urgente' ELSE 'info' END,
       'comprador',
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, g.valor, p.quantidade,
       g.data_atualizacao, g.vencimento, NULL
  FROM pedido p
  JOIN pagamento g ON g.id_pedido = p.id_pedido
 WHERE p.sou_comprador
   AND p.status_pedido <> 'CANCELADO'
   AND g.metodo = 'PRAZO'
   AND g.status = 'AGUARDANDO_PAGAMENTO'

-- ---------------- AMBOS ----------------

UNION ALL
SELECT 'MENSAGENS', 'info', p.papel,
       p.id_pedido, p.id_produto, p.parceiro, p.nome_produto, NULL::NUMERIC, NULL::INTEGER,
       m.ultima, NULL, m.quantidade::TEXT
  FROM pedido p
  JOIN (
        SELECT id_pedido, COUNT(*) AS quantidade, MAX(data_envio) AS ultima
          FROM public.mensagens_pedidos
         WHERE NOT lida
           AND id_remetente <> (SELECT auth.uid())
         GROUP BY id_pedido
  ) m ON m.id_pedido = p.id_pedido;

REVOKE ALL ON public.alertas FROM PUBLIC, anon;
GRANT SELECT ON public.alertas TO authenticated;

NOTIFY pgrst, 'reload schema';
