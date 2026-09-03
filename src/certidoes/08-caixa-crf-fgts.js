/**
 * CRF/FGTS da Caixa. Conforme pedido: NÃO preencher UF, e emitir tanto a
 * consulta/certificado quanto o histórico do empregador.
 *
 * A navegação interna é JSF por postback: voltar pelo histórico do navegador
 * quebra o estado. Por isso cada documento parte de uma consulta nova.
 */
const URL = 'https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf';

/** Botões do próprio site que não devem sair impressos no PDF. */
const SEM_BOTOES = { ocultar: ['input[type="submit"]', 'input[type="button"]', '.submit-d'] };

async function consultar(page, cnpj) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[id="mainForm:txtInscricao1"]', { timeout: 30000 });
  await page.selectOption('[id="mainForm:tipoEstabelecimento"]', { label: 'CNPJ' });
  await page.fill('[id="mainForm:txtInscricao1"]', cnpj);
  // UF fica em branco de propósito (pedido do usuário).
  await page.click('[id="mainForm:btnConsultar"]');
  await page.waitForTimeout(1500);
  await page.waitForSelector('text=Situação de Regularidade do Empregador', { timeout: 45000 });
}

export default {
  id: 'caixa',
  nome: 'CRF/FGTS + Histórico do Empregador (Caixa)',
  arquivo: '08 CRF FGTS (Caixa)',
  url: URL,
  humano: false,

  async emitir(ctx) {
    const { page, cnpj, log } = ctx;

    // --- 1) Consulta + Certificado de Regularidade (CRF)
    await consultar(page, cnpj);
    const texto = await page.innerText('body');
    const regular = /esta REGULAR no FGTS/i.test(texto);
    log.passo(regular ? 'situação: REGULAR' : 'situação: NÃO regular / sem CRF disponível');

    await ctx.pdfDaPagina(page, '08a Consulta Regularidade Empregador (Caixa)', SEM_BOTOES);

    const linkCrf = await page.$('a:has-text("Certificado de Regularidade")');
    if (linkCrf) {
      await linkCrf.click();
      await page.waitForSelector('[id="mainForm:btnVisualizar"]', { timeout: 45000 });
      // "Visualizar" troca para o layout limpo de impressão — é esse que vira PDF.
      await page.click('[id="mainForm:btnVisualizar"]');
      await page.waitForSelector('[id="mainForm:btImprimir4"]', { timeout: 45000 });
      await ctx.pdfDaPagina(page, this.arquivo, SEM_BOTOES);
    } else {
      log.aviso('sem link de CRF (empresa irregular) — salva apenas a consulta');
    }

    // --- 2) Histórico do empregador (consulta nova, o postback não volta)
    await consultar(page, cnpj);
    const linkHist = await page.$('a:has-text("Histórico do Empregador")');
    if (!linkHist) {
      log.aviso('link de histórico não encontrado');
      return;
    }
    await linkHist.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await ctx.pdfDaPagina(page, '08c Historico do Empregador (Caixa)', SEM_BOTOES);
  },
};
