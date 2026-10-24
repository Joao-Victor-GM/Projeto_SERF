# Arquitetura do SERF

Plataforma B2B: empresas compradoras fazem pedidos de produtos de fornecedores,
conversam pelo chat do pedido, pagam (simulado) e recebem NF-e (simulada).

## Visão geral

```
Navegador (HTML + JS puro, sem build)
  supabase-js (CDN, versão fixa) → supabase-client.js → utils.js → auth-check.js → <página>.js
        │ PostgREST (.from / .rpc)   │ Realtime (postgres_changes)   │ Storage (logos)
        ▼                            ▼                               ▼
Supabase / PostgreSQL
  RLS + GRANT por coluna + triggers + funções SECURITY DEFINER
  Edge Functions (Deno) só para o que exige segredo: Pix, NF-e, CNPJ, e-mails, LGPD
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
storage: bucket "logos" (logo de cada empresa; usuarios/fornecedores.logo_url, migration 030)
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

Seção de destaque no topo da Home (`#radar-oportunidades`). Não há item
próprio no menu lateral: o radar faz parte da Home. Um radar animado anuncia, uma a
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

**Consulta das propostas (`minhasCotacoes`):** `cotacoes` e `propostas` têm
DUAS FKs entre si (`propostas.id_cotacao` e `cotacoes.id_proposta_aceita`).
Embutir `propostas ( … )` sem dizer qual usar faz o PostgREST recusar a
consulta (HTTP 300, `PGRST201`), e a lista "Minhas cotações" não carrega.
Use sempre `propostas!fk_propostas_cotacoes ( … )`. O Supabase simulado dos
testes de interface ignora o `select`, então esse erro só aparece no servidor
real: cuidado ao criar novos embeds entre tabelas com mais de uma FK.

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

## NF-e real — Focus NFe (migration 027)

Desligada por padrão (`configuracao_nfe.modo = 'SIMULADA'`: a NF-e da 010,
sem valor fiscal). Com `'REAL'`, a emissão passa pela **Focus NFe**, que fala
com a SEFAZ usando o certificado A1 do fornecedor (cadastrado no painel dela).

**Dados fiscais novos** (cada empresa preenche os seus):

| Onde | Campo | Tela |
|---|---|---|
| `produtos` | `ncm` (8 dígitos), `unidade_fiscal` | Catálogo (novo produto / editar) |
| `usuarios` (destinatário) | CEP, logradouro, número, complemento, bairro, município, UF, inscrição estadual | Perfil → "Endereço para nota fiscal" (CEP preenche o resto via ViaCEP) |
| `fornecedores` (emitente) | `regime_tributario` | Perfil |

Só **Simples Nacional** é suportado (CSOSN 102, PIS/COFINS 07, CFOP 5102
no mesmo estado e 6102 entre estados). Regime normal exige configurar ICMS
com o contador; `preparar_nfe` recusa com essa explicação.

Fluxo (Edge Function `nfe`, ações `emitir` / `consultar` / `cancelar`):

1. `preparar_nfe` (sessão do fornecedor) confere pedido, pagamento e lista
   **de uma vez** tudo o que falta, dizendo onde corrigir.
2. A nota é registrada como **PROCESSANDO antes** do envio
   (`registrar_nfe_enviada`). Recusa de validação da Focus → REJEITADA com o
   motivo; rede caiu → continua PROCESSANDO e `consultar` resolve (se a Focus
   nunca recebeu, vira REJEITADA e pode emitir de novo). Nunca fica nota no
   emissor sem registro no S.E.R.F.
3. A tela acompanha (consulta a cada 5 s, até 2 min) e o webhook
   `nfe-webhook` também avisa; em ambos o estado é **consultado** na Focus.
   AUTORIZADA traz número, chave, protocolo, DANFE (PDF) e XML oficiais.
4. Cancelar (`preparar_cancelamento_nfe`: 24 h, 15+ caracteres, mercadoria
   não enviada) só grava CANCELADA se a SEFAZ cancelou.

Segunda camada: no modo REAL, nota só vira AUTORIZADA/CANCELADA pelo caminho
do emissor (trigger `notas_exigir_provedor`); pedido com NF-e real
autorizada não se cancela sem antes cancelar a nota.

Ativar (sempre comece em **homologação**):

1. Conta na Focus NFe; cadastre cada empresa emitente com o certificado A1;
   copie o token. Gatilho (webhook) do evento **nfe** com a URL
   `https://<ref-do-projeto>.supabase.co/functions/v1/nfe-webhook?token=<FOCUS_WEBHOOK_TOKEN>`.
2. ```bash
   supabase functions deploy nfe
   supabase functions deploy nfe-webhook --no-verify-jwt
   supabase secrets set FOCUS_TOKEN=<token> FOCUS_AMBIENTE=HOMOLOGACAO FOCUS_WEBHOOK_TOKEN=<segredo-forte>
   ```
3. Preencha NCM dos produtos e endereço/IE dos compradores.
4. SQL Editor: `UPDATE public.configuracao_nfe SET modo = 'REAL';`
5. Valide com o contador as notas de homologação; só então
   `FOCUS_AMBIENTE=PRODUCAO`.

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

## Logo da empresa (migration 030)

Perfil → botão 📷 sobre o avatar (enviar ou trocar) e ✕ (remover, só quando
há logo).

- **Envio** (`perfil.js`): PNG, JPEG ou WebP de até 5 MB, reduzido no
  navegador para no máximo 256 px (WebP; PNG se o navegador não gerar WebP) e
  enviado ao bucket público `logos` em `logos/<auth.uid()>/logo` (upsert: um
  arquivo por empresa). O endereço público, com `?v=<data>` para furar o
  cache, vai para `logo_url` em `usuarios` e/ou `fornecedores`.
- **Remoção:** `logo_url = null` nos cadastros e, depois, o arquivo sai do
  Storage (se o arquivo falhar, o cadastro já está limpo).
- **Onde aparece:** perfil; avatar do topo de todas as páginas internas
  (`auth-check.js`, por classe `com-logo` + imagem de fundo, porque as páginas
  reescrevem o texto do avatar com a inicial); cartões do diretório e "Meus
  parceiros" em Empresas (só fornecedores: as views `fornecedores_publicos` e
  `fornecedores_vitrine` expõem `logo_url`). Imagem que não carrega volta para
  a inicial.
- **Banco:** `GRANT UPDATE (logo_url)` nas duas tabelas (o RLS da 004 limita
  ao próprio cadastro); `CHECK` aceita só endereços do bucket `logos`
  (`https://…/storage/v1/object/public/logos/…`, até 500 caracteres).
- **Storage:** bucket público (leitura), 1 MB, só PNG/JPEG/WebP; políticas em
  `storage.objects` deixam cada empresa ler, gravar, trocar e apagar **só** na
  própria pasta. A parte do Storage é pulada onde o schema `storage` não existe
  (banco de testes).
- **CSP:** `img-src` inclui o domínio do Supabase em todas as páginas e no
  `_headers` (a política tem de ser igual em todas: `tests/unit/seguranca.test.mjs`).
- Sem a 030: o envio falha com aviso e as telas mostram a inicial.

## Sessão e inatividade

Pensado para computador compartilhado de empresa.

| Situação | Onde a sessão fica | Fecha o navegador | Sem uso |
|---|---|---|---|
| Login **sem** "Manter conectado" (padrão) | `sessionStorage` | sai | sai após **30 min** |
| Login **com** "Manter conectado neste computador" | `localStorage` | continua | sai após **7 dias** |

- **Onde guardar** (`supabase-client.js`): o cliente é criado com um
  armazenamento próprio (`auth.storage`) que lê a escolha
  (`serf-manter-conectado`, gravada pelo login antes de entrar, via
  `SERFSessao.definirManterConectado`). Sem "Manter conectado", uma aba nova
  pede a sessão às abas já abertas por `BroadcastChannel` (`serf-sessao`,
  espera 250 ms): abrir um link em outra aba não exige novo login. O
  `code-verifier` (login por link) fica sempre no `localStorage`.
- **Inatividade** (`auth-check.js`): a última atividade
  (`serf-ultima-atividade`, no `localStorage`) é compartilhada entre as abas;
  clique, tecla, rolagem, toque e movimento do mouse contam (gravação no
  máximo a cada 15 s). A cada 15 s e ao voltar para a aba, o tempo parado é
  conferido: faltando 2 min aparece "Você ainda está aí?" ("Continuar
  conectado"); no limite, `signOut({ scope: "local" })` (só este navegador) e
  volta ao login com `?motivo=inatividade`, que mostra "Sessão encerrada" e
  limpa a URL. Ao abrir uma página já além do limite (PC hibernado, aba
  restaurada), sai antes de mostrar qualquer dado.
- **Limites:** `LIMITE_INATIVIDADE` no topo de `supabase-client.js`.
- Login e cadastro zeram o relógio (`SERFSessao.marcarAtividade()`); conta
  nova começa sem "Manter conectado".
- Logout em outra aba (`SIGNED_OUT`) apaga também a cópia da sessão no
  `sessionStorage` desta aba (`SERFSessao.limparSessaoDaAba()`).
- Limite conhecido: o Chrome com "Continuar de onde parou" pode restaurar o
  `sessionStorage`; aí vale o limite de 30 min.

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
supabase functions deploy verificar-cnpj
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
| `js/supabase-client.js` | Cria o cliente único (`window.supabaseClient`, `obterSupabase()`); onde a sessão fica e relógio de inatividade (`window.SERFSessao`) |
| `js/utils.js` | Formatação, escape de HTML, status, transições, `obterEmpresaLogada()` |
| `js/pedidos.js` | Leitura da view `pedidos_painel` e normalização canônica do pedido |
| `js/auth-check.js` | Protege páginas internas; expõe `window.serfSessao`; logout via `[data-logout]`; saída por inatividade; logo no avatar do topo (`window.serfAtualizarLogoTopo`) |
| `js/home/*.js` | Home dividida em 7 scripts (ver abaixo) |
| `js/dominio/painel.js` | Regras puras do painel (filtros, KPIs, gráfico, radar, conversas) |
| `js/dados/*.js` | Repositórios: única camada que acessa o Supabase |
| `js/ui/layout.js` | Menu lateral único e botão ☰ |
| `js/ui/avisos.js` | Diálogos padronizados (erro, info, sucesso, confirmação) |
| `js/dominio/alertas.js` | Texto, ação e prioridade de cada tipo de alerta (central e Home) |
| `js/carrinho.js`, `js/produtos-gestao.js` | Carrinho de compras; edição/pausa de produtos |
| `js/acoes-pendentes.js`, `js/primeiros-passos.js` | Blocos do topo da Home |
| `supabase/functions/*` | Edge Functions (Deno): `homologar-fornecedor`, `verificar-cnpj`, `enviar-emails`, `descadastrar`, `excluir-conta`, `pix-criar`, `pix-webhook`, `nfe`, `nfe-webhook` |
| `js/alertas.js` | Página de alertas: textos por tipo, filtros, agrupamento |
| `js/alertas-contagem.js` | Contador de alertas no menu lateral (todas as páginas internas) |
| `js/radar-oportunidades.js` | Radar de Oportunidades no topo da Home |
| `js/catalogo.js` | Catálogo, cadastro de produto, negociação (carregado em home/catálogo/empresas) |
| `js/pagamentos.js`, `js/notas.js` | Fluxos de pagamento e NF-e (usados pela home) |
| `js/cotacoes.js` + `js/dados/cotacoes.repositorio.js` | Cotação reversa (tela e consultas/RPCs) |
| `js/relatorios.js`, `js/empresas.js`, `js/perfil.js` | Páginas homônimas (o perfil também envia e remove o logo) |

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

**Módulos ES nativos, sem build.** A `home.html` carrega um único
`<script type="module" src="../../js/home/inicializacao.js">`; cada arquivo
importa o que usa dos outros (`import { … } from "./estado.js"`) e exporta o
que oferece. Nada mais vaza para o escopo global: o que os scripts clássicos
da página usam (radar, ações pendentes, catálogo) é a API
`window.SERFHome = { abrirPedidoPorId, alterarModo, adicionarMensagens }`
(`tests/e2e/modulos.spec.mjs` garante isso).

Módulos não carregam de `file://`: abra pelo servidor (`npm run servidor` ou
Live Server); aberta do disco, a Home mostra um aviso em vez de quebrar.

| Arquivo | Conteúdo |
|---|---|
| `estado.js` | Dependências, cache, estado, elementos, busca de pedidos (recorte no servidor) |
| `dashboard.js` | Modo Comprar/Vender, filtros, tabela, KPIs, gráfico, radar, conversas |
| `eventos.js` | Navegação lateral, eventos dos filtros, indicadores, ações |
| `chat.js` | Chat do pedido: histórico, envio, Realtime e plano B incremental |
| `pedido-modal.js` | Modal: resumo, status (fornecedor), cancelamento (comprador), pagamento, NF-e |
| `tempo-real.js` | Assinaturas Realtime de pedidos, pagamentos e notas |
| `inicializacao.js` | Cabeçalho, modos disponíveis, `?pedido=ID` e `iniciarHome()` |

Só `inicializacao.js` executa código ao carregar. Função nova usada por outro
arquivo: `export` onde ela mora e `import` onde é usada. Um módulo não pode
**reatribuir** variável de outro (import é só leitura): mude o objeto (ex.:
`conversasCache.clear()`) ou exporte uma função que faça a troca.

Próximo passo gradual: `// @ts-check` nesses módulos (hoje ~200 avisos, quase
todos "elemento do DOM pode ser nulo"), arquivo por arquivo.

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
- Logo dos compradores em "Meus parceiros" (visão de vendedor): exige expor
  `logo_url` do comprador na view `pedidos_painel`.

Já resolvidos (mantidos aqui como histórico): confirmação de pagamento pelo
webhook do gateway (026) e validação do CNPJ no servidor, com prova de posse
(019 e 029).

## Testes

```bash
npm install                      # uma vez
npx playwright install chromium  # uma vez (navegador dos testes de interface)
npm test                         # tudo
npm run test:banco               # migrations + RLS + regras (PostgreSQL em memória)
npm run test:unit                # front-end puro e regras das Edge Functions
npm run tipos                    # regera frontend/types/banco.d.ts das migrations
npm run tipos:checar             # tipos em dia + tsc (Edge Functions e camada de dados)
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
- **Invariantes** (`tests/banco/invariantes.sql`): toda tabela com RLS, toda
  função `SECURITY DEFINER` com `search_path` fixo, funções só-servidor fora
  do alcance do navegador, nenhuma política de escrita para visitante. E as
  migrations da 002 em diante podem ser reaplicadas.
- **Tipos** (sem build): `scripts/gerar-tipos.mjs` sobe o banco em memória,
  aplica as migrations e escreve `frontend/types/banco.d.ts` no formato do
  `supabase gen types`. O `tsc` (TypeScript 6, `tsconfig.json`) checa as
  Edge Functions em modo estrito e os arquivos do front com `// @ts-check`
  (hoje `js/dados/` e `js/dominio/`): na camada de dados, tabela/RPC
  inexistente, argumento errado e coluna inexistente em insert/update viram
  erro. `tests/tipos/camada-de-dados.ts` garante que esses erros continuem
  sendo pegos. **Migration nova → `npm run tipos`** (a CI recusa tipos
  desatualizados).
- **CI** (`.github/workflows/testes.yml`), a cada push:
  - job `testes`: banco em memória, unitários, tipos e interface; testes
    instáveis viram aviso no PR, com o trace guardado;
  - job `supabase-real`: o Postgres **do Supabase** (`supabase db start`,
    CLI fixado) aplica as migrations, `supabase db lint` checa o PL/pgSQL,
    roda os mesmos invariantes, reaplica as migrations (idempotência) e o
    gerador oficial de tipos lê o schema.

## Deploy

Ordem obrigatória: **primeiro o banco, depois o front-end**. O front-end atual
depende das migrations 013 (`motivo_cancelamento`, RPC de cancelamento), 014
(view `pedidos_painel`), 015 (view `alertas`), 016 (view `oportunidades`) e
017 (desempenho do radar; sem ela tudo funciona, só mais lento), 018
(carrinho), 019 (primeiros passos e homologação), 020 (e-mails), 021
(segmentos do radar), 022 (categorias oficiais; converte categorias antigas
fora da lista — veja o cabeçalho da migration), 023 (notificações no app) e
024 (cotações), 025 (LGPD) e 026 (Pix real), 027 (NF-e real; ambos desligados por padrão) e **028
(correção de segurança crítica: escrita pelas views — aplique o quanto
antes; ver `docs/seguranca.md`)** e 029 (posse do CNPJ; modo demonstração
por padrão; contas existentes ganham 30 dias para verificar) e 030 (logo da
empresa: colunas, views e bucket `logos`; sem ela o envio do logo falha e as
telas mostram a inicial). Sem 018–027
a Home continua funcionando: só o envio do carrinho, o checklist, a
verificação de CNPJ, os e-mails, o filtro por segmento e o sino ficam
indisponíveis; a página de cotações e os botões de LGPD do Perfil mostram o erro. Publicar as páginas antes delas
quebra Home, Relatórios, Perfil e Empresas; sem a 015, a página de alertas
mostra erro e o contador do menu fica oculto; sem a 016, o radar mostra
"Radar indisponível" (o resto funciona).
