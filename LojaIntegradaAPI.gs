/**
 * INTEGRAÇÃO COM A LOJA INTEGRADA
 * ------------------------------------------------------------------
 * ⚠️ Os nomes de campo (sku, preco, ativo) seguem o padrão documentado da API
 * pública (api.awsli.com.br/v1). Rode uma vez, confira os Registros de execução
 * e ajuste os nomes se sua conta retornar campos diferentes.
 *
 * Limites de requisição da Loja Integrada: 100 req/min por loja, 3000 req/min
 * por aplicação — por isso a pequena pausa entre páginas abaixo.
 * ------------------------------------------------------------------
 */

const LI_BASE_URL = 'https://api.awsli.com.br/v1';

/**
 * Retorna todos os produtos ativos e vendáveis da Loja Integrada (com paginação).
 * Cada item: { sku, preco, nome }
 *
 * Descoberta importante (via diagnóstico): o preço NÃO vem no recurso /produto/ —
 * fica num recurso separado, /produto_preco/, indexado pelo mesmo ID do produto.
 * Também: só produtos do tipo "normal" (sem variação) ou "atributo_opcao" (a
 * variação vendável em si, ex: "Lado Direito") têm preço próprio — o tipo
 * "atributo" é só o produto "pai"/agrupador, sem preço.
 */
function listarProdutosAtivosLojaIntegrada_() {
  const chaveApi = getProp_('LI_CHAVE_API');
  const chaveAplicacao = getProp_('LI_CHAVE_APLICACAO');
  const headers = { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao };

  // 1. Busca todos os preços primeiro, montando um mapa id -> {cheio, promocional}
  const precosPorId = {};
  let offset = 0;
  const limit = 100;
  let totalCount = null;

  do {
    const url = LI_BASE_URL + '/produto_preco/?format=json&order_by=id&limit=' + limit + '&offset=' + offset;
    const response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error('Erro Loja Integrada (produto_preco, ' + response.getResponseCode() + '): ' + response.getContentText());
    }
    const data = JSON.parse(response.getContentText());
    (data.objects || []).forEach(function (p) {
      const idProduto = Number(String(p.produto || '').replace(/\D/g, '')); // extrai o número da URI "/api/v1/produto/12345"
      precosPorId[idProduto] = {
        cheio: Number(p.cheio || 0),
        promocional: Number(p.promocional || 0)
      };
    });
    totalCount = (data.meta && data.meta.total_count) || 0;
    offset += limit;
    Utilities.sleep(200);
  } while (offset < totalCount);

  // 2. Busca os produtos e junta com o preço correspondente
  const produtos = [];
  offset = 0;
  totalCount = null;

  do {
    const url = LI_BASE_URL + '/produto/?format=json&order_by=id&limit=' + limit + '&offset=' + offset;
    const response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error('Erro Loja Integrada (produto, ' + response.getResponseCode() + '): ' + response.getContentText());
    }
    const data = JSON.parse(response.getContentText());

    (data.objects || []).forEach(function (produto) {
      const vendavel = produto.tipo === 'normal' || produto.tipo === 'atributo_opcao';
      const disponivel = produto.ativo === true && produto.bloqueado !== true && produto.removido !== true;

      if (!vendavel || !disponivel) return;

      const preco = precosPorId[produto.id] || {};
      const precoPromocional = preco.promocional || 0;
      const precoCheio = preco.cheio || 0;
      const precoEfetivo = precoPromocional > 0 ? precoPromocional : precoCheio;

      produtos.push({
        sku: produto.sku,
        preco: precoEfetivo,
        precoVendaNormal: precoCheio,
        precoPromocional: precoPromocional > 0 ? precoPromocional : '',
        nome: produto.nome
      });
    });

    totalCount = (data.meta && data.meta.total_count) || 0;
    offset += limit;
    Utilities.sleep(200);
  } while (offset < totalCount);

  return produtos;
}

/**
 * FUNÇÃO DE DIAGNÓSTICO — rode isso manualmente assim que a LI_CHAVE_APLICACAO
 * chegar, ANTES de confiar no filtro de ativos. Ela mostra os nomes de campo
 * reais que a API está devolvendo (ativo, status, situacao, etc.), pra
 * confirmarmos se o filtro em listarProdutosAtivosLojaIntegrada_ está
 * checando os campos certos. Também mostra quantos produtos existem no total,
 * pra termos noção de quanto tempo a busca completa deve levar.
 */
function diagnosticoLojaIntegrada() {
  const chaveApi = getProp_('LI_CHAVE_API');
  const chaveAplicacao = getProp_('LI_CHAVE_APLICACAO');

  // 1. Amostra geral (primeiros 20), para ver a variedade de "tipo" de registro
  const urlAmostra = LI_BASE_URL + '/produto/?format=json&limit=20&offset=0';
  const respAmostra = UrlFetchApp.fetch(urlAmostra, {
    headers: { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao },
    muteHttpExceptions: true
  });
  Logger.log('Status HTTP (amostra): ' + respAmostra.getResponseCode());
  const dataAmostra = JSON.parse(respAmostra.getContentText());
  Logger.log('Total de produtos na loja: ' + (dataAmostra.meta && dataAmostra.meta.total_count));

  const tiposVistos = {};
  (dataAmostra.objects || []).forEach(function (p) {
    if (!tiposVistos[p.tipo]) {
      tiposVistos[p.tipo] = p;
    }
  });
  Logger.log('Tipos distintos encontrados nessa amostra de 20: ' + Object.keys(tiposVistos).join(', '));
  Object.keys(tiposVistos).forEach(function (tipo) {
    Logger.log('--- exemplo do tipo "' + tipo + '" ---');
    Logger.log(JSON.stringify(tiposVistos[tipo], null, 2));
  });

  // 2. Busca direta por um SKU conhecido, que sabemos ter preço (kit já testado)
  ['SKU_EXEMPLO_1', 'SKU_EXEMPLO_2'].forEach(function (sku) {
    const urlSku = LI_BASE_URL + '/produto/?format=json&sku=' + encodeURIComponent(sku);
    const respSku = UrlFetchApp.fetch(urlSku, {
      headers: { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao },
      muteHttpExceptions: true
    });
    const dataSku = JSON.parse(respSku.getContentText());
    const produtoSku = dataSku.objects && dataSku.objects[0];

    Logger.log('--- sku=' + sku + ' (status ' + respSku.getResponseCode() + ') ---');
    if (!produtoSku) {
      Logger.log('Não encontrado.');
      return;
    }
    Logger.log('Todos os nomes de campo: ' + Object.keys(produtoSku).join(', '));
    Object.keys(produtoSku).forEach(function (campo) {
      if (campo === 'descricao_completa') return; // pula, é gigante e não interessa
      const valor = produtoSku[campo];
      const valorTexto = (typeof valor === 'object') ? JSON.stringify(valor) : String(valor);
      Logger.log(campo + ': ' + valorTexto.substring(0, 200));
    });
  });

 
  const idsConhecidos = [123456, 654321]; // 123456, 654321
  const candidatos = [
    '/preco/?format=json&limit=3',
    '/produto_preco/?format=json&limit=3',
    '/estoque/?format=json&limit=3',
    '/preco/?format=json&produto=' + idsConhecidos[0],
    '/produto/' + idsConhecidos[0] + '/preco/?format=json'
  ];

  candidatos.forEach(function (caminho) {
    const url = LI_BASE_URL + caminho;
    const resp = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao },
      muteHttpExceptions: true
    });
    Logger.log('--- tentativa: ' + caminho + ' (status ' + resp.getResponseCode() + ') ---');
    Logger.log(resp.getContentText().substring(0, 1000));
  });
}

/**
 * Verifica o preço bruto de um produto específico pelo SKU, buscando primeiro
 * o ID em /produto/ e depois consultando /produto_preco/ com esse ID exato —
 * para confirmar se a junção por ID em listarProdutosAtivosLojaIntegrada_
 * está funcionando corretamente.
 */
function verificarPrecoPontual(sku) {
  const chaveApi = getProp_('LI_CHAVE_API');
  const chaveAplicacao = getProp_('LI_CHAVE_APLICACAO');
  const headers = { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao };

  const urlProduto = LI_BASE_URL + '/produto/?format=json&sku=' + encodeURIComponent(sku);
  const respProduto = UrlFetchApp.fetch(urlProduto, { headers: headers, muteHttpExceptions: true });
  const dataProduto = JSON.parse(respProduto.getContentText());
  const produto = dataProduto.objects && dataProduto.objects[0];

  Logger.log('Produto: ' + JSON.stringify(produto, null, 2));
  if (!produto) return;

  const urlPreco = LI_BASE_URL + '/produto_preco/' + produto.id + '/?format=json';
  const respPreco = UrlFetchApp.fetch(urlPreco, { headers: headers, muteHttpExceptions: true });
  Logger.log('--- /produto_preco/' + produto.id + '/ (status ' + respPreco.getResponseCode() + ') ---');
  Logger.log(respPreco.getContentText());
}

/**
 * Verifica se um ID específico aparece na listagem paginada de /produto_preco/
 * (para confirmar se o problema é na paginação/coleta, não na junção em si).
 */
function verificarIdNaListaDePrecos(idProcurado) {
  const chaveApi = getProp_('LI_CHAVE_API');
  const chaveAplicacao = getProp_('LI_CHAVE_APLICACAO');
  const headers = { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao };

  let offset = 0;
  const limit = 100;
  let totalCount = null;
  let totalColetado = 0;
  let encontrado = null;
  let paginasComErro = 0;
  const idsColetados = [];

  do {
    const url = LI_BASE_URL + '/produto_preco/?format=json&order_by=id&limit=' + limit + '&offset=' + offset;
    const response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });

    if (response.getResponseCode() !== 200) {
      paginasComErro++;
      Logger.log('Erro na página offset=' + offset + ': status ' + response.getResponseCode());
      Logger.log('Corpo do erro: ' + response.getContentText());
      offset += limit;
      continue;
    }

    const data = JSON.parse(response.getContentText());
    (data.objects || []).forEach(function (p) {
      totalColetado++;
      const idExtraido = Number(String(p.produto || '').replace(/\D/g, ''));
      idsColetados.push(idExtraido);
      if (idExtraido === idProcurado) {
        encontrado = p;
      }
    });

    totalCount = (data.meta && data.meta.total_count) || 0;
    offset += limit;
    Utilities.sleep(200);
  } while (offset < totalCount);

  const idsUnicos = {};
  let duplicatas = 0;
  idsColetados.forEach(function (id) {
    if (idsUnicos[id]) duplicatas++;
    idsUnicos[id] = true;
  });

  Logger.log('Total esperado (total_count): ' + totalCount);
  Logger.log('Total efetivamente coletado: ' + totalColetado);
  Logger.log('IDs únicos: ' + Object.keys(idsUnicos).length);
  Logger.log('Duplicatas: ' + duplicatas);
  Logger.log('Páginas com erro: ' + paginasComErro);
  Logger.log('ID ' + idProcurado + ' encontrado na lista? ' + (encontrado ? JSON.stringify(encontrado) : 'NÃO'));
}

/**
 * Consulta o schema da API para descobrir quais campos são aceitos para
 * ordenação (order_by) no recurso /produto_preco/ e /produto/ — a API recusou
 * "id" com a mensagem "The 'id' field does not allow ordering.", então
 * precisamos ver a lista real de campos permitidos.
 */
function verificarSchemaOrdenacao() {
  const chaveApi = getProp_('LI_CHAVE_API');
  const chaveAplicacao = getProp_('LI_CHAVE_APLICACAO');
  const headers = { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao };

  ['/produto_preco/schema/?format=json', '/produto/schema/?format=json'].forEach(function (caminho) {
    const url = LI_BASE_URL + caminho;
    const resp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    Logger.log('--- ' + caminho + ' (status ' + resp.getResponseCode() + ') ---');
    Logger.log(resp.getContentText());
  });
}

/**
 * Testa vários campos candidatos para order_by no endpoint /produto/, para
 * achar um que a API aceite (evitando a mesma instabilidade de paginação que
 * encontramos em /produto_preco/).
 */
function testarCamposOrdenacaoProduto() {
  const chaveApi = getProp_('LI_CHAVE_API');
  const chaveAplicacao = getProp_('LI_CHAVE_APLICACAO');
  const headers = { 'Authorization': 'chave_api ' + chaveApi + ' aplicacao ' + chaveAplicacao };

  const candidatos = ['id', 'sku', 'nome', 'resource_uri', 'apelido', 'ativo', 'tipo', 'removido'];

  candidatos.forEach(function (campo) {
    const url = LI_BASE_URL + '/produto/?format=json&limit=1&order_by=' + campo;
    const resp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    Logger.log(campo + ': status ' + resp.getResponseCode() + (resp.getResponseCode() !== 200 ? ' -> ' + resp.getContentText() : ' -> OK'));
  });
}

function testeVerificarId() {
  verificarIdNaListaDePrecos(123456);
}
