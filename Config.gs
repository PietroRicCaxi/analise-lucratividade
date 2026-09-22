/**
 * CONFIGURAÇÃO
 * ------------------------------------------------------------------
 * Antes de rodar, preencha as propriedades do script em:
 * Editor do Apps Script > ⚙️ Configurações do projeto > Propriedades do script
 *
 * Chaves necessárias:
 *   BLING_CLIENT_ID
 *   BLING_CLIENT_SECRET
 *   BLING_REFRESH_TOKEN     -> obtido uma única vez no fluxo OAuth2 do Bling
 *   LI_CHAVE_API            -> chave da loja na Loja Integrada
 *   LI_CHAVE_APLICACAO      -> chave do aplicativo/integrador na Loja Integrada
 * ------------------------------------------------------------------
 */

const SHEET_NAME = 'Comparativo';
const LOG_SHEET_NAME = 'Log';

function getProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error('Propriedade "' + key + '" não configurada. Vá em Configurações do projeto > Propriedades do script.');
  }
  return value;
}
