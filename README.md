# Análise de Lucratividade por Produto

Integração entre a **Loja Integrada** (e-commerce) e o **Bling** (ERP), feita em Google Apps Script, para calcular a margem real de cada produto, sustentar a decisão de preço em dados rastreáveis e apresentar o resultado num painel web para a gestão.

## O problema

A empresa tinha o preço de venda de cada produto num sistema e o custo em outro, mas não sabia quanto sobrava de verdade depois de impostos, taxas e custos operacionais. Com mais de 9 mil produtos ativos, fazer esse cruzamento à mão era inviável.

Havia um problema embaixo do problema: **boa parte dos custos cadastrados no ERP estava errada**. Calcular margem sobre custo errado produz um número pior do que nenhum número, porque parece confiável.

## O que o sistema faz

1. **Coleta os preços de venda** da Loja Integrada via API (preço cheio e promocional).
2. **Coleta o custo de cada produto** no Bling via API, somando a estrutura quando o produto é um kit.
3. **Cruza as duas fontes pelo SKU** e grava tudo numa planilha Google Sheets.
4. **Calcula o lucro de cada produto:**

   `Lucro = preço de venda − imposto − taxa da plataforma − anúncios − embalagem − custo`

   O custo de anúncios aceita valor fixo em reais, percentual do preço, ou os dois somados.
5. **Publica um painel web** com a distribuição do catálogo por faixa de margem, o ranking dos maiores prejuízos e o detalhamento clicável de cada categoria.

Todos os parâmetros do cálculo — imposto, plataforma, anúncios, embalagem por faixa de preço e meta de lucro — ficam numa aba da planilha. Mudar a regra de negócio não exige tocar no código nem republicar o app.

**Módulos de apuração de custo:**
- **Leitura de notas fiscais de compra (XML) direto do Gmail**, para apurar o custo unitário real com IPI, ST, frete e descontos.
- **Detalhamento de kits**: lista os componentes de cada produto composto, com quantidade e custo.
- **Correção de custos zerados**: recalcula pela estrutura os produtos cujo custo a API do Bling devolve vazio.

## O painel

App web servido pelo próprio Apps Script, com link restrito à organização. Lê a planilha, não as APIs, então abre em segundo.

- Classifica os anúncios em **saudável, abaixo de 20%, abaixo de 10%, prejuízo, presilhas avulsas e sem custo cadastrado**
- Mostra onde o problema se concentra por faixa de preço
- Clicar numa barra abre a lista dos produtos daquela categoria, paginada de 10 em 10, com ordenação por coluna resolvida no servidor
- Cache de 30 minutos, com botão para recalcular na hora

A categoria **presilhas avulsas** existe por uma razão de método: custos fixos como anúncio e embalagem são por pedido, não por unidade. Rateá-los sobre uma presilha de R$ 2,50 produz prejuízo contábil onde não há prejuízo real. Separá-las evita que 973 falsos positivos contaminem a leitura do catálogo.

## Atualização automática

Três gatilhos diários mantêm a base em dia sem intervenção:

| Horário | O que faz |
|---|---|
| 01h | Relê produtos e preços da Loja Integrada — pega anúncio novo e mudança de preço |
| 05h | Relê os preços de custo do Bling — pega correção de custo |
| 09h | Limpa o cache e grava o retrato do dia na aba de histórico |

O passo das 05h confere se o das 01h terminou antes de começar, para os dois não disputarem a cota diária de execução do Apps Script.

## Desafios técnicos

- **Limite de 6 minutos por execução do Apps Script:** o processamento roda em blocos que salvam o progresso e se reagendam sozinhos por gatilho, com aviso por e-mail no fim e um comando de parada.
- **Limites de requisição das APIs:** pausas entre chamadas e novas tentativas automáticas quando a API responde HTTP 429.
- **Paginação instável na API da Loja Integrada:** a listagem de preços em massa gerava itens duplicados e perdidos. A solução foi listar os produtos de forma estável e buscar o preço de cada um individualmente pelo ID.
- **Custo de kit inconsistente na API do Bling:** o mesmo endpoint devolve o custo somado para a maioria dos kits e zero para alguns, sem padrão. O efeito eram anúncios exibindo margem de 75% por falta de custo. A solução usa o valor do Bling quando ele vem preenchido e soma a estrutura quando vem zero — recuperou 84 dos 91 casos.
- **Volume de chamadas:** cache em dois níveis (memória e `CacheService`) para os componentes que se repetem em centenas de anúncios, reduzindo a varredura de ~30 mil chamadas para cerca de metade.
- **Autenticação:** OAuth2 no Bling (com renovação automática de token) e chaves de API na Loja Integrada, todas guardadas nas Propriedades do script, fora do código.
- **Qualidade dos dados:** detecção de preços corrompidos na importação (células convertidas em data), deduplicação de notas fiscais recebidas mais de uma vez e reprocessamento apenas das linhas com erro.

## Resultados

**Rastreamento da base de custos.** Os 9 mil anúncios se decompõem em 2.880 componentes distintos. Cruzando o código de cada um com as notas fiscais dos fornecedores e o histórico de importação — inclusive extraindo códigos de fornecedor escondidos dentro do campo de descrição — **1.507 componentes foram amarrados a um documento de compra**, cobrindo 78% do catálogo.

**Correção de custos.** Desses, 239 estavam comprovadamente errados e foram corrigidos no ERP via importação em massa, afetando o custo de 329 anúncios. O padrão de erro mais comum: valores lançados sem a conversão da planilha de importação, ficando 10× abaixo do real.

**Validação cruzada.** A soma dos componentes bateu com o custo que o próprio Bling reporta em 8.901 de 8.907 anúncios, o que confirma que a leitura das estruturas está correta e não é aproximação.

**Achado que mudou a decisão.** A análise inicial apontava mais de mil produtos em prejuízo. Investigando, a maior parte era efeito de um parâmetro: um custo fixo de anúncios de R$ 3 por venda torna **matematicamente impossível** qualquer produto abaixo de R$ 7,02 atingir 20% de margem, mesmo com custo zero. Eram 876 presilhas avulsas nessa faixa, e 964 delas passam de 20% quando avaliadas só por imposto e custo. O prejuízo real ficou em 185 anúncios.

A conclusão levada à gestão foi que o parâmetro de anúncios pesa mais na classificação do que toda a correção de custos — e que o número precisa vir do custo por conversão real do Google Ads, não de uma estimativa.

## Estrutura dos arquivos

| Arquivo | Função |
|---|---|
| `Auth.gs` | Autorização OAuth2 com o Bling |
| `Config.gs` | Configurações e leitura das propriedades do script |
| `BlingAPI.gs` | Chamadas à API do Bling, com retry e cache |
| `LojaIntegradaAPI.gs` | Chamadas à API da Loja Integrada e funções de diagnóstico |
| `Main.gs` | Comparativo principal custo x preço |
| `AtualizarEntradaViaAPI.gs` | Coleta automática de SKUs e preços da loja |
| `RelatorioCustoTodosAtivos.gs` | Cálculo de custo e margem para todos os produtos, em blocos |
| `ComponentesBling.gs` | Detalhamento dos componentes de cada kit, com cache |
| `ComprasNF.gs` | Leitura de NF-e de compra (XML) no Gmail |
| `CorrigirCustoZero.gs` | Custo pela estrutura quando a API do Bling devolve zero |
| `Painel.gs` | Servidor do app web: leitura, classificação e paginação |
| `PainelPagina.html` | Página do painel — gráficos, drill-down e ordenação |
| `AtualizacaoDiaria.gs` | Gatilhos diários de atualização e histórico |

## Tecnologias

Google Apps Script (JavaScript), APIs REST, OAuth2, Google Sheets, Gmail API, processamento de XML, HtmlService.

## Como configurar

Em *Configurações do projeto > Propriedades do script*, cadastre: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `LI_CHAVE_API`, `LI_CHAVE_APLICACAO` e, opcionalmente, `CNPJ_EMPRESA`. Depois rode as funções `passoA`, `passoB` e `passoC` do `Auth.gs` para autorizar o acesso ao Bling.

Para o painel: rode `criarParametros` uma vez, publique como App da Web (executar como você, acesso restrito à organização) e rode `instalarGatilhosDiarios` para ligar a atualização automática.

## Limitações conhecidas

- 325 componentes não têm origem de compra localizada — são itens anteriores ao período coberto pelas notas no e-mail. O custo cadastrado neles é mantido, mas não foi validado.
- O sistema é somente leitura: não altera preço na loja nem custo no ERP. As correções saem como arquivo de importação, revisado antes de subir.
- O custo de anúncios ainda é um parâmetro estimado, não o custo por conversão real por produto.

---

*Regras de negócio, arquitetura e validação definidas por mim; código desenvolvido com assistência de IA.*
