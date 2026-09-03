/**
 * Certidão de Regularidade Fiscal PJ de Salvador.
 * A página pública é só um invólucro: o formulário real mora num iframe em
 * servicosweb.sefaz.salvador.ba.gov.br, então vamos direto nele.
 *
 * Quando o captcha está errado o site NÃO mostra mensagem: ele simplesmente
 * recarrega o formulário (com o CNPJ apagado). Por isso o sinal de sucesso é
 * o formulário do captcha desaparecer da tela.
 */
const FORM = 'https://servicosweb.sefaz.salvador.ba.gov.br/sistema/certidao_negativa/servicos_certidao_negativa_CNPJ.asp';
const PEDE_CAPTCHA = /Digite o C[óo]digo de Verifica/i;

export default {
  id: 'municipal',
  nome: 'Certidão Municipal (SEFAZ Salvador)',
  arquivo: '03 Certidao Municipal (SEFAZ Salvador)',
  url: 'https://www2.sefaz.salvador.ba.gov.br/servico/certidao-regularidade-fiscal-pj',
  humano: 'captcha',

  async emitir(ctx) {
    const { page, log } = ctx;

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      await page.goto(FORM, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#txtCNPJ', { timeout: 30000 });

      // O campo tem maxlength=14: só aceita os dígitos, sem pontuação.
      await ctx.preencherCnpj('#txtCNPJ');

      await ctx.aguardarHumano({
        mensagem: `SEFAZ Salvador: digite o código de verificação mostrado na janela (tentativa ${tentativa}/3)`,
        condicao: async () => ((await page.inputValue('input[name="form"]').catch(() => '')) || '').trim().length >= 4,
      });

      let baixado = null;
      try {
        baixado = await ctx.baixar(() => page.click('input[name="Submit"]'), this.arquivo, 25000);
      } catch { /* o normal aqui é a certidão vir como página, não download */ }
      if (baixado) return;

      await page.waitForTimeout(4000);
      const alvo = ctx.context.pages().find((x) => x !== page && !x.url().startsWith('about:')) || page;
      await alvo.waitForLoadState('domcontentloaded').catch(() => {});
      const texto = await alvo.innerText('body').catch(() => '');

      if (PEDE_CAPTCHA.test(texto)) {
        // Voltou para o formulário: código recusado. Nunca salvar isso como certidão.
        log.aviso(`código de verificação recusado — tentativa ${tentativa}/3`);
        if (alvo !== page) await alvo.close().catch(() => {});
        continue;
      }

      await ctx.pdfDaPagina(alvo, this.arquivo);
      if (alvo !== page) await alvo.close().catch(() => {});
      return;
    }

    throw new Error('a certidão municipal não foi emitida em 3 tentativas (código de verificação recusado?)');
  },
};
