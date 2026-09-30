/**
 * PAINEL WEB DE MARGEM — servidor
 * ------------------------------------------------------------------
 * Publica um app web com os gráficos de margem dos anúncios da Loja
 * Integrada, calculados sobre o preço de custo do Bling.
 *
 * Lê a aba "Custo Bling Completo" (SKU, Preço no Site, Preço de Custo,
 * Margem %, Tipo, Status) e a aba "Parâmetros", que é criada
 * automaticamente na primeira execução.
 *
 * COMO PUBLICAR:
 *   1. Cole este arquivo como Script "Painel" e a página como
 *      arquivo HTML "PainelPagina" (nomes diferentes: o editor não
 *      aceita dois arquivos com o mesmo nome, mesmo de tipos diferentes).
 *   2. Rode criarParametros() uma vez (cria a aba com os valores padrão).
 *   3. Implantar > Nova implantação > Tipo: App da Web
 *      Executar como: Eu     |     Quem tem acesso: sua organização
 *   4. Copie o link e mande para o gerente.
 *
 * Para mudar imposto, Ads, embalagem ou a meta de lucro, edite a aba
 * "Parâmetros" — o painel recalcula sozinho, sem mexer no código.
 * ------------------------------------------------------------------
 */

const PN_ORIGEM = 'Custo Bling Completo';
const PN_PARAMS = 'Parâmetros';
const PN_HIST = 'Histórico Painel';
const PN_CACHE_SEG = 1800; // 30 min

const PN_PADRAO = [
  ['Parâmetro', 'Valor', 'Observação'],
  ['Imposto %', 22, 'Percentual sobre o preço de venda'],
  ['Plataforma %', 1, 'Percentual sobre o preço de venda'],
  ['Google Ads R$', 0, 'Custo FIXO por venda, em reais. Use 0 se cobrar por percentual.'],
  ['Google Ads %', 30, 'Custo de Ads como percentual do preço. Some com o fixo acima.'],
  ['Embalagem até R$30', 1, ''],
  ['Embalagem R$30 a R$60', 3, ''],
  ['Embalagem acima de R$60', 5, ''],
  ['Meta de lucro %', 20, 'Margem mínima desejada'],
  ['Padrão SKU presilha avulsa', '^CP?[A-Z]?\\d*\\s*-?\\s*EP', 'Expressão regular. Deixe vazio para não separar.']
];

/** Cria a aba de parâmetros com os valores padrão. Rode uma vez. */
function criarParametros() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PN_PARAMS);
  if (sh) {
    SpreadsheetApp.getActiveSpreadsheet().toast('A aba "' + PN_PARAMS + '" já existe.', 'Nada a fazer', 6);
    return;
  }
  sh = ss.insertSheet(PN_PARAMS);
  sh.getRange(1, 1, PN_PADRAO.length, 3).setValues(PN_PADRAO);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 210);
  sh.setColumnWidth(3, 380);
  ss.toast('Aba "' + PN_PARAMS + '" criada. Ajuste os valores quando quiser.', 'Pronto', 8);
}

/**
 * Acrescenta à aba "Parâmetros" as linhas que ainda não existem,
 * sem mexer nos valores que você já ajustou. Rode depois de atualizar
 * o script, quando eu acrescentar um parâmetro novo.
 */
function atualizarParametros() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PN_PARAMS);
  if (!sh) { criarParametros(); return; }

  const existentes = {};
  const ultima = sh.getLastRow();
  if (ultima > 1) {
    sh.getRange(2, 1, ultima - 1, 1).getValues().forEach(function (l) {
      existentes[String(l[0]).trim()] = true;
    });
  }
  const novas = PN_PADRAO.slice(1).filter(function (l) { return !existentes[l[0]]; });
  if (novas.length === 0) {
    ss.toast('Nenhum parâmetro novo. A aba já está completa.', 'Tudo certo', 8);
    return;
  }
  sh.getRange(sh.getLastRow() + 1, 1, novas.length, 3).setValues(novas);
  try { CacheService.getScriptCache().remove('painel_dados'); } catch (e) { /* segue */ }
  ss.toast(novas.length + ' parâmetro(s) acrescentado(s): ' +
    novas.map(function (l) { return l[0]; }).join(', '), 'Parâmetros atualizados', 12);
}

function lerParametros_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PN_PARAMS);
  const p = {
    imposto: 0.22, plataforma: 0.01, ads: 0, adsPct: 0.30,
    emb1: 1, emb2: 3, emb3: 5, meta: 0.20,
    padraoPresilha: '^CP?[A-Z]?\\d*\\s*-?\\s*EP'
  };
  if (!sh) return p;
  const v = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues();
  const mapa = {};
  v.forEach(function (l) { mapa[String(l[0]).trim()] = l[1]; });
  const num = function (k, d) {
    const x = Number(String(mapa[k]).replace(',', '.'));
    return isNaN(x) ? d : x;
  };
  p.imposto = num('Imposto %', 22) / 100;
  p.plataforma = num('Plataforma %', 1) / 100;
  p.ads = num('Google Ads R$', 0);
  p.adsPct = num('Google Ads %', 0) / 100;
  p.emb1 = num('Embalagem até R$30', 1);
  p.emb2 = num('Embalagem R$30 a R$60', 3);
  p.emb3 = num('Embalagem acima de R$60', 5);
  p.meta = num('Meta de lucro %', 20) / 100;
  if (mapa['Padrão SKU presilha avulsa'] !== undefined) {
    p.padraoPresilha = String(mapa['Padrão SKU presilha avulsa']);
  }
  return p;
}

function embalagem_(preco, p) {
  if (preco <= 30) return p.emb1;
  if (preco < 60) return p.emb2;
  return p.emb3;
}

function lucroDe_(preco, custo, p) {
  const ads = p.ads + preco * (p.adsPct || 0);
  return preco - preco * p.imposto - preco * p.plataforma - ads - embalagem_(preco, p) - custo;
}

/** Menor preço que atinge a meta, respeitando a faixa de embalagem. */
function precoMinimo_(custo, p) {
  const denom = 1 - p.imposto - p.plataforma - (p.adsPct || 0) - p.meta;
  if (denom <= 0) return NaN;
  const cand = [];
  const faixas = [[p.emb1, 0, 30], [p.emb2, 30, 60], [p.emb3, 60, Infinity]];
  for (let i = 0; i < faixas.length; i++) {
    const e = faixas[i][0], lo = faixas[i][1], hi = faixas[i][2];
    const x = (p.ads + e + custo) / denom;
    if (x > lo && x <= hi) cand.push(x);
  }
  [30, 60].forEach(function (b) {
    if (lucroDe_(b, custo, p) / b >= p.meta) cand.push(b);
  });
  if (cand.length === 0) return NaN;
  return Math.ceil(Math.min.apply(null, cand) * 100) / 100;
}

/** Lê a planilha e devolve tudo que o painel precisa. */
function getDadosPainel(semCache) {
  const cache = CacheService.getScriptCache();
  if (!semCache) {
    const guardado = cache.get('painel_dados');
    if (guardado) {
      try { return JSON.parse(guardado); } catch (e) { /* segue e recalcula */ }
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PN_ORIGEM);
  if (!sh) throw new Error('Aba "' + PN_ORIGEM + '" não encontrada.');

  const p = lerParametros_();
  const re = p.padraoPresilha ? new RegExp(p.padraoPresilha, 'i') : null;
  const ultima = sh.getLastRow();
  const linhas = ultima > 1 ? sh.getRange(2, 1, ultima - 1, 6).getValues() : [];

  const cats = { ok: 0, b20: 0, b10: 0, pr: 0, presilha: 0, semcusto: 0 };
  const faixasDef = [
    { faixa: 'até R$15', lim: 15 }, { faixa: 'R$15–30', lim: 30 },
    { faixa: 'R$30–60', lim: 60 }, { faixa: 'R$60–150', lim: 150 },
    { faixa: 'R$150+', lim: Infinity }
  ];
  const faixas = faixasDef.map(function (f) {
    return { faixa: f.faixa, lim: f.lim, n: 0, ok: 0, ruim: 0, pr: 0 };
  });

  let prejuizoRS = 0, ganho = 0, revisar = 0, semCusto = 0, total = 0;
  const piores = [];

  for (let i = 0; i < linhas.length; i++) {
    const sku = String(linhas[i][0] || '').trim();
    const preco = Number(linhas[i][1]);
    const custo = Number(linhas[i][2]);
    const status = String(linhas[i][5] || '').trim();
    if (!sku || status !== 'OK') continue;
    if (!isFinite(preco) || preco <= 0) continue;
    const c = isFinite(custo) ? custo : 0;
    if (!isFinite(custo) || custo === 0) semCusto++;
    total++;

    if (re && re.test(sku)) { cats.presilha++; continue; }
    if (c <= 0) { cats.semcusto++; continue; }

    const lucro = lucroDe_(preco, c, p);
    const margem = lucro / preco;

    if (lucro < 0) cats.pr++;
    else if (margem < 0.10) cats.b10++;
    else if (margem < p.meta) cats.b20++;
    else cats.ok++;

    for (let j = 0; j < faixas.length; j++) {
      if (preco <= faixas[j].lim) {
        faixas[j].n++;
        if (lucro < 0) faixas[j].pr++;
        else if (margem < p.meta) faixas[j].ruim++;
        else faixas[j].ok++;
        break;
      }
    }

    if (lucro < 0) prejuizoRS += lucro;
    if (margem < p.meta) {
      revisar++;
      const sug = precoMinimo_(c, p);
      if (isFinite(sug)) {
        const novo = lucroDe_(Math.max(sug, preco), c, p);
        ganho += (novo - lucro);
      }
      piores.push([sku, preco, c, lucro, margem * 100, isFinite(sug) ? Math.max(sug, preco) : 0]);
    }
  }

  piores.sort(function (a, b) { return a[3] - b[3]; });

  const dados = {
    total: total,
    atualizado: Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd/MM/yyyy 'às' HH:mm"),
    parametros: p,
    categorias: [
      { nome: 'Saudável (' + Math.round(p.meta * 100) + '% ou mais)', n: cats.ok, cor: 'ok' },
      { nome: 'Abaixo de ' + Math.round(p.meta * 100) + '%', n: cats.b20, cor: 'warn' },
      { nome: 'Abaixo de 10%', n: cats.b10, cor: 'warn' },
      { nome: 'Prejuízo', n: cats.pr, cor: 'bad' },
      { nome: 'Presilhas avulsas', n: cats.presilha, cor: 'neutral' },
      { nome: 'Sem custo cadastrado', n: cats.semcusto, cor: 'neutral' }
    ],
    faixas: faixas.map(function (f) {
      return { faixa: f.faixa, n: f.n, ok: f.ok, ruim: f.ruim, pr: f.pr };
    }),
    prejuizoRS: Math.round(-prejuizoRS * 100) / 100,
    ganho: Math.round(ganho * 100) / 100,
    revisar: revisar,
    semCusto: semCusto,
    piores: piores.slice(0, 10)
  };

  try { cache.put('painel_dados', JSON.stringify(dados), PN_CACHE_SEG); } catch (e) { /* segue */ }
  return dados;
}

/** Ponto de entrada do app web. */
function doGet() {
  const t = HtmlService.createTemplateFromFile('PainelPagina');
  t.dados = JSON.stringify(getDadosPainel(false));
  return t.evaluate()
    .setTitle('Margem dos anúncios — Click Presilhas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Chamado pelo botão "Atualizar agora" da página. */
function recarregarPainel() {
  return getDadosPainel(true);
}

/**
 * Grava um retrato diário na aba "Histórico Painel".
 * Coloque num gatilho diário depois da atualização dos custos.
 */
function registrarHistorico() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PN_HIST);
  if (!sh) {
    sh = ss.insertSheet(PN_HIST);
    sh.appendRow(['Data', 'Total', 'Saudáveis', 'Abaixo de 20%', 'Abaixo de 10%',
      'Prejuízo', 'Presilhas avulsas', 'Prejuízo R$', 'Ganho possível R$']);
    sh.setFrozenRows(1);
  }
  const d = getDadosPainel(true);
  const c = d.categorias;
  sh.appendRow([new Date(), d.total, c[0].n, c[1].n, c[2].n, c[3].n, c[4].n,
    d.prejuizoRS, d.ganho]);
}


/* ------------------------------------------------------------------
 * DETALHE — lista paginada por categoria ou faixa de preço.
 * Chamada pela página quando o usuário clica numa barra.
 * ------------------------------------------------------------------ */

function montarLinhas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PN_ORIGEM);
  if (!sh) throw new Error('Aba "' + PN_ORIGEM + '" não encontrada.');

  const p = lerParametros_();
  const re = p.padraoPresilha ? new RegExp(p.padraoPresilha, 'i') : null;
  const ultima = sh.getLastRow();
  const vals = ultima > 1 ? sh.getRange(2, 1, ultima - 1, 6).getValues() : [];
  const limites = [15, 30, 60, 150, Infinity];
  const rotulos = ['até R$15', 'R$15–30', 'R$30–60', 'R$60–150', 'R$150+'];

  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const sku = String(vals[i][0] || '').trim();
    const preco = Number(vals[i][1]);
    const custo = Number(vals[i][2]);
    if (!sku || String(vals[i][5] || '').trim() !== 'OK') continue;
    if (!isFinite(preco) || preco <= 0) continue;
    const c = isFinite(custo) ? custo : 0;

    const presilha = !!(re && re.test(sku));
    const lucro = lucroDe_(preco, c, p);
    const margem = lucro / preco;
    let cat;
    if (presilha) cat = 'presilha';
    else if (c <= 0) cat = 'semcusto';
    else if (lucro < 0) cat = 'pr';
    else if (margem < 0.10) cat = 'b10';
    else if (margem < p.meta) cat = 'b20';
    else cat = 'ok';

    let faixa = rotulos[rotulos.length - 1];
    for (let j = 0; j < limites.length; j++) {
      if (preco <= limites[j]) { faixa = rotulos[j]; break; }
    }
    const sug = precoMinimo_(c, p);
    out.push({
      sku: sku, preco: preco, custo: c, lucro: lucro, margem: margem * 100,
      sug: isFinite(sug) ? Math.max(sug, preco) : 0, cat: cat, faixa: faixa, presilha: presilha
    });
  }
  return out;
}

/**
 * tipo: 'categoria' | 'faixa'
 * valor: 'ok' | 'b20' | 'b10' | 'pr' | 'presilha'  ou  o rótulo da faixa
 * coluna: 'preco' | 'custo' | 'lucro' | 'margem' | 'sug'
 * direcao: 'asc' | 'desc'
 */
function getDetalhe(tipo, valor, coluna, direcao, offset, limite, cat) {
  offset = Number(offset) || 0;
  limite = Number(limite) || 10;
  coluna = ['preco', 'custo', 'lucro', 'margem', 'sug'].indexOf(coluna) === -1 ? 'lucro' : coluna;
  const sinal = direcao === 'desc' ? -1 : 1;

  let linhas = montarLinhas_();
  if (tipo === 'categoria') {
    linhas = linhas.filter(function (l) { return l.cat === valor; });
  } else if (tipo === 'faixa') {
    linhas = linhas.filter(function (l) { return l.faixa === valor && !l.presilha; });
    if (cat) linhas = linhas.filter(function (l) { return l.cat === cat; });
  }

  linhas.sort(function (a, b) { return (a[coluna] - b[coluna]) * sinal; });

  return {
    total: linhas.length,
    offset: offset,
    linhas: linhas.slice(offset, offset + limite).map(function (l) {
      return [l.sku, l.preco, l.custo, l.lucro, l.margem, l.sug];
    })
  };
}
