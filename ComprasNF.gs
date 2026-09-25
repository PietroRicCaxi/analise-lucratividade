/**
 * LEITURA DAS NOTAS FISCAIS DE COMPRA (XML) DIRETO DO GMAIL
 * ------------------------------------------------------------------
 * Varre os e-mails com anexo .xml, abre cada nota fiscal eletrônica e
 * grava na aba "Compras NF" uma linha por item comprado.
 *
 * NÃO acessa o Bling — só lê o Gmail. Sem risco de bloqueio da API.
 *
 * COMO RODAR:
 *   1. (Recomendado) Em Configurações do projeto > Propriedades do script,
 *      adicione CNPJ_EMPRESA com o CNPJ da empresa, só números.
 *      Assim só entram notas em que VOCÊS são o comprador (ignora notas
 *      de venda que eventualmente estejam no e-mail).
 *   2. Rode iniciarLeituraNFs(). Na primeira vez, o Google vai pedir
 *      permissão para ler o Gmail — é esperado.
 *   3. Roda sozinho em blocos. Você recebe e-mail quando terminar.
 *   4. Para interromper a qualquer momento: pararLeituraNFs().
 * ------------------------------------------------------------------
 */

const NF_SHEET_NAME = 'Compras NF';
const NF_TRIGGER_HANDLER = 'continuarLeituraNFs_';
const NF_TEMPO_MAXIMO_MS = 4 * 60 * 1000;
// Busca padrão: só e-mails com XML anexo, dos últimos 2 anos, excluindo
// o Mercado Livre. Pode ser trocada sem mexer no código: crie a propriedade
// NF_BUSCA em Propriedades do script com a busca que quiser (mesma sintaxe
// da barra de busca do Gmail).
const NF_BUSCA_PADRAO = 'has:attachment filename:xml newer_than:2y ' +
  '-from:mercadolivre.com -from:mercadolivre.com.br -from:mercadolibre.com';

function buscaGmailNF_() {
  return PropertiesService.getScriptProperties().getProperty('NF_BUSCA') || NF_BUSCA_PADRAO;
}
const NF_THREADS_POR_LOTE = 20;
const NF_URI_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';

const NF_CABECALHO = [
  'Data', 'Nº NF', 'Fornecedor', 'CNPJ Fornecedor', 'Código no fornecedor',
  'Descrição', 'Unidade', 'Quantidade', 'Valor unit. NF',
  'Custo unit. (c/ IPI, ST, frete, desc.)', 'CNPJ Destinatário', 'Chave NF', 'Item'
];

/**
 * PASSO 1: prepara a aba e agenda o processamento.
 */
function iniciarLeituraNFs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(NF_SHEET_NAME) || ss.insertSheet(NF_SHEET_NAME);
  sheet.clear();
  sheet.appendRow(NF_CABECALHO);
  sheet.setFrozenRows(1);

  // Códigos e chaves como texto: evita perder zeros à esquerda
  // e evita a chave de 44 dígitos virar notação científica.
  sheet.getRange('B:B').setNumberFormat('@');
  sheet.getRange('D:E').setNumberFormat('@');
  sheet.getRange('K:M').setNumberFormat('@');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('NF_OFFSET', '0');
  props.deleteProperty('NF_PARAR');

  agendarContinuacaoNF_();

  ss.toast(
    'Vai começar em alguns segundos e continuar sozinho em segundo plano. Você recebe um e-mail quando terminar.',
    'Leitura de notas agendada',
    8
  );
}

/**
 * BOTÃO DE PARADA — interrompe o processamento em blocos.
 */
function pararLeituraNFs() {
  PropertiesService.getScriptProperties().setProperty('NF_PARAR', 'sim');
  removerGatilhosNF_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Pedido de parada registrado. O bloco em andamento termina em até 4 minutos e não agenda mais nada.',
    'Parando',
    10
  );
}

/**
 * RETOMAR — continua a leitura de onde parou, sem apagar o que já foi lido.
 * Use esta (e não iniciarLeituraNFs) quando quiser continuar uma leitura
 * que foi interrompida por pararLeituraNFs(), por erro ou pela cota diária.
 */
function retomarLeituraNFs() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('NF_PARAR');
  agendarContinuacaoNF_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Vai retomar do e-mail nº ' + (props.getProperty('NF_OFFSET') || '0') +
    ' em alguns segundos. Você recebe um e-mail quando terminar.',
    'Retomando leitura das notas',
    8
  );
}

/**
 * Processa lotes de e-mails até acabar o tempo seguro; se não terminar,
 * salva onde parou e se reagenda.
 */
function continuarLeituraNFs_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('NF_PARAR') === 'sim') {
    removerGatilhosNF_();
    return;
  }

  const inicio = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(NF_SHEET_NAME);
  const cnpjEmpresa = String(props.getProperty('CNPJ_EMPRESA') || '').replace(/\D/g, '');
  let offset = Number(props.getProperty('NF_OFFSET') || 0);
  const jaLidos = carregarItensJaLidos_(sheet);

  try {
    while (true) {
      const threads = GmailApp.search(buscaGmailNF_(), offset, NF_THREADS_POR_LOTE);
      if (threads.length === 0) break;

      const linhas = [];
      let processados = 0;
      let acabouTempo = false;

      for (let t = 0; t < threads.length; t++) {
        if (Date.now() - inicio > NF_TEMPO_MAXIMO_MS) {
          acabouTempo = true;
          break;
        }
        threads[t].getMessages().forEach(function (msg) {
          msg.getAttachments().forEach(function (anexo) {
            const nome = String(anexo.getName() || '').toLowerCase();
            if (nome.slice(-4) !== '.xml') return;
            extrairItensNFe_(anexo, cnpjEmpresa).forEach(function (linha) {
              const chaveItem = linha[11] + '#' + linha[12];
              if (jaLidos[chaveItem]) return; // mesma nota recebida mais de uma vez
              jaLidos[chaveItem] = true;
              linhas.push(linha);
            });
          });
        });
        processados++;
      }

      if (linhas.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, NF_CABECALHO.length).setValues(linhas);
      }
      offset += processados;
      props.setProperty('NF_OFFSET', String(offset));

      if (acabouTempo) {
        agendarContinuacaoNF_();
        return;
      }
    }

    removerGatilhosNF_();
    finalizarLeituraNFs_(sheet);
  } catch (erro) {
    removerGatilhosNF_();
    try {
      MailApp.sendEmail(
        Session.getEffectiveUser().getEmail(),
        'Erro na leitura das notas fiscais do Gmail',
        'O processamento parou por causa de um erro:\n\n' + erro.message +
        '\n\nO que já foi lido continua na aba "' + NF_SHEET_NAME + '".'
      );
    } catch (e) {
      Logger.log('Falha ao enviar e-mail de erro: ' + e.message);
    }
    throw erro;
  }
}

/**
 * Lê um anexo XML e devolve uma linha por item da nota.
 * Ignora arquivos que não são NF-e (eventos, cancelamentos, CT-e etc.).
 */
function extrairItensNFe_(anexo, cnpjEmpresa) {
  let texto;
  try {
    texto = anexo.getDataAsString('UTF-8').replace(/^\uFEFF/, '');
  } catch (e) {
    return [];
  }
  if (texto.indexOf('infNFe') === -1) return [];

  let doc;
  try {
    doc = XmlService.parse(texto);
  } catch (e) {
    return [];
  }

  const ns = XmlService.getNamespace(NF_URI_NAMESPACE);
  const raiz = doc.getRootElement();
  const nfe = raiz.getName() === 'NFe' ? raiz : raiz.getChild('NFe', ns);
  if (!nfe) return [];
  const inf = nfe.getChild('infNFe', ns);
  if (!inf) return [];

  const dest = inf.getChild('dest', ns);
  const cnpjDest = dest ? (textoFilho_(dest, 'CNPJ', ns) || textoFilho_(dest, 'CPF', ns)) : '';
  if (cnpjEmpresa && cnpjDest.replace(/\D/g, '') !== cnpjEmpresa) return [];

  const idAttr = inf.getAttribute('Id');
  const chave = idAttr ? idAttr.getValue().replace(/^NFe/, '') : '';
  const ide = inf.getChild('ide', ns);
  const emit = inf.getChild('emit', ns);

  const dataTexto = (textoFilho_(ide, 'dhEmi', ns) || textoFilho_(ide, 'dEmi', ns)).substring(0, 10);
  const data = dataTexto ? new Date(dataTexto + 'T12:00:00') : '';
  const nNF = textoFilho_(ide, 'nNF', ns);
  const fornecedor = textoFilho_(emit, 'xNome', ns);
  const cnpjFornecedor = textoFilho_(emit, 'CNPJ', ns) || textoFilho_(emit, 'CPF', ns);

  const linhas = [];
  inf.getChildren('det', ns).forEach(function (det) {
    const prod = det.getChild('prod', ns);
    if (!prod) return;

    const qtd = numero_(textoFilho_(prod, 'qCom', ns));
    const valorUnit = numero_(textoFilho_(prod, 'vUnCom', ns));
    const valorProd = numero_(textoFilho_(prod, 'vProd', ns));
    const extras = numero_(textoFilho_(prod, 'vFrete', ns))
      + numero_(textoFilho_(prod, 'vSeg', ns))
      + numero_(textoFilho_(prod, 'vOutro', ns))
      - numero_(textoFilho_(prod, 'vDesc', ns));

    const imposto = det.getChild('imposto', ns);
    const vIPI = somarTag_(imposto, 'vIPI');
    const vST = somarTag_(imposto, 'vICMSST');

    const custoUnit = qtd > 0
      ? Math.round(((valorProd + extras + vIPI + vST) / qtd) * 10000) / 10000
      : '';

    const nItemAttr = det.getAttribute('nItem');

    linhas.push([
      data,
      nNF,
      fornecedor,
      cnpjFornecedor,
      textoFilho_(prod, 'cProd', ns),
      textoFilho_(prod, 'xProd', ns),
      textoFilho_(prod, 'uCom', ns),
      qtd,
      valorUnit,
      custoUnit,
      cnpjDest,
      chave,
      nItemAttr ? nItemAttr.getValue() : ''
    ]);
  });

  return linhas;
}

function textoFilho_(elemento, nome, ns) {
  if (!elemento) return '';
  return elemento.getChildText(nome, ns) || '';
}

function numero_(valor) {
  return Number(String(valor || '').replace(',', '.')) || 0;
}

/** Soma todas as ocorrências de uma tag dentro de um elemento, em qualquer nível. */
function somarTag_(elemento, nome) {
  if (!elemento) return 0;
  let total = 0;
  elemento.getChildren().forEach(function (filho) {
    if (filho.getName() === nome) {
      total += numero_(filho.getText());
    } else {
      total += somarTag_(filho, nome);
    }
  });
  return total;
}

/** Monta o conjunto de itens já gravados (chave da NF + nº do item), para não duplicar. */
function carregarItensJaLidos_(sheet) {
  const lidos = {};
  const ultima = sheet.getLastRow();
  if (ultima < 2) return lidos;
  sheet.getRange(2, 12, ultima - 1, 2).getValues().forEach(function (par) {
    lidos[par[0] + '#' + par[1]] = true;
  });
  return lidos;
}

function agendarContinuacaoNF_() {
  removerGatilhosNF_();
  ScriptApp.newTrigger(NF_TRIGGER_HANDLER)
    .timeBased()
    .after(60 * 1000)
    .create();
}

function removerGatilhosNF_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === NF_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function finalizarLeituraNFs_(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const total = Math.max(sheet.getLastRow() - 1, 0);
  try {
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'Leitura das notas fiscais concluída',
      total + ' itens de notas de compra foram gravados na aba "' + NF_SHEET_NAME + '".\n' +
      'Link: ' + ss.getUrl()
    );
  } catch (e) {
    Logger.log('Não foi possível enviar o e-mail de aviso: ' + e.message);
  }
}
