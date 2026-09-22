/**
 * ATUALIZAR ABA "ENTRADA" AUTOMATICAMENTE VIA API DA LOJA INTEGRADA
 * ------------------------------------------------------------------
 * Substitui o processo manual de exportar/colar SKU + Preço no Site.
 *
 * Por que em duas fases: a listagem em massa de preços (/produto_preco/) não
 * é confiável via paginação nessa API (confirmado via diagnóstico — sem campo
 * de ordenação estável, causa duplicatas/itens perdidos). A listagem de
 * PRODUTOS (/produto/) já aceita order_by=id e é estável. Solução: listamos
 * produtos de forma estável, e para cada um buscamos o preço individualmente
 * por ID (/produto_preco/{id}/, confirmado confiável) — só que isso são
 * milhares de chamadas, por isso roda em blocos com continuação automática.
 *
 * COMO RODAR:
 *   1. Rode iniciarAtualizacaoEntrada() uma vez.
 *      - Fase 1 (rápida, roda na hora): lista todos os produtos vendáveis e
 *        ativos, grava SKU + ID na aba "Entrada" (coluna C = ID, oculto/auxiliar).
 *      - Fase 2 (lenta, em blocos via gatilho): busca o preço de cada um
 *        individualmente e preenche a coluna B. Pode levar bastante tempo
 *        (milhares de produtos, respeitando limite de 100 req/min da loja).
 *   2. Você recebe um e-mail quando a Fase 2 terminar.
 * ------------------------------------------------------------------
 */

const ENTRADA_ID_TRIGGER_HANDLER = 'continuarPrecosViaAPI_';
const ENTRADA_ID_TEMPO_MAXIMO_MS = 4 * 60 * 1000;

/**
 * FASE 1: lista produtos vendáveis e ativos (estável, com order_by=id) e
 * grava SKU + ID na aba "Entrada". Preço fica em branco, para a Fase 2 preencher.
 */
function iniciarAtualizacaoEntrada() {
  const chaveApi = getProp_('LI_CHAVE_API');
  const chaveAplicacao = getProp_('LI_CHAVE_APLICACAO');
  const headers = { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao };

  const produtos = [];
  let offset = 0;
  const limit = 100;
  let totalCount = null;

  do {
    const url = LI_BASE_URL + '/produto/?format=json&order_by=id&limit=' + limit + '&offset=' + offset;
    const response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error('Erro ao listar produtos (' + response.getResponseCode() + '): ' + response.getContentText());
    }
    const data = JSON.parse(response.getContentText());

    (data.objects || []).forEach(function (produto) {
      const vendavel = produto.tipo === 'normal' || produto.tipo === 'atributo_opcao';
      const disponivel = produto.ativo === true && produto.bloqueado !== true && produto.removido !== true;
      if (vendavel && disponivel && produto.sku) {
        produtos.push([produto.sku, '', produto.id]);
      }
    });

    totalCount = (data.meta && data.meta.total_count) || 0;
    offset += limit;
    Utilities.sleep(200);
  } while (offset < totalCount);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entradaSheet = ss.getSheetByName(ENTRADA_SHEET_NAME) || ss.insertSheet(ENTRADA_SHEET_NAME);
  entradaSheet.clearContents();
  entradaSheet.appendRow(['SKU', 'Preço no Site', 'ID Loja Integrada (auxiliar — não apagar)']);
  entradaSheet.setFrozenRows(1);
  if (produtos.length > 0) {
    entradaSheet.getRange(2, 1, produtos.length, 3).setValues(produtos);
  }

  PropertiesService.getScriptProperties().setProperty('ENTRADA_LINHA_ATUAL', '2');
  removerGatilhosEntrada_();

  SpreadsheetApp.getActiveSpreadsheet().toast(
    produtos.length + ' produtos listados. Agora buscando o preço de cada um em segundo plano — ' +
    'pode demorar, você recebe um e-mail quando terminar.',
    'Fase 1 concluída, Fase 2 iniciada',
    8
  );

  agendarContinuacaoEntrada_();
}

/**
 * FASE 2: busca o preço individualmente para cada linha da aba "Entrada" que
 * ainda não tem preço preenchido, usando o ID salvo na coluna C.
 */
function continuarPrecosViaAPI_() {
  const inicioExecucao = Date.now();
  const chaveApi = getProp_('LI_CHAVE_API');
  const chaveAplicacao = getProp_('LI_CHAVE_APLICACAO');
  const headers = { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ENTRADA_SHEET_NAME);
  const props = PropertiesService.getScriptProperties();

  try {
    const dados = sheet.getDataRange().getValues();
    const totalLinhas = dados.length;
    let linhaAtual = Number(props.getProperty('ENTRADA_LINHA_ATUAL') || 2);

    while (linhaAtual <= totalLinhas) {
      if (Date.now() - inicioExecucao > ENTRADA_ID_TEMPO_MAXIMO_MS) {
        props.setProperty('ENTRADA_LINHA_ATUAL', String(linhaAtual));
        agendarContinuacaoEntrada_();
        return;
      }

      const linhaDados = dados[linhaAtual - 1];
      const idProduto = linhaDados[2];

      if (idProduto) {
        try {
          const url = LI_BASE_URL + '/produto_preco/' + idProduto + '/?format=json';
          const response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });

          if (response.getResponseCode() === 200) {
            const preco = JSON.parse(response.getContentText());
            const cheio = Number(preco.cheio || 0);
            const promocional = Number(preco.promocional || 0);
            const efetivo = promocional > 0 ? promocional : cheio;
            sheet.getRange(linhaAtual, 2).setValue(efetivo);
          } else {
            sheet.getRange(linhaAtual, 2).setValue('ERRO_' + response.getResponseCode());
          }
        } catch (erroLinha) {
          // Erro pontual numa linha (ex: timeout de rede) não deve derrubar
          // o processamento inteiro — marca a linha e segue para a próxima.
          sheet.getRange(linhaAtual, 2).setValue('ERRO');
        }
        Utilities.sleep(650); // ~92 req/min, dentro do limite de 100/min da loja
      }

      linhaAtual++;
    }

    props.setProperty('ENTRADA_LINHA_ATUAL', String(linhaAtual));
    removerGatilhosEntrada_();
    finalizarAtualizacaoEntrada_();
  } catch (erroFatal) {
    // Erro inesperado que interrompeu a execução inteira — avisa por e-mail
    // em vez de falhar silenciosamente sem o usuário saber.
    removerGatilhosEntrada_();
    try {
      MailApp.sendEmail(
        Session.getEffectiveUser().getEmail(),
        'Erro ao atualizar aba "Entrada" via API',
        'O processamento parou por causa de um erro:\n\n' + erroFatal.message +
        '\n\nVerifique a aba "Entrada" e rode iniciarAtualizacaoEntrada() de novo se necessário.'
      );
    } catch (e) {
      Logger.log('Falha ao enviar e-mail de erro: ' + e.message);
    }
    throw erroFatal;
  }
}

function agendarContinuacaoEntrada_() {
  removerGatilhosEntrada_();
  ScriptApp.newTrigger(ENTRADA_ID_TRIGGER_HANDLER)
    .timeBased()
    .after(60 * 1000)
    .create();
}

function removerGatilhosEntrada_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === ENTRADA_ID_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function finalizarAtualizacaoEntrada_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'Aba "Entrada" atualizada via API',
      'Todos os preços foram buscados na Loja Integrada e preenchidos na aba "Entrada".\n' +
      'Agora você pode rodar atualizarComparacaoPrecos ou iniciarCustoTodosAtivos normalmente.\n' +
      'Link: ' + ss.getUrl()
    );
  } catch (e) {
    Logger.log('Não foi possível enviar o e-mail de aviso: ' + e.message);
  }
}
