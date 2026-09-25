/**
 * DESCOBRIR OS COMPONENTES DE CADA ANÚNCIO NO BLING  (versão com cache)
 * ------------------------------------------------------------------
 * Para cada SKU da aba "Investigar" (coluna A), pergunta ao Bling o que
 * tem dentro dele (a "Estrutura") e grava na aba "Componentes":
 * o SKU do produto simples de dentro, a quantidade e o custo atual.
 *
 * NOVIDADE: cada componente é consultado no Bling UMA vez só.
 * Os grampos e brindes aparecem em centenas de anúncios; antes eram
 * consultados de novo a cada anúncio. Agora ficam guardados em cache
 * (memória + CacheService, 6 horas), o que corta o número de chamadas
 * à API praticamente pela metade e o tempo de 3-5h para ~1h30-2h.
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
const COMP_CACHE_SEGUNDOS = 6 * 60 * 60; // 6 horas (máximo do CacheService)
const COMP_LOTE_GRAVACAO = 200; // grava na planilha de 200 em 200 linhas

const COMP_CABECALHO = [
  'SKU anúncio', 'Formato anúncio', 'Custo total anúncio (Bling)',
  'SKU componente', 'Nome componente', 'Qtd', 'Custo componente (Bling)',
  'Formato componente', 'ID componente', 'Status'
];

// Cache em memória, válido dentro de um bloco de 4 minutos.
let _compMemoria = {};

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

/** Retoma de onde parou, sem apagar o que já foi gravado. */
function retomarComponentes() {
  PropertiesService.getScriptProperties().deleteProperty('COMP_PARAR');
  agendarComponentes_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Vai retomar da linha ' +
    (PropertiesService.getScriptProperties().getProperty('COMP_LINHA') || '2') +
    ' em alguns segundos.', 'Retomando', 8);
}

function continuarComponentes_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('COMP_PARAR') === 'sim') {
    removerGatilhosComponentes_();
    return;
  }

  _compMemoria = {}; // começa limpo a cada bloco

  const inicio = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entrada = ss.getSheetByName(COMP_ENTRADA);
  const saida = ss.getSheetByName(COMP_SAIDA);
  const skus = entrada.getRange('A:A').getValues().map(function (l) { return String(l[0] || '').trim(); });
  let linha = Number(props.getProperty('COMP_LINHA') || 2);

  let buffer = [];

  while (linha <= skus.length) {
    if (Date.now() - inicio > COMP_TEMPO_MAXIMO_MS) {
      gravarComponentes_(saida, buffer);
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
          gravarComponentes_(saida, buffer);
          props.setProperty('COMP_LINHA', String(linha));
          removerGatilhosComponentes_();
          avisarComponentes_('Busca de componentes parada: autorização do Bling expirou',
            'Rode passoB_iniciarAutorizacao no Auth.gs, autorize, e depois rode retomarComponentes para continuar de onde parou (linha ' + linha + ').');
          return;
        }
        linhas = [[sku, '', '', '', '', '', '', '', '', 'Erro: ' + e.message]];
      }
      buffer = buffer.concat(linhas);
      if (buffer.length >= COMP_LOTE_GRAVACAO) {
        gravarComponentes_(saida, buffer);
        buffer = [];
      }
      Utilities.sleep(COMP_PAUSA_MS);
    }
    linha++;
    props.setProperty('COMP_LINHA', String(linha));
  }

  gravarComponentes_(saida, buffer);
  removerGatilhosComponentes_();
  avisarComponentes_('Busca de componentes concluída',
    'Resultado na aba "' + COMP_SAIDA + '".\nLink: ' + ss.getUrl());
}

function gravarComponentes_(saida, linhas) {
  if (!linhas || linhas.length === 0) return;
  saida.getRange(saida.getLastRow() + 1, 1, linhas.length, COMP_CABECALHO.length).setValues(linhas);
  SpreadsheetApp.flush();
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

  // Guarda o próprio anúncio no cache: ele pode ser componente de outro.
  guardarNoCache_(resumo.id, resumirComponente_(detalhe));

  // Produto simples: ele mesmo é o "componente".
  if (comps.length === 0) {
    const custo = (detalhe.fornecedor && detalhe.fornecedor.precoCusto) || 0;
    return [[sku, formato, custoTotal, detalhe.codigo, detalhe.nome, 1, custo, formato, detalhe.id, 'OK (é simples)']];
  }

  return comps.map(function (c) {
    const idComp = c.produto && c.produto.id;
    const d = componenteComCache_(idComp);
    return [sku, formato, custoTotal, d.codigo, d.nome, c.quantidade || 0, d.custo, d.formato, idComp, 'OK'];
  });
}

/** Só os campos que interessam, para caber no cache. */
function resumirComponente_(detalhe) {
  return {
    codigo: detalhe.codigo || '',
    nome: detalhe.nome || '',
    custo: (detalhe.fornecedor && detalhe.fornecedor.precoCusto) || 0,
    formato: detalhe.formato || ''
  };
}

/**
 * Busca o componente no Bling só se ele ainda não for conhecido.
 * Ordem: memória do bloco > CacheService (6h) > API.
 */
function componenteComCache_(idComp) {
  const chave = 'comp_' + idComp;

  if (_compMemoria[chave]) return _compMemoria[chave];

  const cache = CacheService.getScriptCache();
  const guardado = cache.get(chave);
  if (guardado) {
    try {
      const obj = JSON.parse(guardado);
      _compMemoria[chave] = obj;
      return obj;
    } catch (e) {
      // cache corrompido: ignora e busca de novo
    }
  }

  const d = buscarDetalheProdutoBling_(idComp);
  const resumo = resumirComponente_(d);
  _compMemoria[chave] = resumo;
  try {
    cache.put(chave, JSON.stringify(resumo), COMP_CACHE_SEGUNDOS);
  } catch (e) {
    Logger.log('Não foi possível guardar no cache: ' + e.message);
  }
  return resumo;
}

function guardarNoCache_(id, resumo) {
  if (!id) return;
  const chave = 'comp_' + id;
  _compMemoria[chave] = resumo;
  try {
    CacheService.getScriptCache().put(chave, JSON.stringify(resumo), COMP_CACHE_SEGUNDOS);
  } catch (e) {
    Logger.log('Não foi possível guardar no cache: ' + e.message);
  }
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
