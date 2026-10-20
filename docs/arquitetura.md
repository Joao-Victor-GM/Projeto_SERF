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

## Radar de Oportunidades (migration 016)

Seção de destaque no topo da Home (`#radar-oportunidades`), também acessível
pelo item **Oportunidades** do menu lateral. Um radar animado anuncia, uma a
uma, oportunidades **reais** da view `oportunidades`: nenhum negócio é
inventado; só a apresentação é cadenciada.

| Tipo | Para | Quando | Relevância |
|---|---|---|---|
| `NOVA_DEMANDA` | fornecedor | pedido PENDENTE de um comprador | 4 |
| `RECOMPRA` | comprador | produto recebido há mais de 15 dias, disponível | 3 |
| `NOVO_PRODUTO` | comprador | cadastrado nos últimos 14 dias | 2 (3 se do seu nicho) |
| `MENOR_PRECO` | comprador | oferta mais barata de categoria com 2+ ofertas | 2 |
| `FORNECEDOR_NICHO` | comprador | fornecedor do seu nicho de quem ainda não comprou | 1 (2 se homologado) |

- Produtos só entram ativos e com estoque para o pedido mínimo, nunca os da
  própria empresa. Relevância alta = ponto mais perto do centro do radar.
- Ações: produto abre a negociação do Catálogo na própria Home; demanda abre o
  pedido (`abrirPedidoPorId`); fornecedor leva a Empresas.
- Movimento: botão Pausar, pausa automática fora da tela / aba oculta / mouse
  sobre os cartões; com "reduzir movimento" no sistema, começa parado. As
  notificações flutuantes ficam sempre dentro do radar e nunca se sobrepõem;
  no celular aparecem só na lista.
- **Segmentos (migration 021):** o botão "◎ Segmentos" filtra o radar por
  categoria (ex.: só Alimentos & Bebidas). A escolha fica em
  `segmentos_interesse` (RLS: cada um só a sua), é trocada de uma vez pela RPC
  `definir_segmentos` e o filtro roda **no servidor** (`categoria IN (...)`).
  Nenhum marcado = tudo. Produto novo (ou reativado) com estoque num segmento
  acompanhado gera e-mail `NOVO_PRODUTO_SEGMENTO` para os compradores
  interessados (nunca para o dono): no máximo 1 por segmento por dia, com os
  produtos do dia agrupados. Sem a 021, o botão some e o radar mostra tudo.
- **Lista única de segmentos (022):** a tabela `categorias` é a lista oficial;
  `produtos.categoria` e `segmentos_interesse.categoria` têm FK para ela (texto
  livre como "alimentos" é recusado pelo banco; renomear propaga). No front, a
  mesma lista está em `SERFUtils.CATEGORIAS_PRODUTO` (sem consulta extra) e é
  usada no cadastro, na edição e no radar. Os testes garantem que banco, JS e
  `<select id="prodCategoria">` nunca divergem (`tests/banco/categorias.test.mjs`
  e `tests/unit/categorias.test.mjs`). Para criar uma categoria: migration com o
  INSERT + a constante no JS + as opções do HTML.
- Código: `js/radar-oportunidades.js` + `css/oportunidades.css`; testes em
  `tests/banco/oportunidades.test.mjs`, `tests/banco/segmentos.test.mjs` e
  `tests/e2e/oportunidades.spec.mjs`.

## Cotação reversa (migration 024)

Página `cotacoes.html` (menu **Cotações**; também "Não achou? Peça uma
cotação" no Catálogo).

1. **Comprador publica** (`publicar_cotacao`): o que precisa, segmento
   (lista oficial), quantidade e unidade, preço-alvo opcional, prazo para
   receber propostas (1–30 dias). Máximo de 20 abertas por empresa.
2. **Fornecedores do segmento são avisados** (`COTACAO_NOVA`, app + e-mail,
   agrupado por segmento e dia): quem tem produto ativo da categoria ou marcou
   o segmento no radar.
3. **Fornecedor propõe** (`enviar_proposta`): uma proposta por cotação,
   ligada a um produto dele, ativo e com estoque para a quantidade; pode
   atualizar ou retirar (`retirar_proposta`) enquanto estiver aberta.
   **Sigilo:** o RLS só mostra ao fornecedor a própria proposta.
4. **Comprador aceita** (`aceitar_proposta`): cotação FECHADA, as demais
   propostas RECUSADA e nasce um **pedido normal** (PENDENTE) com
   `pedidos.id_proposta`. `pedidos_validar` confere a proposta (aceita, mesmo
   comprador, produto e quantidade) e usa o preço dela; o mínimo do catálogo
   não se aplica. Daí em diante: confirmação, pagamento, NF-e, envio.

Aceitar continua possível depois do prazo (o prazo é para *receber*
propostas). Tabelas só de leitura para o navegador; escrita pelas RPCs.
`pedidos_validar` também congela, depois de criado, comprador, produto,
quantidade, preço e proposta do pedido (segunda camada além do GRANT da 003).

## Pix real — Mercado Pago (migration 026)

Desligado por padrão: `configuracao_pagamentos.modo = 'SIMULADO'` mantém o
fluxo da 009 (nenhum dinheiro circula). Com `'REAL'`:

- O checkout mostra só **Pix** e **faturamento a prazo**; boleto, cartão e o
  botão "Simular pagamento" somem — e o **banco** também recusa (trigger
  `pagamentos_exigir_provedor`: no modo REAL, só o caminho do provedor grava
  PAGO).
- **pix-criar** (Edge Function, com a sessão do comprador): `preparar_pix`
  confere o pedido; reaproveita o QR Code ainda válido (`pix_expira_em`) ou
  cria a cobrança no Mercado Pago (chave de idempotência por pedido/minuto) e
  grava com `registrar_cobranca_pix` (valor tem de bater com o pedido).
- **pix-webhook** (sem JWT): confere a assinatura `x-signature`
  (HMAC-SHA256 com `MP_WEBHOOK_SECRET`), **consulta o pagamento na API**
  (o corpo da notificação não vale nada) e chama
  `confirmar_pagamento_provedor` (idempotente; valor divergente é recusado;
  Pix que compensa depois do cancelamento fica marcado para estorno manual).
- A tela acompanha sozinha (consulta a cada 4 s + Realtime) e fecha ao
  confirmar. Fatura a prazo aprovada é paga pelo mesmo Pix e continua "a
  prazo" (o vencimento da fatura não muda).

Ativar (comece com as **credenciais de teste** do Mercado Pago):

1. Mercado Pago → Suas integrações → criar aplicação → copiar o *Access
   Token*; em Webhooks, URL
   `https://<ref-do-projeto>.supabase.co/functions/v1/pix-webhook`, evento
   **Pagamentos**, e copiar a *assinatura secreta*.
2. ```bash
   supabase functions deploy pix-criar
   supabase functions deploy pix-webhook --no-verify-jwt
   supabase secrets set MP_ACCESS_TOKEN=<access-token> MP_WEBHOOK_SECRET=<assinatura-secreta>
   ```
3. SQL Editor: `UPDATE public.configuracao_pagamentos SET modo = 'REAL';`
   (voltar: `'SIMULADO'`).

Estorno de Pix pago (pedido cancelado depois do pagamento) é feito no painel
do Mercado Pago; o S.E.R.F. marca `ESTORNADO`/`motivo_recusa` para lembrar.

## LGPD: exportar dados e excluir a conta (migration 025)

Perfil → **Privacidade e dados**.

- **Baixar meus dados** (art. 18, II/V): RPC `exportar_meus_dados()` devolve
  em JSON a conta, as empresas, produtos, compras, vendas, mensagens enviadas,
  pagamentos, NF-e, cotações, propostas, segmentos, favoritos, preferências e
  notificações. A tela baixa como `serf-meus-dados-AAAA-MM-DD.json`.
- **Excluir conta** (art. 18, VI): Edge Function `excluir-conta` (JWT do
  próprio usuário + "EXCLUIR" digitado) → `anonimizar_conta(uid)` → apaga o
  login. Bloqueado enquanto houver pedido em andamento
  (`meus_pedidos_em_andamento()`, mostrado antes de pedir confirmação).
  - Apagado: login, e-mail, telefone, nome do responsável, preferências,
    segmentos, favoritos, notificações; produtos saem do ar; cotações e
    propostas abertas são encerradas.
  - Mantido sem vínculo com a pessoa: pedidos, mensagens, pagamentos e NF-e,
    que são também histórico da outra empresa e documentos fiscais com guarda
    obrigatória (art. 16, I). Nome empresarial e CNPJ (pessoa jurídica) ficam
    nesse histórico; por isso o mesmo CNPJ não se cadastra de novo sem suporte.
  - A 025 trocou `mensagens_pedidos.id_remetente` para `ON DELETE SET NULL`:
    antes, apagar um login apagava as mensagens dele da conversa da outra
    empresa.

## Central de notificações (migration 023)

Sino no topo das páginas internas (`js/notificacoes.js`, regras de texto em
`js/dominio/notificacoes.js`). Todo evento que gera e-mail também gera
notificação no app, **mesmo para quem desligou os e-mails**:
`enfileirar_email()` virou apelido de `notificar()` (app + e-mail), então os
triggers da 020/021/024 não mudaram. Eventos com a mesma chave agrupam
(quantidade + 1, volta a "não lida"). Tempo real pelo Realtime; o usuário só
altera `lida_em`. `limpar_notificacoes_antigas()` apaga as lidas com mais de
90 dias (agendar no pg_cron, ver "E-mails").

## Experiência do usuário (018–020)

| Recurso | Onde | Como funciona |
|---|---|---|
| Erros legíveis | `SERFUtils.mensagemDeErro` + `js/ui/avisos.js` | Erros do Postgres/Supabase viram frases; regras do banco (`P0001`) passam direto; detalhe técnico só no console |
| Gestão de produtos | `js/produtos-gestao.js` + `SERFDados.produtos` | Editar preço/estoque/dados; pausar e reativar vendas ("Meus produtos" mostra os pausados) |
| Carrinho | `js/carrinho.js` + RPC `criar_compra` (018) | Vários produtos e fornecedores; um pedido por item, **tudo numa transação**, ligados por `id_compra`; o erro diz qual produto falhou. Carrinho no `localStorage` por usuário |
| Precisa da sua ação | `js/acoes-pendentes.js` (Home) | 5 alertas urgentes/de atenção, com o botão que resolve; atualiza com o Realtime |
| Primeiros passos | `js/primeiros-passos.js` + `primeiros_passos()` (019) | Checklist por perfil; some quando tudo está feito ou ao ocultar |
| Homologação por CNPJ | Edge Function `homologar-fornecedor` (019) | Consulta a Receita (BrasilAPI) no servidor; grava o status com a chave de serviço (o navegador não pode) |
| Busca | `js/home/eventos.js` | Sugere fornecedores **e produtos**; produto abre a negociação |
| E-mails | Fila `notificacoes_email` (020) + Edge Function `enviar-emails` | Ver "E-mails" abaixo |

A Home não mostra mais o catálogo (página própria); o botão principal leva ao
catálogo (Comprar) ou abre o cadastro de produto (Vender). O radar de
oportunidades pode ser recolhido (a animação para; a escolha fica salva).

### E-mails

- **Quando:** pedido recebido (fornecedor; compra do carrinho = 1 e-mail por
  fornecedor com todos os itens), status mudou (comprador), cancelado pelo
  comprador (fornecedor), mensagem nova (outro lado; máx. 1 a cada 30 min por
  conversa), pagamento confirmado e prazo solicitado (fornecedor), produto
  novo num segmento acompanhado (comprador; máx. 1 por segmento por dia, 021).
- **Como:** triggers enfileiram na mesma transação (falha ao enfileirar nunca
  desfaz o pedido); `enviar-emails` reserva (`FOR UPDATE SKIP LOCKED`), envia
  pelo Resend e marca como enviado; até 5 tentativas.
- **Desligar:** Perfil → "Avisos por e-mail" (`preferencias_notificacao`), ou
  **em um clique pelo próprio e-mail** (com `DESCADASTRO_SECRET` configurado):
  cada e-mail leva o cabeçalho `List-Unsubscribe` + `List-Unsubscribe-Post`
  (RFC 8058, exigido por Gmail/Yahoo para envio em volume) e o link "Parar de
  receber" no rodapé. O link tem um token assinado (HMAC do `auth_user_id`) que
  só serve para desligar; abrir o link (GET) só mostra a página
  `public/descadastro.html`, que pede confirmação. Código:
  `functions/_shared/descadastro.ts` + função `descadastrar`.

Ativar em produção (uma vez):

```bash
supabase functions deploy homologar-fornecedor
supabase functions deploy enviar-emails --no-verify-jwt
supabase functions deploy descadastrar --no-verify-jwt
supabase functions deploy excluir-conta
supabase secrets set CRON_SECRET=<segredo-forte> RESEND_API_KEY=<chave> \
  EMAIL_REMETENTE="S.E.R.F. <avisos@seudominio.com.br>" APP_URL=<url-publica-do-front> \
  DESCADASTRO_SECRET=<outro-segredo-forte>
```

```sql
-- SQL Editor (extensões pg_cron e pg_net habilitadas em Database → Extensions)
select cron.schedule('serf-enviar-emails', '* * * * *', $$
  select net.http_post(
    url := 'https://<ref-do-projeto>.supabase.co/functions/v1/enviar-emails',
    headers := jsonb_build_object('x-cron-secret', '<segredo-forte>', 'Content-Type', 'application/json')
  ) $$);
```

Limpeza diária das notificações lidas antigas (023):

```sql
select cron.schedule('serf-limpar-notificacoes', '0 4 * * *', $$ select public.limpar_notificacoes_antigas() $$);
```

Sem a função/agendamento, os e-mails só ficam na fila (nada quebra).

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

### Camadas

Sem build e sem framework, mas com responsabilidades separadas. A regra de
dependência aponta sempre para dentro: apresentação → domínio/dados → núcleo.

```
apresentação   js/home/*.js, alertas.js, radar-oportunidades.js, ...   (DOM, eventos)
     │                │
     ▼                ▼
domínio        js/dominio/painel.js     regras puras: sem DOM, sem Supabase, testadas em Node
dados          js/dados/*.js            ÚNICA camada que fala com o Supabase (repositórios)
     │
     ▼
núcleo         supabase-client.js, utils.js, pedidos.js, auth-check.js
layout         js/ui/layout.js          menu lateral único + botão ☰ de todas as páginas internas
```

| Camada | Pode | Não pode |
|---|---|---|
| Apresentação | ler/escrever DOM, chamar domínio e repositórios | chamar `obterSupabase()` / `.from()` |
| Domínio (`SERFPainel`) | calcular a partir dos parâmetros | tocar DOM, rede, `estado` global, `new Date()` implícito |
| Dados (`SERFDados.*`) | consultar, gravar e assinar Realtime | conhecer elementos da tela |

Repositórios: `SERFDados.fornecedores` (sugestões da busca da Home: só a view leve `fornecedores_publicos`, termo entre aspas), `SERFDados.pedidos` (painel, por id, status, cancelamento,
Realtime), `SERFDados.mensagens` (chat), `SERFDados.financeiro` (Realtime de
pagamento/NF-e), `SERFDados.pendencias` (alertas e oportunidades). Relatórios,
Perfil, Empresas, Catálogo, pagamentos.js e notas.js ainda consultam o Supabase
direto: migrar quando forem alterados.

**Busca da Home:** além de filtrar a tabela, sugere fornecedores (auto-complete
acessível: combobox ARIA, setas/Enter/Esc). A sugestão abre `empresas.html?busca=Nome`,
que já abre filtrada.

**Menu lateral:** os itens ficam em `ITENS` (js/ui/layout.js). Cada página só
declara `<nav class="sidebar-nav" data-pagina-atual="...">` seguido do script.
Item novo = uma linha em `ITENS`.

### Desempenho

Medido com `npm run test:desempenho` (Home com 3.000 pedidos e 2.000 mensagens;
mesma máquina, antes × depois da refatoração):

| Interação | Antes | Depois |
|---|---|---|
| Digitar 10 letras na busca | 489 ms | 7,5 ms |
| Trocar filtro de status | 39,6 ms | 5,0 ms |
| Alternar Comprar/Vender | 59,9 ms | 20,7 ms |
| Evento Realtime (1 pedido) | 23,6 ms | 6,0 ms |
| Chat: 300 mensagens chegando | 3.339 ms | 38,9 ms |

Regras que mantêm esses números (não desfazer sem medir):

- **Tabela paginada** (100 linhas + "Mostrar mais"): desenhar todas as linhas
  era 90% do custo de cada filtro.
- **Redesenho por escopo:** busca, status, empresa e indicador chamam
  `atualizarListagem()` (tabela + KPIs); só dados, modo e período chamam
  `atualizarDashboard()` (tudo).
- **Busca com debounce** de 150 ms; texto de busca pré-calculado por pedido.
- **Índice `pedidosPorId`** (Map) em vez de `pedidosCache.find` — use
  `obterPedido(id)`; ao alterar `pedidosCache`, chame `indexarPedidos()`.
- **Chat incremental:** mensagens novas são anexadas; só redesenha tudo se
  chegar mensagem fora de ordem.
- **Radar de pedidos** limitado a 8 pendências (o resto em alertas.html).
- **Radar de Oportunidades:** não recarrega fora da tela/aba oculta, não
  redesenha se nada mudou; sem `backdrop-filter`/`filter` sobre animação.
- **Banco:** `oportunidades` usa `fornecedores_do_nicho()` (017) em vez de
  `fornecedores_vitrine`, que agrega todos os pedidos da plataforma.

| Arquivo | Papel |
|---|---|
| `js/supabase-client.js` | Cria o cliente único (`window.supabaseClient`, `obterSupabase()`) |
| `js/utils.js` | Formatação, escape de HTML, status, transições, `obterEmpresaLogada()` |
| `js/pedidos.js` | Leitura da view `pedidos_painel` e normalização canônica do pedido |
| `js/auth-check.js` | Protege páginas internas; expõe `window.serfSessao`; logout via `[data-logout]` |
| `js/home/*.js` | Home dividida em 7 scripts (ver abaixo) |
| `js/dominio/painel.js` | Regras puras do painel (filtros, KPIs, gráfico, radar, conversas) |
| `js/dados/*.js` | Repositórios: única camada que acessa o Supabase |
| `js/ui/layout.js` | Menu lateral único e botão ☰ |
| `js/ui/avisos.js` | Diálogos padronizados (erro, info, sucesso, confirmação) |
| `js/dominio/alertas.js` | Texto, ação e prioridade de cada tipo de alerta (central e Home) |
| `js/carrinho.js`, `js/produtos-gestao.js` | Carrinho de compras; edição/pausa de produtos |
| `js/acoes-pendentes.js`, `js/primeiros-passos.js` | Blocos do topo da Home |
| `supabase/functions/*` | Edge Functions (Deno): `homologar-fornecedor`, `enviar-emails` |
| `js/alertas.js` | Página de alertas: textos por tipo, filtros, agrupamento |
| `js/alertas-contagem.js` | Contador de alertas no menu lateral (todas as páginas internas) |
| `js/radar-oportunidades.js` | Radar de Oportunidades no topo da Home |
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
- Migrar Relatórios, Perfil, Empresas, Catálogo, pagamentos.js e notas.js para
  a camada de dados (`SERFDados`), como a Home.
- Realtime com `filter` por empresa (hoje o RLS filtra no servidor, mas cada
  mudança é avaliada para todos os assinantes).
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
npm run test:desempenho          # benchmark da Home (fora do CI: mede tempo)
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
(view `pedidos_painel`), 015 (view `alertas`), 016 (view `oportunidades`) e
017 (desempenho do radar; sem ela tudo funciona, só mais lento), 018
(carrinho), 019 (primeiros passos e homologação), 020 (e-mails), 021
(segmentos do radar), 022 (categorias oficiais; converte categorias antigas
fora da lista — veja o cabeçalho da migration), 023 (notificações no app) e
024 (cotações), 025 (LGPD) e 026 (Pix real, desligado por padrão). Sem 018–026
a Home continua funcionando: só o envio do carrinho, o checklist, a
verificação de CNPJ, os e-mails, o filtro por segmento e o sino ficam
indisponíveis; a página de cotações e os botões de LGPD do Perfil mostram o erro. Publicar as páginas antes delas
quebra Home, Relatórios, Perfil e Empresas; sem a 015, a página de alertas
mostra erro e o contador do menu fica oculto; sem a 016, o radar mostra
"Radar indisponível" (o resto funciona).
