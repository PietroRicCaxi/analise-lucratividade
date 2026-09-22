/**
 * AUTORIZAÇÃO COM O BLING (OAuth2)
 * ------------------------------------------------------------------
 * Usa a biblioteca "OAuth2" (github.com/googleworkspace/apps-script-oauth2),
 * que já cuida de trocar o código de autorização por access_token/refresh_token
 * e renovar automaticamente quando expira. Não precisamos guardar nem renovar
 * tokens manualmente.
 *
 * Antes de usar:
 *  1. Adicione a biblioteca (Bibliotecas > + > Script ID:
 *     1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF)
 *  2. Em Propriedades do script, configure:
 *       BLING_CLIENT_ID
 *       BLING_CLIENT_SECRET
 * ------------------------------------------------------------------
 */

function getBlingService_() {
  return OAuth2.createService('bling')
    .setAuthorizationBaseUrl('https://www.bling.com.br/Api/v3/oauth/authorize')
    .setTokenUrl('https://www.bling.com.br/Api/v3/oauth/token')
    .setClientId(getProp_('BLING_CLIENT_ID'))
    .setClientSecret(getProp_('BLING_CLIENT_SECRET'))
    .setCallbackFunction('blingAuthCallback')
    .setPropertyStore(PropertiesService.getUserProperties())
    .setTokenHeaders({
      'Authorization': 'Basic ' + Utilities.base64Encode(getProp_('BLING_CLIENT_ID') + ':' + getProp_('BLING_CLIENT_SECRET'))
    });
}

/**
 * Função de callback chamada pelo Bling depois que você autoriza o app.
 * Não precisa chamar isso manualmente.
 */
function blingAuthCallback(request) {
  const service = getBlingService_();
  const autorizado = service.handleCallback(request);

  if (autorizado) {
    return HtmlService.createHtmlOutput('Autorização concluída! Pode fechar esta aba e voltar para a planilha.');
  }
  return HtmlService.createHtmlOutput('Falha na autorização. Volte para a planilha e tente novamente.');
}

/**
 * PASSO A: rode esta função uma vez para descobrir a URL de redirecionamento
 * que precisa ser cadastrada no aplicativo do Bling.
 * Veja o resultado em: Ver > Registros de execução (ou Executar > Registros)
 */
function passoA_mostrarUrlRedirecionamento() {
  Logger.log('Cole esta URL no campo "URI de redirecionamento" do app no Bling:');
  Logger.log(OAuth2.getRedirectUri());
}

/**
 * PASSO B: depois de atualizar a URL de redirecionamento no Bling, rode esta
 * função para gerar o link de autorização. Copie o link do Logger e abra no navegador.
 */
function passoB_iniciarAutorizacao() {
  const service = getBlingService_();
  if (service.hasAccess()) {
    Logger.log('Já autorizado! Não precisa repetir esse passo.');
    return;
  }
  const authorizationUrl = service.getAuthorizationUrl();
  Logger.log('Abra esta URL no navegador e autorize o acesso:');
  Logger.log(authorizationUrl);
}

/**
 * PASSO C: depois de autorizar no navegador, rode esta função para confirmar
 * que deu certo.
 */
function passoC_verificarAutorizacao() {
  const service = getBlingService_();
  if (service.hasAccess()) {
    Logger.log('✅ Autorizado com sucesso! Token válido.');
  } else {
    Logger.log('❌ Ainda não autorizado. Rode passoB_iniciarAutorizacao novamente.');
  }
}

/**
 * Usado pelo resto do código (BlingAPI.gs) para pegar o access_token válido.
 */
function getBlingAccessToken_() {
  const service = getBlingService_();
  if (!service.hasAccess()) {
    throw new Error('App não autorizado com o Bling. Rode passoB_iniciarAutorizacao primeiro.');
  }
  return service.getAccessToken();
}

/**
 * Caso precise revogar e recomeçar a autorização do zero.
 */
function resetarAutorizacaoBling() {
  getBlingService_().reset();
  Logger.log('Autorização resetada. Rode passoB_iniciarAutorizacao para autorizar de novo.');
}
