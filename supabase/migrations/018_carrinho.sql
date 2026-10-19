-- S.E.R.F. - Carrinho: vários produtos enviados de uma vez
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 017.
-- Pode ser executado mais de uma vez (idempotente).
--
-- O comprador monta um carrinho (no navegador) e envia tudo numa chamada:
-- criar_compra() cria um pedido por produto, todos na MESMA transação
-- (ou entram todos, ou nenhum) e ligados pelo mesmo id_compra.
--
-- Cada pedido continua passando pelas regras de sempre (preço do cadastro,
-- pedido mínimo, estoque, autocompra, RLS). Pagamento e NF-e seguem por
-- pedido; o id_compra prepara a unificação futura (um pagamento por compra).


-- ==========================================================
-- 1. AGRUPAMENTO DOS PEDIDOS DE UMA COMPRA
-- ==========================================================

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS id_compra UUID;

CREATE INDEX IF NOT EXISTS idx_pedidos_compra
    ON public.pedidos (id_compra)
    WHERE id_compra IS NOT NULL;


-- ==========================================================
-- 2. RPC criar_compra
-- p_itens: [{"id_produto": 10, "quantidade": 20}, ...]
-- SECURITY INVOKER (padrão): os INSERTs passam pelo RLS como o
-- próprio comprador — a função não ganha nenhum poder extra.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.criar_compra(p_itens JSONB, p_observacao TEXT DEFAULT NULL)
RETURNS TABLE (id_pedido BIGINT, id_produto BIGINT, quantidade INTEGER, valor_total NUMERIC, id_compra UUID)
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
    v_id_usuario BIGINT := public.meu_id_usuario();
    v_id_compra  UUID := gen_random_uuid();
    v_item       JSONB;
    v_produto    BIGINT;
    v_quantidade INTEGER;
    v_nome       TEXT;
    v_observacao TEXT := NULLIF(btrim(COALESCE(p_observacao, '')), '');
    v_pedido     public.pedidos%ROWTYPE;
BEGIN
    IF v_id_usuario IS NULL THEN
        RAISE EXCEPTION 'Só empresas compradoras podem enviar pedidos.';
    END IF;

    IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
        RAISE EXCEPTION 'O carrinho está vazio.';
    END IF;

    IF jsonb_array_length(p_itens) > 50 THEN
        RAISE EXCEPTION 'Envie no máximo 50 produtos por vez.';
    END IF;

    IF (SELECT COUNT(DISTINCT (item ->> 'id_produto')) FROM jsonb_array_elements(p_itens) item)
       <> jsonb_array_length(p_itens) THEN
        RAISE EXCEPTION 'O mesmo produto aparece duas vezes no carrinho.';
    END IF;

    IF v_observacao IS NOT NULL AND char_length(v_observacao) > 500 THEN
        RAISE EXCEPTION 'A observação deve ter no máximo 500 caracteres.';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
    LOOP
        v_produto := (v_item ->> 'id_produto')::BIGINT;
        v_quantidade := (v_item ->> 'quantidade')::INTEGER;

        SELECT nome_produto INTO v_nome FROM public.produtos p WHERE p.id_produto = v_produto;

        BEGIN
            -- valor_unitario é recalculado pelo trigger (preço do cadastro)
            INSERT INTO public.pedidos (id_usuario, id_produto, quantidade, valor_unitario, observacao, id_compra)
            VALUES (v_id_usuario, v_produto, v_quantidade, 1, v_observacao, v_id_compra)
            RETURNING * INTO v_pedido;
        EXCEPTION WHEN OTHERS THEN
            -- Diz QUAL produto falhou; o erro desfaz a compra inteira
            RAISE EXCEPTION '%: %', COALESCE(v_nome, 'Produto #' || v_produto), SQLERRM;
        END;

        id_pedido := v_pedido.id_pedido;
        id_produto := v_pedido.id_produto;
        quantidade := v_pedido.quantidade;
        valor_total := v_pedido.valor_total;
        id_compra := v_id_compra;
        RETURN NEXT;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_compra(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_compra(JSONB, TEXT) TO authenticated;


-- ==========================================================
-- 3. pedidos_painel expõe o id_compra (coluna nova no FIM:
--    CREATE OR REPLACE VIEW só permite acrescentar no final)
-- ==========================================================

CREATE OR REPLACE VIEW public.pedidos_painel
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

       COALESCE(pe.id_usuario = (SELECT public.meu_id_usuario()), FALSE)        AS sou_comprador,
       COALESCE(pr.id_fornecedor = (SELECT public.meu_id_fornecedor()), FALSE)  AS sou_fornecedor,

       pe.id_compra
  FROM public.pedidos pe
  LEFT JOIN public.produtos pr             ON pr.id_produto = pe.id_produto
  LEFT JOIN public.fornecedores_publicos fp ON fp.id_fornecedor = pr.id_fornecedor
  LEFT JOIN public.usuarios us             ON us.id_usuario = pe.id_usuario;

NOTIFY pgrst, 'reload schema';
