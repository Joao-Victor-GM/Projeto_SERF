-- S.E.R.F. - LGPD: exportar os próprios dados e excluir a conta
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 024.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Exportar (art. 18, II e V): exportar_meus_dados() devolve, em JSON, tudo
-- o que o usuário logado tem no S.E.R.F.
--
-- Excluir a conta (art. 18, VI): Edge Function excluir-conta →
-- anonimizar_conta(uid) → apaga o login (auth.users).
--   - APAGADO: login, e-mail, telefone, nome do responsável, preferências,
--     segmentos, favoritos, notificações e fila de e-mails.
--   - MANTIDO, sem vínculo com a pessoa: pedidos, mensagens, pagamentos e
--     NF-e. São também histórico da OUTRA empresa e documentos fiscais com
--     guarda obrigatória (art. 16, I: cumprimento de obrigação legal).
--     Nome empresarial e CNPJ (dados de pessoa jurídica) ficam nesse histórico.
--   - Bloqueado enquanto houver pedido em andamento (não deixa a outra
--     empresa sem resposta, mercadoria ou pagamento).
--
-- Antes desta migration, apagar o login apagava em cascata as mensagens
-- do usuário — inclusive da conversa da outra empresa. Agora elas ficam
-- (remetente vazio).


-- ==========================================================
-- 1. MENSAGENS SOBREVIVEM À EXCLUSÃO DO REMETENTE
-- ==========================================================

ALTER TABLE public.mensagens_pedidos ALTER COLUMN id_remetente DROP NOT NULL;
ALTER TABLE public.mensagens_pedidos DROP CONSTRAINT IF EXISTS fk_mensagens_pedidos_remetente;
ALTER TABLE public.mensagens_pedidos ADD CONSTRAINT fk_mensagens_pedidos_remetente
    FOREIGN KEY (id_remetente) REFERENCES auth.users (id) ON DELETE SET NULL;


-- ==========================================================
-- 2. EXPORTAR OS PRÓPRIOS DADOS
-- ==========================================================

CREATE OR REPLACE FUNCTION public.exportar_meus_dados()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid        UUID := auth.uid();
    v_usuario    BIGINT;
    v_fornecedor BIGINT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sessão expirada. Faça login novamente.';
    END IF;

    SELECT id_usuario INTO v_usuario FROM public.usuarios WHERE auth_user_id = v_uid;
    SELECT id_fornecedor INTO v_fornecedor FROM public.fornecedores WHERE auth_user_id = v_uid;

    RETURN jsonb_build_object(
        'gerado_em', NOW(),
        'aviso', 'Dados da sua conta no S.E.R.F. (LGPD, art. 18). Pedidos e mensagens também envolvem a outra empresa de cada negociação.',
        'conta', (SELECT jsonb_build_object('email', u.email, 'criada_em', u.created_at)
                    FROM auth.users u WHERE u.id = v_uid),
        'empresa_compradora', (SELECT to_jsonb(u) - 'auth_user_id' FROM public.usuarios u WHERE u.id_usuario = v_usuario),
        'empresa_fornecedora', (SELECT to_jsonb(f) - 'auth_user_id' FROM public.fornecedores f WHERE f.id_fornecedor = v_fornecedor),
        'produtos', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id_produto)
                                FROM public.produtos p WHERE p.id_fornecedor = v_fornecedor), '[]'),
        'compras', COALESCE((SELECT jsonb_agg(to_jsonb(pe) || jsonb_build_object(
                                    'produto', pr.nome_produto,
                                    'fornecedor', COALESCE(f.nome_fantasia, f.razao_social))
                                    ORDER BY pe.id_pedido)
                               FROM public.pedidos pe
                               JOIN public.produtos pr ON pr.id_produto = pe.id_produto
                               JOIN public.fornecedores f ON f.id_fornecedor = pr.id_fornecedor
                              WHERE pe.id_usuario = v_usuario), '[]'),
        'vendas', COALESCE((SELECT jsonb_agg(to_jsonb(pe) || jsonb_build_object(
                                   'produto', pr.nome_produto, 'comprador', u.nome_empresa)
                                   ORDER BY pe.id_pedido)
                              FROM public.pedidos pe
                              JOIN public.produtos pr ON pr.id_produto = pe.id_produto
                              JOIN public.usuarios u ON u.id_usuario = pe.id_usuario
                             WHERE pr.id_fornecedor = v_fornecedor), '[]'),
        'mensagens_enviadas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                            'id_pedido', m.id_pedido, 'texto', m.texto, 'data_envio', m.data_envio)
                                            ORDER BY m.data_envio)
                                          FROM public.mensagens_pedidos m WHERE m.id_remetente = v_uid), '[]'),
        'pagamentos', COALESCE((SELECT jsonb_agg(to_jsonb(pg) ORDER BY pg.id_pagamento)
                                  FROM public.pagamentos pg
                                 WHERE pg.id_pedido IN (SELECT id_pedido FROM public.pedidos WHERE id_usuario = v_usuario)
                                    OR pg.id_pedido IN (SELECT pe.id_pedido FROM public.pedidos pe
                                                          JOIN public.produtos pr ON pr.id_produto = pe.id_produto
                                                         WHERE pr.id_fornecedor = v_fornecedor)), '[]'),
        'notas_fiscais', COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id_pedido)
                                     FROM public.notas_fiscais n
                                    WHERE n.id_fornecedor = v_fornecedor
                                       OR n.id_pedido IN (SELECT id_pedido FROM public.pedidos WHERE id_usuario = v_usuario)), '[]'),
        'cotacoes', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id_cotacao)
                                FROM public.cotacoes c WHERE c.id_usuario = v_usuario), '[]'),
        'propostas', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id_proposta)
                                 FROM public.propostas p WHERE p.id_fornecedor = v_fornecedor), '[]'),
        'segmentos', COALESCE((SELECT jsonb_agg(s.categoria ORDER BY s.categoria)
                                 FROM public.segmentos_interesse s WHERE s.auth_user_id = v_uid), '[]'),
        'favoritos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id_fornecedor', fv.id_fornecedor, 'desde', fv.data_criacao))
                                 FROM public.favoritos_fornecedores fv WHERE fv.auth_user_id = v_uid), '[]'),
        'preferencias', (SELECT jsonb_build_object('receber_email', p.receber_email)
                           FROM public.preferencias_notificacao p WHERE p.auth_user_id = v_uid),
        'notificacoes', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', n.tipo, 'dados', n.dados,
                                                                      'criada_em', n.criada_em, 'lida_em', n.lida_em)
                                                   ORDER BY n.criada_em)
                                    FROM public.notificacoes n WHERE n.auth_user_id = v_uid), '[]')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.exportar_meus_dados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exportar_meus_dados() TO authenticated;


-- ==========================================================
-- 3. O QUE IMPEDE A EXCLUSÃO (a tela mostra antes de pedir confirmação)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.pedidos_em_andamento_da_conta(p_uid UUID)
RETURNS TABLE (id_pedido BIGINT, status_pedido TEXT, papel TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT pe.id_pedido, pe.status_pedido::TEXT,
           CASE WHEN u.auth_user_id = p_uid THEN 'comprador' ELSE 'fornecedor' END
      FROM public.pedidos pe
      JOIN public.usuarios u ON u.id_usuario = pe.id_usuario
      JOIN public.produtos pr ON pr.id_produto = pe.id_produto
      JOIN public.fornecedores f ON f.id_fornecedor = pr.id_fornecedor
     WHERE (u.auth_user_id = p_uid OR f.auth_user_id = p_uid)
       AND pe.status_pedido NOT IN ('ENTREGUE', 'CANCELADO')
     ORDER BY pe.id_pedido;
$$;

REVOKE ALL ON FUNCTION public.pedidos_em_andamento_da_conta(UUID) FROM PUBLIC, anon, authenticated;

-- Versão do usuário logado (para a tela do Perfil)
CREATE OR REPLACE FUNCTION public.meus_pedidos_em_andamento()
RETURNS TABLE (id_pedido BIGINT, status_pedido TEXT, papel TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM public.pedidos_em_andamento_da_conta(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.meus_pedidos_em_andamento() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meus_pedidos_em_andamento() TO authenticated;


-- ==========================================================
-- 4. ANONIMIZAR (só o servidor: Edge Function excluir-conta)
-- Depois dela, a Edge Function apaga o login; as tabelas ligadas ao
-- login (preferências, segmentos, favoritos, notificações) somem em cascata.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.anonimizar_conta(p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario    BIGINT;
    v_fornecedor BIGINT;
    v_pendentes  TEXT;
BEGIN
    IF p_uid IS NULL THEN
        RAISE EXCEPTION 'Usuário não informado.';
    END IF;

    SELECT string_agg('#' || id_pedido, ', ') INTO v_pendentes
      FROM public.pedidos_em_andamento_da_conta(p_uid);

    IF v_pendentes IS NOT NULL THEN
        RAISE EXCEPTION 'Conclua ou cancele os pedidos em andamento antes de excluir a conta: %.', v_pendentes
            USING ERRCODE = 'P0001';
    END IF;

    SELECT id_usuario INTO v_usuario FROM public.usuarios WHERE auth_user_id = p_uid;
    SELECT id_fornecedor INTO v_fornecedor FROM public.fornecedores WHERE auth_user_id = p_uid;

    -- Mercado: nada da conta continua aberto
    UPDATE public.cotacoes SET status = 'CANCELADA', encerrada_em = NOW()
     WHERE id_usuario = v_usuario AND status = 'ABERTA';
    UPDATE public.propostas SET status = 'RECUSADA', atualizada_em = NOW()
     WHERE id_cotacao IN (SELECT id_cotacao FROM public.cotacoes WHERE id_usuario = v_usuario) AND status = 'ENVIADA';
    UPDATE public.propostas SET status = 'RETIRADA', atualizada_em = NOW()
     WHERE id_fornecedor = v_fornecedor AND status = 'ENVIADA';
    UPDATE public.produtos SET ativo = FALSE WHERE id_fornecedor = v_fornecedor;

    -- Dados pessoais fora; vínculo com o login cortado
    UPDATE public.usuarios
       SET nome_responsavel = 'Titular removido',
           email = 'removido-u' || id_usuario || '@serf.invalid',
           telefone = NULL,
           ativo = FALSE,
           auth_user_id = NULL
     WHERE id_usuario = v_usuario;

    UPDATE public.fornecedores
       SET email = 'removido-f' || id_fornecedor || '@serf.invalid',
           telefone = NULL,
           ativo = FALSE,
           auth_user_id = NULL
     WHERE id_fornecedor = v_fornecedor;
END;
$$;

REVOKE ALL ON FUNCTION public.anonimizar_conta(UUID) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
