/**
 * ATUALIZAÇÃO AUTOMÁTICA DIÁRIA
 * ------------------------------------------------------------------
 * Mantém o painel em dia sem ninguém rodar nada. Três gatilhos:
 *
 *   01h  passo1_produtosDaLojaIntegrada  → anúncios novos e preços novos da LI
 *   05h  passo2_custosDoBling            → preços de custo atualizados do Bling
 *   09h  passo3_fecharDia                → limpa o cache e grava o histórico
 *
 * O intervalo entre os passos é proposital: cada um roda em blocos de
 * 4 minutos e pode levar horas. Se o passo 1 ainda estiver rodando quando
 * o 2 começar, os dois disputam a cota diária do Apps Script — por isso
 * o passo 2 confere antes de começar e, se o 1 não terminou, apenas avisa.
 *
 * COMO INSTALAR: rode instalarGatilhosDiarios() uma vez.
 * Para desligar tudo: removerGatilhosDiarios().
 * ------------------------------------------------------------------
 */

const AD_FUNCOES = ['passo1_produtosDaLojaIntegrada', 'passo2_custosDoBling', 'passo3_fecharDia'];

function instalarGatilhosDiarios() {
  removerGatilhosDiarios();
  ScriptApp.newTrigger('passo1_produtosDaLojaIntegrada').timeBased().atHour(1).everyDays(1).create();
  ScriptApp.newTrigger('passo2_custosDoBling').timeBased().atHour(5).everyDays(1).create();
  ScriptApp.newTrigger('passo3_fecharDia').timeBased().atHour(9).everyDays(1).create();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Gatilhos criados: 01h produtos da LI, 05h custos do Bling, 09h fechamento.',
    'Atualização diária ligada', 10);
}

function removerGatilhosDiarios() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (AD_FUNCOES.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}

/** 01h — relê a lista de produtos ativos e os preços na Loja Integrada. */
function passo1_produtosDaLojaIntegrada() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('AD_ETAPA', 'entrada');
  props.setProperty('AD_INICIO', new Date().toISOString());
  iniciarAtualizacaoEntrada();
}

/** 05h — relê os preços de custo do Bling para todos os anúncios ativos. */
function passo2_custosDoBling() {
  const props = PropertiesService.getScriptProperties();

  // Se a fase de preços da LI ainda estiver rodando, não começa outra coisa.
  const gatilhosVivos = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'continuarPrecosViaAPI_';
  });
  if (gatilhosVivos) {
    avisarDiaria_('Atualização diária: passo 2 adiado',
      'A leitura de preços da Loja Integrada ainda estava rodando às 5h, então os custos do ' +
      'Bling não foram atualizados hoje. O painel segue com os dados de ontem.\n\n' +
      'Se isso virar rotina, afaste mais os gatilhos em instalarGatilhosDiarios().');
    return;
  }

  props.setProperty('AD_ETAPA', 'custo');
  iniciarCustoTodosAtivos();
}

/** 09h — limpa o cache do painel e guarda o retrato do dia. */
function passo3_fecharDia() {
  try { CacheService.getScriptCache().remove('painel_dados'); } catch (e) { /* segue */ }
  try {
    registrarHistorico();
  } catch (e) {
    avisarDiaria_('Atualização diária: falha ao gravar o histórico', e.message);
    return;
  }
  PropertiesService.getScriptProperties().setProperty('AD_ETAPA', 'pronto');
}

function avisarDiaria_(assunto, corpo) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), assunto, corpo);
  } catch (e) {
    Logger.log('Falha ao enviar e-mail: ' + e.message);
  }
}

/** Diagnóstico: mostra em que pé está a atualização. Rode quando quiser conferir. */
function statusAtualizacaoDiaria() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const custo = ss.getSheetByName('Custo Bling Completo');
  const entrada = ss.getSheetByName('Entrada');
  const gatilhos = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  const msg =
    'Etapa: ' + (props.getProperty('AD_ETAPA') || 'nunca rodou') + '\n' +
    'Início do último ciclo: ' + (props.getProperty('AD_INICIO') || '—') + '\n' +
    'Linhas em Entrada: ' + (entrada ? entrada.getLastRow() : 'aba não existe') + '\n' +
    'Linhas em Custo Bling Completo: ' + (custo ? custo.getLastRow() : 'aba não existe') + '\n' +
    'Gatilhos ativos: ' + (gatilhos.length ? gatilhos.join(', ') : 'nenhum');
  Logger.log(msg);
  ss.toast(msg, 'Status da atualização', 20);
  return msg;
}
