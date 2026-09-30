/**
 * CORREÇÃO DOS CUSTOS ZERADOS
 * ------------------------------------------------------------------
 * O endpoint /produtos?codigo= do Bling devolve o preço de custo já
 * somado para a maioria dos kits, mas devolve ZERO para alguns — sem
 * um padrão claro. O resultado é anúncio aparecendo com margem de 75%
 * no painel só porque o custo veio vazio.
 *
 * Este arquivo tem duas coisas:
 *
 *   1. custoBlingRobusto_(sku) — usa o valor do Bling quando ele vem
 *      preenchido e, quando vem zero, soma a estrutura do produto.
 *      Troque a chamada no RelatorioCustoTodosAtivos.gs por esta.
 *
 *   2. corrigirCustosZerados() — varre a aba "Custo Bling Completo",
 *      pega só as linhas com custo zero e recalcula essas. São poucas
 *      dezenas, roda em um ou dois minutos. Use agora, para não
 *      precisar refazer a varredura inteira dos 9 mil.
 * ------------------------------------------------------------------
 */

const CZ_SHEET = 'Custo Bling Completo';
const CZ_PAUSA_MS = 300;

/**
 * Preço de custo confiável: o do Bling quando existe, senão a soma da estrutura.
 * Devolve { encontrado, precoCusto, tipo, origem }.
 */
function custoBlingRobusto_(sku) {
  const resumo = buscarProdutoBlingPorSKU_(sku);
  if (!resumo) return { encontrado: false };

  const tipo = resumo.formato === 'S' ? 'simples' : 'composicao';
  const doBling = Number(resumo.precoCusto) || 0;
  if (doBling > 0) {
    return { encontrado: true, precoCusto: doBling, tipo: tipo, origem: 'Bling' };
  }

  // Bling devolveu zero: soma a estrutura.
  const detalhe = buscarDetalheProdutoBling_(resumo.id);
  const comps = (detalhe.estrutura && detalhe.estrutura.componentes) || [];

  if (comps.length === 0) {
    const proprio = (detalhe.fornecedor && detalhe.fornecedor.precoCusto) || 0;
    return { encontrado: true, precoCusto: proprio, tipo: tipo, origem: 'Fornecedor' };
  }

  let soma = 0;
  for (let i = 0; i < comps.length; i++) {
    const idComp = comps[i].produto && comps[i].produto.id;
    if (!idComp) continue;
    const d = buscarDetalheProdutoBling_(idComp);
    const custoComp = (d.fornecedor && d.fornecedor.precoCusto) || 0;
    soma += (Number(comps[i].quantidade) || 0) * custoComp;
  }
  soma = Math.round(soma * 10000) / 10000;
  return { encontrado: true, precoCusto: soma, tipo: tipo, origem: 'Soma da estrutura' };
}

/**
 * Recalcula só as linhas que estão com custo zero na aba de custos.
 * Não mexe no resto. Roda direto, sem blocos — são poucas linhas.
 */
function corrigirCustosZerados() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CZ_SHEET);
  if (!sh) throw new Error('Aba "' + CZ_SHEET + '" não encontrada.');

  getBlingAccessToken_(); // falha cedo se a autorização expirou

  const ultima = sh.getLastRow();
  const vals = sh.getRange(2, 1, ultima - 1, 6).getValues();

  const alvos = [];
  for (let i = 0; i < vals.length; i++) {
    const sku = String(vals[i][0] || '').trim();
    const custo = Number(vals[i][2]);
    const status = String(vals[i][5] || '').trim();
    if (sku && status === 'OK' && (!isFinite(custo) || custo === 0)) {
      alvos.push({ linha: i + 2, sku: sku, preco: Number(vals[i][1]) });
    }
  }

  if (alvos.length === 0) {
    ss.toast('Nenhuma linha com custo zero. Nada a fazer.', 'Tudo certo', 8);
    return;
  }

  ss.toast(alvos.length + ' anúncios sem custo. Recalculando pela estrutura…', 'Corrigindo', 10);

  let corrigidos = 0, aindaZero = 0, erros = 0;
  const inicio = Date.now();

  for (let i = 0; i < alvos.length; i++) {
    if (Date.now() - inicio > 5 * 60 * 1000) {
      ss.toast('Parou em ' + i + ' de ' + alvos.length + ' por causa do tempo. Rode de novo para continuar.',
        'Tempo esgotado', 15);
      break;
    }
    const a = alvos[i];
    try {
      const r = custoBlingRobusto_(a.sku);
      if (r.encontrado && r.precoCusto > 0) {
        const margem = a.preco > 0 ? (a.preco - r.precoCusto) / a.preco * 100 : '';
        sh.getRange(a.linha, 3).setValue(r.precoCusto);
        sh.getRange(a.linha, 4).setValue(margem);
        sh.getRange(a.linha, 5).setValue(r.tipo);
        corrigidos++;
      } else {
        aindaZero++;
      }
    } catch (e) {
      erros++;
      if (String(e.message).indexOf('não autorizado') !== -1) {
        ss.toast('Autorização do Bling expirou. Rode passoB_iniciarAutorizacao e tente de novo.', 'Parado', 15);
        break;
      }
    }
    Utilities.sleep(CZ_PAUSA_MS);
  }

  try { CacheService.getScriptCache().remove('painel_dados'); } catch (e) { /* segue */ }

  const msg = corrigidos + ' corrigidos · ' + aindaZero + ' seguem sem custo (não têm valor em lugar nenhum) · ' +
    erros + ' com erro.';
  ss.toast(msg, 'Concluído', 20);
  Logger.log(msg);
}

/** Diagnóstico de um SKU: mostra de onde o custo veio e quanto é. */
function diagnosticoCustoDeUmSKU() {
  const sku = 'IMPmbc'; // troque aqui pelo SKU que quiser investigar
  const r = custoBlingRobusto_(sku);
  Logger.log(sku + ' → ' + JSON.stringify(r));
  return r;
}
