# Arquitetura do SERF

Plataforma B2B: empresas compradoras fazem pedidos de produtos de fornecedores,
conversam pelo chat do pedido, pagam (simulado) e recebem NF-e (simulada).

## Visão geral

```
Navegador (HTML + JS puro, sem build)
  supabase-js (CDN, versão fixa) → supabase-client.js → utils.js → auth-check.js → <página>.js
        │ PostgREST (.from / .rpc)          │ Realtime (postgres_changes)
        ▼                                   ▼
Supabase / PostgreSQL
  RLS + GRANT por coluna + triggers + funções SECURITY DEFINER
```

**Não há backend próprio.** A pasta `backend/` está reservada. Toda regra que
precisa ser confiável fica **no banco**; o front-end só exibe e chama.

| Camada | Responsabilidade |
|---|---|
| RLS (políticas) | **Quais linhas** cada empresa lê/escreve |
| GRANT por coluna | **Quais colunas** o navegador pode alterar (ex.: só `status_pedido`) |
| Triggers | Preço, estoque, transições de status, datas, histórico, NF/pagamento obrigatórios |
| RPCs (SECURITY DEFINER) | Segmentação, pagamento, NF-e — operações que o navegador não grava direto |
| Front-end | Interface; valida antes só para dar feedback rápido |

## Modelo de dados

```
auth.users ──┬── usuarios (papel COMPRADOR) ──────────┐
             └── fornecedores (papel FORNECEDOR) ─ produtos ─ pedidos ─┬─ mensagens_pedidos
                                                                       ├─ pagamentos (1 por pedido)
                                                                       ├─ notas_fiscais
                                                                       └─ pedidos_historico_status
views: fornecedores_publicos (catálogo), fornecedores_vitrine (diretório + reputação)
```

- Uma empresa "Ambos" tem linha em `usuarios` **e** em `fornecedores`.
  Para saber quem está logado, use `SERFUtils.obterEmpresaLogada()` (utils.js),
  que consulta as duas tabelas uma vez por página e guarda em cache.
- Um pedido tem **um** produto (não há tabela de itens).

## Ciclo do pedido

```
PENDENTE ──(fornecedor)──► CONFIRMADO ──► EM_SEPARACAO ──► ENVIADO ──► ENTREGUE
    │                         │  reserva estoque  │            ▲
    └──► CANCELADO ◄──────────┴───────────────────┘            │
         (devolve estoque, estorna pagamento, cancela NF)      │
                                                               │
   ENVIADO exige: pagamento PAGO (ou prazo aprovado) + NF-e AUTORIZADA
```

A tabela de transições existe em dois lugares e **deve mudar junto**:
`pedidos_validar()` (migration 005) e `SERFUtils.TRANSICOES_STATUS` (utils.js).

## Triggers em `pedidos` — a ORDEM IMPORTA

O PostgreSQL executa triggers do mesmo momento em **ordem alfabética do nome**.
Renomear um trigger muda o comportamento.

| Momento | Trigger | Migration | Faz |
|---|---|---|---|
| BEFORE INSERT | `trg_pedidos_autocompra` | 012 | Recusa empresa comprando o próprio produto |
| BEFORE INSERT/UPDATE | `trg_pedidos_datas` | 008 | Datas de cada etapa (nunca vêm do navegador) |
| BEFORE UPDATE | `trg_pedidos_nota` | 010 | ENVIADO exige NF-e autorizada |
| BEFORE UPDATE | `trg_pedidos_pagamento` | 009 | ENVIADO exige pagamento liberado |
| BEFORE INSERT/UPDATE | `trg_pedidos_validar` | 003/005 | Preço, mínimo, estoque, transições (por último) |
| AFTER UPDATE | `trg_pedidos_cancelar_nota` | 010 | Cancela NF ao cancelar o pedido |
| AFTER UPDATE | `trg_pedidos_estorno` | 009 | Estorna/cancela pagamento |
| AFTER INSERT/UPDATE | `trg_pedidos_historico` | 008 | Grava `pedidos_historico_status` |

## Segurança (RLS)

- Funções `meu_id_usuario()` / `meu_id_fornecedor()` identificam a empresa por `auth.uid()`.
- Desde a 012, as políticas de leitura usam conjuntos calculados **uma vez por
  consulta** (`ids_meus_pedidos()`, `ids_meus_produtos()`, …) em vez de chamar
  uma função para cada linha. Mantenha esse padrão em políticas novas:
  `USING (id_pedido IN (SELECT public.ids_meus_pedidos()))`.
- Políticas criadas pelo painel do Supabase são somadas com **OR** às das
  migrations. Não crie políticas pelo painel: crie uma migration.
- A chave do Supabase no front-end é a publicável; a proteção vem do RLS.

## Front-end

| Arquivo | Papel |
|---|---|
| `js/supabase-client.js` | Cria o cliente único (`window.supabaseClient`, `obterSupabase()`) |
| `js/utils.js` | Formatação, escape de HTML, status, `obterEmpresaLogada()` |
| `js/auth-check.js` | Protege páginas internas; expõe `window.serfSessao`; logout via `[data-logout]` |
| `js/home.js` | Dashboard, pedidos, chat, status, pagamento/NF no modal, Realtime |
| `js/catalogo.js` | Catálogo, cadastro de produto, negociação (carregado em home/catálogo/empresas) |
| `js/pagamentos.js`, `js/notas.js` | Fluxos de pagamento e NF-e (usados pela home) |
| `js/relatorios.js`, `js/empresas.js`, `js/perfil.js` | Páginas homônimas |

Ordem obrigatória dos scripts nas páginas internas (no `<head>`, sem `defer`):

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0"></script>
<script src="../../js/supabase-client.js"></script>
<script src="../../js/utils.js"></script>
<script src="../../js/auth-check.js"></script>
```

Os scripts de página vêm no fim do `<body>` com `defer`.

**Versões de CDN são fixas.** Para atualizar, troque a versão em todas as
páginas e teste o fluxo completo (login → pedido → pagamento → NF → envio).

## Pontos conhecidos para evoluir

- Unificar `usuarios` e `fornecedores` em `empresas` + papéis.
- Itens de pedido (vários produtos por pedido / NF).
- Paginação e filtro de período no servidor (hoje a Home carrega todos os pedidos).
- Unificar os três `normalizarPedido` (home, relatórios, perfil).
- Dividir `home.js` em módulos (chat, pagamento, dashboard).
- Pagamento real: a confirmação deve vir de webhook do gateway, nunca do comprador.
- Comprador ainda não consegue cancelar o próprio pedido pendente.
