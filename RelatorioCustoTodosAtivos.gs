/**
 * CUSTO DO BLING PARA TODOS OS PRODUTOS ATIVOS (EM BLOCOS)
 * ------------------------------------------------------------------
 * Lê SKU + Preço no Site da aba "Entrada" (que pode ter milhares de linhas) e,
 * para cada linha, busca o "Preço Total de Custo" no Bling — inclusive somando
 * componentes de kits. Como isso pode envolver dezenas de milhares de chamadas
 * à API, processa em blocos de tempo seguro e continua sozinho via gatilho,
 * exatamente como o relatório de Mais Vendidos.
 *
 * COMO RODAR:
 *   1. Garanta que a aba "Entrada" está com SKU + Preço no Site preenchidos
 *      (pode ter milhares de linhas, sem problema).
 *   2. Rode iniciarCustoTodosAtivos() uma vez.
 *   3. Ele mesmo continua em blocos de ~4,5 min via gatilho automático até
 *      terminar. Você recebe um e-mail quando finalizar.
 *   4. O resultado fica na aba "Custo Bling Completo".
 * ------------------------------------------------------------------
 */

const CUSTO_SHEET_NAME = 'Custo Bling Completo';
const CUSTO_TRIGGER_HANDLER = 'continuarCustoTodosAtivos_';
const CUSTO_TEMPO_MAXIMO_MS = 4 * 60 * 1000; // margem maior de segurança sobre o limite de 6 min

/**
 * PASSO 1: inicia o processamento do zero. Agenda a primeira execução via
 * gatilho (em vez de rodar direto), para não depender da aba do navegador/
 * editor continuar aberta — assim, mesmo a primeira etapa roda no servidor
 * do Google, e você pode fechar tudo imediatamente após rodar esta função.
 */
function iniciarCustoTodosAtivos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entradaSheet = ss.getSheetByName(ENTRADA_SHEET_NAME);
  if (!entradaSheet) {
    throw new Error('Aba "Entrada" não encontrada.');
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('CUSTO_LINHA_ATUAL', '2'); // linha 1 é cabeçalho
  props.deleteProperty('CUSTO_PARAR');
  removerGatilhosCusto_();

  const sheet = ss.getSheetByName(CUSTO_SHEET_NAME) || ss.insertSheet(CUSTO_SHEET_NAME);
  sheet.clearContents();
  sheet.appendRow(['SKU', 'Preço no Site', 'Preço de Custo (Bling)', 'Margem %', 'Tipo', 'Status']);
  sheet.setFrozenRows(1);

  agendarContinuacaoCusto_();

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Vai começar em alguns segundos e continuar sozinho em segundo plano. Você recebe um e-mail quando terminar.',
    'Processamento agendado',
    8
  );
}

/**
 * BOTÃO DE PARADA — rode isto para interromper o processamento em blocos.
 * O próximo bloco que rodar vai ver esta marca, parar, e não agendar mais nada.
 * (Apagar o acionador na mão não basta: a execução que já está rodando
 * agenda a próxima antes de terminar.)
 */
function pararCustoTodosAtivos() {
  PropertiesService.getScriptProperties().setProperty('CUSTO_PARAR', 'sim');
  removerGatilhosCusto_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Pedido de parada registrado. O bloco em andamento termina em até 4 minutos e não agenda mais nada.',
    'Parando',
    10
  );
}

/**
 * Processa linhas da aba "Entrada" até acabar o tempo seguro de execução ou
 * até terminar todas. Se não terminar, se reagenda sozinho em 1 minuto.
 */
function continuarCustoTodosAtivos_() {
  const props = PropertiesService.getScriptProperties();

  // Pedido de parada: sai sem reagendar.
  if (props.getProperty('CUSTO_PARAR') === 'sim') {
    removerGatilhosCusto_();
    return;
  }

  const inicioExecucao = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entradaSheet = ss.getSheetByName(ENTRADA_SHEET_NAME);
  const custoSheet = ss.getSheetByName(CUSTO_SHEET_NAME);

  const dados = entradaSheet.getDataRange().getValues();
  const totalLinhas = dados.length; // inclui cabeçalho

  let linhaAtual = Number(props.getProperty('CUSTO_LINHA_ATUAL') || 2);
  let buffer = [];

  while (linhaAtual < totalLinhas + 1) {
    if (Date.now() - inicioExecucao > CUSTO_TEMPO_MAXIMO_MS) {
      escreverBuffer_(custoSheet, buffer);
      props.setProperty('CUSTO_LINHA_ATUAL', String(linhaAtual));
      agendarContinuacaoCusto_();
      return;
    }

    const linhaDados = dados[linhaAtual - 1]; // -1 porque dados[0] é o cabeçalho = linha 1
    if (!linhaDados) break;

    const sku = String(linhaDados[0] || '').trim();
    const valorBrutoPreco = linhaDados[1];

    // Proteção: se a célula virou Data por engano (problema comum de importação
    // de CSV no Sheets), Number(data) resulta num valor gigantesco. Detectamos
    // isso e marcamos como erro em vez de calcular uma margem sem sentido.
    const celulaVirouData = Object.prototype.toString.call(valorBrutoPreco) === '[object Date]';
    const precoSite = celulaVirouData ? NaN : Number(valorBrutoPreco || 0);
    const precoSuspeito = celulaVirouData || !isFinite(precoSite) || precoSite > 50000;

    if (sku) {
      if (precoSuspeito) {
        buffer.push([sku, linhaDados[1], '', '', '', 'Preço no Site inválido (célula pode ter virado data — corrija na aba Entrada e rode de novo)']);
      } else {
      try {
        const custo = calcularPrecoCustoBling_(sku);
        if (!custo.encontrado) {
          buffer.push([sku, precoSite, '', '', '', 'Não encontrado no Bling']);
        } else {
          const margem = custo.precoCusto > 0 ? Math.round(((precoSite - custo.precoCusto) / precoSite) * 10000) / 100 : '';
          buffer.push([sku, precoSite, custo.precoCusto, margem, custo.tipo, 'OK']);
        }
      } catch (e) {
        buffer.push([sku, precoSite, '', '', '', 'Erro: ' + e.message]);

        // Se o erro é de autorização, não adianta continuar: seriam milhares de
        // linhas com o mesmo erro, martelando a API e podendo causar bloqueio.
        // Para tudo e avisa.
        if (e.message.indexOf('não autorizado') !== -1) {
          escreverBuffer_(custoSheet, buffer);
          props.setProperty('CUSTO_PARAR', 'sim');
          removerGatilhosCusto_();
          try {
            MailApp.sendEmail(
              Session.getEffectiveUser().getEmail(),
              'Custo do Bling — parado: autorização expirada',
              'O processamento parou porque a autorização com o Bling expirou.\n\n' +
              'Para retomar: rode passoB_iniciarAutorizacao no Auth.gs, autorize pelo link, ' +
              'confirme com passoC_verificarAutorizacao, e só então rode iniciarCustoTodosAtivos de novo.'
            );
          } catch (eMail) {
            Logger.log('Falha ao enviar e-mail: ' + eMail.message);
          }
          return;
        }
      }
      }
    }

    linhaAtual++;

    // Escreve em disco a cada 25 linhas, para não perder progresso nem
    // acumular um buffer gigante em memória
    if (buffer.length >= 25) {
      escreverBuffer_(custoSheet, buffer);
      buffer = [];
      props.setProperty('CUSTO_LINHA_ATUAL', String(linhaAtual));
    }
  }

  // Terminou tudo
  escreverBuffer_(custoSheet, buffer);
  props.setProperty('CUSTO_LINHA_ATUAL', String(linhaAtual));
  removerGatilhosCusto_();
  finalizarCustoTodosAtivos_();
}

function escreverBuffer_(sheet, buffer) {
  if (buffer.length === 0) return;
  const proximaLinha = sheet.getLastRow() + 1;
  sheet.getRange(proximaLinha, 1, buffer.length, 6).setValues(buffer);
}

function agendarContinuacaoCusto_() {
  removerGatilhosCusto_();
  ScriptApp.newTrigger(CUSTO_TRIGGER_HANDLER)
    .timeBased()
    .after(60 * 1000)
    .create();
}

function removerGatilhosCusto_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === CUSTO_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function finalizarCustoTodosAtivos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'Custo do Bling — processamento concluído',
      'O custo do Bling foi calculado para todos os produtos da aba "Entrada".\n' +
      'Resultado na aba "' + CUSTO_SHEET_NAME + '" da planilha "' + ss.getName() + '".\n' +
      'Link: ' + ss.getUrl()
    );
  } catch (e) {
    Logger.log('Não foi possível enviar o e-mail de aviso: ' + e.message);
  }
}

/**
 * REPROCESSAR SÓ OS ERROS — roda depois que o processamento completo terminar,
 * pra tentar de novo só as linhas com status começando em "Erro" (bem mais
 * rápido que rodar tudo de novo, já que geralmente são poucas linhas).
 */
function reprocessarErrosCusto() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CUSTO_SHEET_NAME);
  if (!sheet) {
    throw new Error('Aba "' + CUSTO_SHEET_NAME + '" não encontrada.');
  }

  const dados = sheet.getDataRange().getValues();
  let corrigidos = 0;
  let aindaComErro = 0;

  for (let i = 1; i < dados.length; i++) {
    const linha = i + 1; // linha real na planilha (1-indexed, +1 pelo cabeçalho)
    const status = String(dados[i][5] || '');

    if (status.indexOf('Erro') !== 0) continue; // só reprocessa quem começa com "Erro"

    const sku = String(dados[i][0] || '').trim();
    const precoSite = Number(dados[i][1] || 0);

    try {
      const custo = calcularPrecoCustoBling_(sku);
      if (!custo.encontrado) {
        sheet.getRange(linha, 3, 1, 4).setValues([['', '', '', 'Não encontrado no Bling']]);
      } else {
        const margem = custo.precoCusto > 0 ? Math.round(((precoSite - custo.precoCusto) / precoSite) * 10000) / 100 : '';
        sheet.getRange(linha, 3, 1, 4).setValues([[custo.precoCusto, margem, custo.tipo, 'OK']]);
        corrigidos++;
      }
    } catch (e) {
      sheet.getRange(linha, 6).setValue('Erro: ' + e.message);
      aindaComErro++;
    }

    Utilities.sleep(150);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(
    corrigidos + ' linha(s) corrigida(s). ' + aindaComErro + ' ainda com erro.',
    'Reprocessamento concluído',
    8
  );
}
