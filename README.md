# Análise de Lucratividade por Produto

Integração entre a **Loja Integrada** (e-commerce) e o **Bling** (ERP), feita em Google Apps Script, para calcular a margem real de cada produto e orientar decisões de preço.

## O problema

A empresa tinha o preço de venda de cada produto num sistema e o custo em outro, mas não sabia quanto sobrava de verdade depois de impostos, taxas e custos operacionais. Com mais de 9 mil produtos ativos, fazer esse cruzamento à mão era inviável.

## O que o sistema faz

1. **Coleta os preços de venda** da Loja Integrada via API (preço cheio e promocional).
2. **Coleta o custo de cada produto** no Bling via API. Nos kits, o custo já vem somado a partir dos componentes.
3. **Cruza as duas fontes pelo SKU** e grava tudo numa planilha Google Sheets.
4. A planilha calcula o lucro de cada produto:

   `Lucro = preço de venda − imposto (22%) − taxa da plataforma (1%) − anúncios − embalagem − custo`

   e classifica os resultados por faixa de margem, com ranking dos maiores prejuízos e calculadora de preço mínimo.

**Módulos extras:**
- **Leitura de notas fiscais de compra (XML) direto do Gmail**, para apurar o custo unitário real com IPI, ST, frete e descontos.
- **Detalhamento de kits**: lista os componentes de cada produto composto, com quantidade e custo.

## Desafios técnicos

- **Limite de 6 minutos por execução do Apps Script:** o processamento roda em blocos que salvam o progresso e se reagendam sozinhos por gatilho, com aviso por e-mail no fim e um comando de parada.
- **Limites de requisição das APIs:** pausas entre chamadas e novas tentativas automáticas quando a API responde HTTP 429.
- **Paginação instável na API da Loja Integrada:** a listagem de preços em massa gerava itens duplicados e perdidos. A solução foi listar os produtos de forma estável e buscar o preço de cada um individualmente pelo ID.
- **Autenticação:** OAuth2 no Bling (com renovação automática de token) e chaves de API na Loja Integrada, todas guardadas nas Propriedades do script, fora do código.
- **Qualidade dos dados:** detecção de preços corrompidos na importação (células convertidas em data), deduplicação de notas fiscais recebidas mais de uma vez e reprocessamento apenas das linhas com erro.

## Principal resultado

A análise apontou mais de mil produtos com prejuízo aparente. Investigando, boa parte era **custo desatualizado no ERP**, não prejuízo real. A conclusão foi corrigir a base de custos antes de alterar qualquer preço.

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
| `ComponentesBling.gs` | Detalhamento dos componentes de cada kit |
| `ComprasNF.gs` | Leitura de NF-e de compra (XML) no Gmail |

## Tecnologias

Google Apps Script (JavaScript), APIs REST, OAuth2, Google Sheets, Gmail API, processamento de XML.

## Como configurar

Em *Configurações do projeto > Propriedades do script*, cadastre: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `LI_CHAVE_API`, `LI_CHAVE_APLICACAO` e, opcionalmente, `CNPJ_EMPRESA`. Depois rode as funções `passoA`, `passoB` e `passoC` do `Auth.gs` para autorizar o acesso ao Bling.

---

*Regras de negócio, arquitetura e validação definidas por mim; código desenvolvido com assistência de IA.*
