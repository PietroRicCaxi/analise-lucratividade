/**
 * PLANILHA — COMPARATIVO DE PREÇO DE CUSTO (BLING) x PREÇO NO SITE (LOJA INTEGRADA)
 * ------------------------------------------------------------------
 * Fluxo:
 *  1. Obtém a lista de produtos a comparar (SKU + preço no site)
 *  2. Para cada SKU, busca no Bling o "Preço Total de Custo"
 *  3. Grava tudo na aba "Comparativo"
 *
 * MODO_MANUAL:
 *  - true  -> lê SKU + Preço no Site da aba "Entrada" (preenchida à mão),
 *             enquanto aguardamos a Chave de Aplicação da Loja Integrada.
 *  - false -> busca automaticamente via API da Loja Integrada.
 *  Assim que a chave de aplicação chegar, troque para false e pronto —
 *  não precisa mexer em mais nada.
 * ------------------------------------------------------------------
 */

const MODO_MANUAL = true;
const ENTRADA_SHEET_NAME = 'Entrada';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Comparativo de Preços')
    .addItem('Atualizar agora', 'atualizarComparacaoPrecos')
    .addToUi();
}

/**
 * Retorna a lista de produtos a comparar: [{ sku, preco }, ...]
 */
function obterProdutosParaComparar_() {
  if (!MODO_MANUAL) {
    return listarProdutosAtivosLojaIntegrada_();
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entradaSheet = ss.getSheetByName(ENTRADA_SHEET_NAME);

  if (!entradaSheet) {
    throw new Error(
      'Aba "Entrada" não encontrada. Crie uma aba chamada "Entrada" com as colunas ' +
      '"SKU" e "Preço no Site" (uma linha de cabeçalho + os dados a partir da linha 2).'
    );
  }

  const dados = entradaSheet.getDataRange().getValues();
  const produtos = [];

  // Pula a primeira linha (cabeçalho)
  for (let i = 1; i < dados.length; i++) {
    const sku = dados[i][0];
    const preco = dados[i][1];
    if (sku) {
      produtos.push({ sku: String(sku).trim(), preco: Number(preco || 0) });
    }
  }

  return produtos;
}

/**
 * Função principal — pode ser chamada pelo menu acima ou por um botão na planilha.
 *
 * Para criar o botão:
 *  1. Inserir > Desenho, crie um botão simples, clique em Salvar e Fechar
 *  2. Clique no desenho, depois nos 3 pontinhos no canto > Atribuir script
 *  3. Digite exatamente: atualizarComparacaoPrecos
 */
function atualizarComparacaoPrecos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    SpreadsheetApp.getUi().alert('Já existe uma atualização em andamento. Tente novamente em alguns instantes.');
    return;
  }

  try {
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    const logSheet = ss.getSheetByName(LOG_SHEET_NAME) || ss.insertSheet(LOG_SHEET_NAME);

    sheet.clearContents();
    sheet.appendRow(['SKU', 'Preço de Custo (Bling)', 'Preço no Site', 'Diferença (Site - Custo)', 'Margem %', 'Status', 'Atualizado em']);
    sheet.setFrozenRows(1);

    const produtosLI = obterProdutosParaComparar_();
    const agora = new Date();
    const linhas = [];
    const erros = [];

    produtosLI.forEach(function (produto) {
      if (!produto.sku) return;

      try {
        const custo = calcularPrecoCustoBling_(produto.sku);

        if (!custo.encontrado) {
          linhas.push([produto.sku, '', produto.preco, '', '', 'Não encontrado no Bling', agora]);
          return;
        }

        const diferenca = produto.preco - custo.precoCusto;
        const margem = custo.precoCusto > 0 ? (diferenca / produto.preco) * 100 : '';

        linhas.push([
          produto.sku,
          custo.precoCusto,
          produto.preco,
          Math.round(diferenca * 100) / 100,
          margem === '' ? '' : Math.round(margem * 100) / 100,
          'OK',
          agora
        ]);
      } catch (e) {
        erros.push(produto.sku + ': ' + e.message);
        linhas.push([produto.sku, '', produto.preco, '', '', 'Erro: ' + e.message, agora]);
      }
    });

    if (linhas.length > 0) {
      sheet.getRange(2, 1, linhas.length, 7).setValues(linhas);
    }

    logSheet.appendRow([agora, 'Execução concluída', linhas.length + ' produtos processados', erros.length + ' erros']);
    if (erros.length > 0) {
      logSheet.appendRow([agora, 'Erros', erros.join(' | ')]);
    }

    SpreadsheetApp.getUi().alert(
      'Atualização concluída: ' + linhas.length + ' produtos processados (' + erros.length + ' erros).\n' +
      'Veja a aba "Log" para detalhes.'
    );
  } finally {
    lock.releaseLock();
  }
}
