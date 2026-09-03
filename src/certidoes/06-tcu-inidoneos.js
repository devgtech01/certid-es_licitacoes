export default {
  id: 'tcu',
  nome: 'Certidão de Licitantes Inidôneos (TCU)',
  arquivo: '06 Certidao Licitantes Inidoneos (TCU)',
  url: 'https://certidoes.apps.tcu.gov.br/emitir-certidao-inidoneos',
  humano: false,

  async emitir(ctx) {
    const { page, cnpjFmt, cnpj, log } = ctx;
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#btn-emitir-certidao-inidoneos', { timeout: 45000 });

    // Os ids dos inputs são gerados pelo React (ex.: «r3») e mudam a cada build.
    // O campo do CNPJ é o primeiro input de texto do formulário.
    await ctx.preencherCnpj(page.locator('form input[type="text"]').first());

    // Emitir só RENDERIZA a certidão na tela; o PDF vem de um segundo botão.
    // (esperar pelo texto do banner não funciona: ele é quebrado em vários
    // elementos por causa do link de ouvidoria — esperamos o botão em si)
    await page.click('#btn-emitir-certidao-inidoneos');
    const baixar = page.getByRole('button', { name: /Baixar Certid[ãa]o/i });
    await baixar.waitFor({ state: 'visible', timeout: 60000 });
    log.passo('certidão emitida, baixando o PDF...');

    await ctx.baixar(() => baixar.click(), this.arquivo, 60000);
  },
};
