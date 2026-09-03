export default {
  id: 'estadual',
  nome: 'Certidão Estadual (SEFAZ-BA)',
  arquivo: '02 Certidao Estadual (SEFAZ-BA)',
  url: 'https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx',
  humano: false,

  async emitir(ctx) {
    const { page, cnpj, log } = ctx;
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#PHConteudo_TxtNumCNPJ', { timeout: 30000 });
    await page.fill('#PHConteudo_TxtNumCNPJ', cnpj);
    log.passo('CNPJ preenchido, solicitando emissão...');

    // O site abre uma popup "about:blank" que dispara o download e se fecha.
    await ctx.baixar(() => page.click('#PHConteudo_btnImprimir'), this.arquivo, 90000);
  },

  /** Se der erro, o site mostra um modal com a mensagem — vale capturar. */
  async diagnostico(ctx) {
    const { page } = ctx;
    const msg = await page.evaluate(() => {
      const d = document.querySelector('#ASModal_Erro, [id*="ASModal_Erro"]');
      return d && d.offsetParent ? d.innerText.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
    }).catch(() => null);
    return msg;
  },
};
