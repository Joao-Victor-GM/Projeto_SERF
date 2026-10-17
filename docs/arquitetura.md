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

- O front-end lê pedidos pela view **`pedidos_painel`** (migration 014): uma linha
  por pedido, com nomes prontos e os papéis da empresa logada (`sou_comprador`,
  `sou_fornecedor`). Ela usa `security_invoker`, então o RLS continua valendo.
  No navegador, `SERFPedidos.consultar()` / `SERFPedidos.normalizar()` (pedidos.js).
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

Quem cancela:

- **Fornecedor**: muda o status para CANCELADO (UPDATE permitido pelo RLS).
- **Comprador** (migration 013): RPC `cancelar_pedido_comprador(id, motivo)`.
  PENDENTE → sempre; CONFIRMADO/EM_SEPARACAO → só sem pagamento PAGO e sem
  NF-e autorizada, com motivo (≥ 10 caracteres). O comprador não tem UPDATE direto.

A tabela de transições existe em dois lugares e **deve mudar junto**:
`pedidos_validar()` (migration 005) e `SERFUtils.TRANSICOES_STATUS` (utils.js).

## Alertas (migration 015)

A view **`alertas`** lista as pendências da empresa logada. Os alertas são
**derivados do estado**: não existe tabela de notificações, nada para marcar
como lido; quando a empresa resolve a pendência, o alerta some.

| Código | Quem age | Quando aparece | Severidade |
|---|---|---|---|
| `RESPONDER_PEDIDO` | fornecedor | pedido PENDENTE | atenção; urgente após 24 h |
| `APROVAR_PRAZO` | fornecedor | pagamento a prazo em análise | urgente |
| `EMITIR_NFE` | fornecedor | pagamento liberado, sem NF-e | atenção |
| `PRONTO_PARA_ENVIO` | fornecedor | NF-e autorizada, ainda não enviado | atenção |
| `CONFIRMAR_ENTREGA` | fornecedor | ENVIADO há 3 dias ou mais | atenção |
| `SEM_ESTOQUE` | fornecedor | estoque abaixo do pedido mínimo | urgente |
| `ESTOQUE_BAIXO` | fornecedor | estoque abaixo de 2× o mínimo | atenção |
| `CANCELADO_COMPRADOR` | fornecedor | comprador cancelou (7 dias) | info |
| `PAGAR_PEDIDO` | comprador | confirmado e não pago | atenção |
| `COBRANCA_VENCIDA` | comprador | Pix/boleto/cartão vencido | urgente |
| `FATURA_A_PRAZO` | comprador | fatura a prazo em aberto | info; urgente a 3 dias |
| `MENSAGENS` | ambos | mensagens recebidas não lidas | info |

- Regra nova = uma parte nova no `UNION ALL` da view + teste em
  `tests/banco/alertas.test.mjs` + texto em `TIPOS` (alertas.js). Tipo sem
  texto no front-end aparece de forma genérica, sem quebrar a página.
- O menu lateral de todas as páginas internas tem o item **Alertas** (o perfil
  fica só no canto superior direito). O contador (`alertas-contagem.js`) soma
  urgentes + atenção e fica vermelho se houver urgência.

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
| `js/utils.js` | Formatação, escape de HTML, status, transições, `obterEmpresaLogada()` |
| `js/pedidos.js` | Leitura da view `pedidos_painel` e normalização canônica do pedido |
| `js/auth-check.js` | Protege páginas internas; expõe `window.serfSessao`; logout via `[data-logout]` |
| `js/home/*.js` | Home dividida em 7 scripts (ver abaixo) |
| `js/alertas.js` | Página de alertas: textos por tipo, filtros, agrupamento |
| `js/alertas-contagem.js` | Contador de alertas no menu lateral (todas as páginas internas) |
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

Os scripts de página vêm no fim do `<body>` com `defer`. Home, Relatórios e
Perfil carregam também `pedidos.js` logo após `utils.js`.

### Home (`js/home/`)

Scripts clássicos que compartilham o escopo global, nesta ordem:

| Arquivo | Conteúdo |
|---|---|
| `estado.js` | Dependências, cache, estado, elementos, busca de pedidos (recorte no servidor) |
| `dashboard.js` | Modo Comprar/Vender, filtros, tabela, KPIs, gráfico, radar, conversas |
| `eventos.js` | Navegação lateral, eventos dos filtros, indicadores, ações |
| `chat.js` | Chat do pedido: histórico, envio, Realtime e plano B incremental |
| `pedido-modal.js` | Modal: resumo, status (fornecedor), cancelamento (comprador), pagamento, NF-e |
| `tempo-real.js` | Assinaturas Realtime de pedidos, pagamentos e notas |
| `inicializacao.js` | Cabeçalho, modos disponíveis, `?pedido=ID` e `iniciarHome()` |

Só `inicializacao.js` executa código ao carregar. Funções novas podem ficar em
qualquer arquivo; código que **roda no carregamento** só no último.

**Recorte de dados da Home:** o servidor devolve os pedidos movimentados nos
últimos 90 dias (maior opção do filtro de período) **mais** todos os pedidos em
andamento. Pedido fora do recorte aberto por link (`?pedido=ID`) é buscado sob
demanda. Os Relatórios carregam o histórico completo de propósito: "cliente
novo × recorrente" e a comparação com o período anterior dependem dele.

**Versões de CDN são fixas.** Para atualizar, troque a versão em todas as
páginas e teste o fluxo completo (login → pedido → pagamento → NF → envio).

## Pontos conhecidos para evoluir

- Unificar `usuarios` e `fornecedores` em `empresas` + papéis.
- Itens de pedido (vários produtos por pedido / NF).
- Relatórios agregados no banco (RPC), quando o volume de pedidos crescer.
- `dashboard.js` (~780 linhas) ainda pode ser dividido (gráfico/radar/conversas).
- Pagamento real: a confirmação deve vir de webhook do gateway, nunca do comprador.
- Validar o CNPJ no servidor (Edge Function) em vez de confiar no navegador.

## Testes

```bash
npm install                      # uma vez
npx playwright install chromium  # uma vez (navegador dos testes de interface)
npm test                         # tudo
npm run test:banco               # migrations + RLS + regras (PostgreSQL em memória)
npm run test:unit                # utils.js e pedidos.js
npm run test:e2e                 # páginas no navegador com Supabase simulado
npm run servidor                 # abre o front-end em http://localhost:4173
```

- **Banco** (`tests/banco/`): aplica todas as migrations num PostgreSQL real
  (PGlite) com um Supabase mínimo simulado e testa quem vê/altera o quê e o
  ciclo do pedido. Toda migration nova deve vir com teste aqui.
- **Interface** (`tests/e2e/`): Playwright abre as páginas com sessão e API do
  Supabase simuladas (`supabase-falso.mjs`, dados em `dados.mjs`). Nenhuma
  requisição chega ao projeto real.
- O GitHub Actions (`.github/workflows/testes.yml`) roda tudo a cada push.

## Deploy

Ordem obrigatória: **primeiro o banco, depois o front-end**. O front-end atual
depende das migrations 013 (`motivo_cancelamento`, RPC de cancelamento), 014
(view `pedidos_painel`) e 015 (view `alertas`). Publicar as páginas antes delas
quebra Home, Relatórios, Perfil e Empresas; sem a 015, a página de alertas
mostra erro e o contador do menu fica oculto (o resto funciona).
