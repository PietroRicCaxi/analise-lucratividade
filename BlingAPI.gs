/**
 * INTEGRAÇÃO COM O BLING (API v3)
 * ------------------------------------------------------------------
 * ⚠️ Os nomes de campo abaixo (ex: fornecedor.precoCusto, estrutura.componentes)
 * seguem a documentação pública da API v3. Rode uma vez, confira os "Registros
 * de execução" (View > Executions / Logger) e ajuste se o retorno da sua conta
 * usar nomes diferentes.
 * ------------------------------------------------------------------
 */

const BLING_BASE_URL = 'https://api.bling.com.br/Api/v3';

// Cache em memória (válido só durante uma execução) para não repetir chamadas
// ao mesmo componente quando ele aparece em vários kits (ex: grampos e parafusos
// compartilhados entre SKUs).
const _cacheDetalheBling = {};

// getBlingAccessToken_() agora vive em Auth.gs, usando a biblioteca OAuth2
// (cuida de renovar o token automaticamente quando expira).

/**
 * GET genérico na API do Bling, com retry limitado em caso de 429 (rate limit).
 * As esperas são propositalmente curtas — é melhor falhar rápido num SKU difícil
 * e seguir para o próximo do que travar a execução inteira nele.
 */
function blingFetch_(path, params) {
  const token = getBlingAccessToken_();
  let url = BLING_BASE_URL + path;

  if (params) {
    const query = Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    url += '?' + query;
  }

  const maxTentativas = 3;
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();

    if (status === 200) {
      Utilities.sleep(120); // espaçamento proativo, para evitar cair em 429
      return JSON.parse(response.getContentText());
    }

    if (status === 429) {
      Utilities.sleep(Math.min(tentativa * 1500, 4000)); // espera curta e limitada (máx. 4s)
      continue;
    }

    throw new Error('Erro Bling (' + status + '): ' + response.getContentText());
  }

  throw new Error('Excedeu tentativas de retry na API do Bling: ' + url);
}

/**
 * Busca o produto no Bling pelo SKU (código). Retorna null se não encontrar.
 */
function buscarProdutoBlingPorSKU_(sku) {
  const resultado = blingFetch_('/produtos', { codigo: sku, limite: 1 });
  if (!resultado.data || resultado.data.length === 0) {
    return null;
  }
  return resultado.data[0];
}

/**
 * Busca o detalhe completo do produto (necessário para pegar a estrutura/componentes
 * e o preço de custo). Usa cache em memória durante a execução.
 */
function buscarDetalheProdutoBling_(idProduto) {
  if (_cacheDetalheBling[idProduto]) {
    return _cacheDetalheBling[idProduto];
  }
  const resultado = blingFetch_('/produtos/' + idProduto, null);
  _cacheDetalheBling[idProduto] = resultado.data;
  return resultado.data;
}

/**
 * DIAGNÓSTICO — rode isso manualmente para um SKU de kit que apresentou valor
 * de custo suspeito (número muito grande, provavelmente um ID em vez de um
 * preço). Mostra a estrutura bruta do produto e de cada componente, pra
 * identificarmos exatamente onde o valor errado está entrando.
 */
function diagnosticoKitComProblema_(sku) {
  const resumo = buscarProdutoBlingPorSKU_(sku);
  Logger.log('--- resumo (busca por SKU) ---');
  Logger.log(JSON.stringify(resumo, null, 2));

  if (!resumo) return;

  const detalhe = buscarDetalheProdutoBling_(resumo.id);
  Logger.log('--- detalhe do produto (kit) ---');
  Logger.log(JSON.stringify(detalhe, null, 2));

  if (detalhe.estrutura && detalhe.estrutura.componentes) {
    detalhe.estrutura.componentes.forEach(function (componente, i) {
      Logger.log('--- componente ' + i + ' (bruto, como vem no array estrutura.componentes) ---');
      Logger.log(JSON.stringify(componente, null, 2));

      const idComponente = componente.produto && componente.produto.id;
      Logger.log('idComponente extraído: ' + idComponente);

      if (idComponente) {
        const detalheComponente = buscarDetalheProdutoBling_(idComponente);
        Logger.log('--- detalhe completo do componente ' + i + ' ---');
        Logger.log(JSON.stringify(detalheComponente, null, 2));
      }
    });
  }
}

/**
 * Calcula o "Preço Total de Custo" de um produto no Bling.
 * Descoberta importante (confirmada via diagnóstico): o Bling já devolve esse
 * valor PRONTO no campo "precoCusto" da própria busca por SKU — tanto para
 * produtos simples quanto para produtos com composição (kit), já somando os
 * componentes. Não é preciso buscar detalhe de cada componente manualmente.
 * Isso também deixa o processamento muito mais rápido (1 chamada por SKU).
 */
function calcularPrecoCustoBling_(sku) {
  const resumo = buscarProdutoBlingPorSKU_(sku);
  if (!resumo) {
    return { encontrado: false };
  }

  const tipo = resumo.formato === 'S' ? 'simples' : 'composicao';
  return { encontrado: true, precoCusto: resumo.precoCusto || 0, tipo: tipo };
}

function testeDiagnostico() {
  diagnosticoKitComProblema_('SKU_EXEMPLO');
}

function testeRapidoCusto() {
  Logger.log(JSON.stringify(calcularPrecoCustoBling_('SKU_EXEMPLO')));
}
