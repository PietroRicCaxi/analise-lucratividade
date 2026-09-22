/**
 * DESCOBRIR OS COMPONENTES DE CADA ANÚNCIO NO BLING
 * ------------------------------------------------------------------
 * Para cada SKU da aba "Investigar" (coluna A), pergunta ao Bling o que
 * tem dentro dele (a "Estrutura") e grava na aba "Componentes":
 * o SKU do produto simples de dentro, a quantidade e o custo atual.
 *
 * Usa as funções que já existem no BlingAPI.gs e no Auth.gs.
 *
 * COMO RODAR:
 *   1. Cole a lista de SKUs na aba "Investigar", coluna A, a partir da A2
 *      (A1 = "SKU").
 *   2. Rode iniciarComponentes(). Roda sozinho em blocos, devagar,
 *      e manda e-mail no fim.
 *   3. Para interromper: pararComponentes().
 * ------------------------------------------------------------------
 */

const COMP_ENTRADA = 'Investigar';
const COMP_SAIDA = 'Componentes';
const COMP_TRIGGER = 'continuarComponentes_';
const COMP_TEMPO_MAXIMO_MS = 4 * 60 * 1000;
const COMP_PAUSA_MS = 400; // pausa extra entre anúncios, além da do blingFetch_

const COMP_CABECALHO = [
  'SKU anúncio', 'Formato anúncio', 'Custo total anúncio (Bling)',
  'SKU componente', 'Nome componente', 'Qtd', 'Custo componente (Bling)',
  'Formato componente', 'ID componente', 'Status'
];

function iniciarComponentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(COMP_ENTRADA)) {
    throw new Error('Crie a aba "' + COMP_ENTRADA + '" com os SKUs na coluna A (a partir da A2).');
  }

  // Confere a autorização ANTES de começar, para não gravar centenas de erros.
  getBlingAccessToken_();

  const saida = ss.getSheetByName(COMP_SAIDA) || ss.insertSheet(COMP_SAIDA);
  saida.clear();
  saida.appendRow(COMP_CABECALHO);
  saida.setFrozenRows(1);
  saida.getRange('A:A').setNumberFormat('@');
  saida.getRange('D:D').setNumberFormat('@');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('COMP_LINHA', '2');
  props.deleteProperty('COMP_PARAR');

  agendarComponentes_();
  ss.toast('Vai começar em alguns segundos. Você recebe um e-mail quando terminar.', 'Busca de componentes agendada', 8);
}

function pararComponentes() {
  PropertiesService.getScriptProperties().setProperty('COMP_PARAR', 'sim');
  removerGatilhosComponentes_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Pedido de parada registrado. O bloco em andamento termina em até 4 minutos.', 'Parando', 10);
}

function continuarComponentes_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('COMP_PARAR') === 'sim') {
    removerGatilhosComponentes_();
    return;
  }

  const inicio = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entrada = ss.getSheetByName(COMP_ENTRADA);
  const saida = ss.getSheetByName(COMP_SAIDA);
  const skus = entrada.getRange('A:A').getValues().map(function (l) { return String(l[0] || '').trim(); });
  let linha = Number(props.getProperty('COMP_LINHA') || 2);

  while (linha <= skus.length) {
    if (Date.now() - inicio > COMP_TEMPO_MAXIMO_MS) {
      props.setProperty('COMP_LINHA', String(linha));
      agendarComponentes_();
      return;
    }

    const sku = skus[linha - 1];
    if (sku) {
      let linhas;
      try {
        linhas = buscarComponentes_(sku);
      } catch (e) {
        if (String(e.message).indexOf('não autorizado') !== -1) {
          props.setProperty('COMP_LINHA', String(linha));
          removerGatilhosComponentes_();
          avisarComponentes_('Busca de componentes parada: autorização do Bling expirou',
            'Rode passoB_iniciarAutorizacao no Auth.gs, autorize, e depois rode continuarComponentes_ para retomar de onde parou (linha ' + linha + ').');
          return;
        }
        linhas = [[sku, '', '', '', '', '', '', '', '', 'Erro: ' + e.message]];
      }
      saida.getRange(saida.getLastRow() + 1, 1, linhas.length, COMP_CABECALHO.length).setValues(linhas);
      Utilities.sleep(COMP_PAUSA_MS);
    }
    linha++;
    props.setProperty('COMP_LINHA', String(linha));
  }

  removerGatilhosComponentes_();
  avisarComponentes_('Busca de componentes concluída',
    'Resultado na aba "' + COMP_SAIDA + '".\nLink: ' + ss.getUrl());
}

/** Devolve uma ou mais linhas (uma por componente) para um SKU de anúncio. */
function buscarComponentes_(sku) {
  const resumo = buscarProdutoBlingPorSKU_(sku);
  if (!resumo) {
    return [[sku, '', '', '', '', '', '', '', '', 'Não encontrado no Bling']];
  }

  const detalhe = buscarDetalheProdutoBling_(resumo.id);
  const formato = detalhe.formato || '';
  const custoTotal = resumo.precoCusto || 0;
  const comps = (detalhe.estrutura && detalhe.estrutura.componentes) || [];

  // Produto simples: ele mesmo é o "componente".
  if (comps.length === 0) {
    const custo = (detalhe.fornecedor && detalhe.fornecedor.precoCusto) || 0;
    return [[sku, formato, custoTotal, detalhe.codigo, detalhe.nome, 1, custo, formato, detalhe.id, 'OK (é simples)']];
  }

  return comps.map(function (c) {
    const idComp = c.produto && c.produto.id;
    const d = buscarDetalheProdutoBling_(idComp);
    const custo = (d.fornecedor && d.fornecedor.precoCusto) || 0;
    return [sku, formato, custoTotal, d.codigo, d.nome, c.quantidade || 0, custo, d.formato || '', idComp, 'OK'];
  });
}

function agendarComponentes_() {
  removerGatilhosComponentes_();
  ScriptApp.newTrigger(COMP_TRIGGER).timeBased().after(60 * 1000).create();
}

function removerGatilhosComponentes_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === COMP_TRIGGER) ScriptApp.deleteTrigger(t);
  });
}

function avisarComponentes_(assunto, corpo) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), assunto, corpo);
  } catch (e) {
    Logger.log('Falha ao enviar e-mail: ' + e.message);
  }
}
