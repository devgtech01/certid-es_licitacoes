/**
 * Certidão Negativa Correcional da CGU — Entes Privados
 * (ePAD, CGU-PJ, CEIS, CNEP e CEPIM).
 *
 * NÃO precisa de login. A pegadinha: abrir /consulta-certidao direto na barra
 * de endereços cai em /signin. Pelo roteamento do próprio site (entrar na home
 * e clicar no link) a página abre pública. Por isso este módulo navega
 * clicando, e não com goto na URL final.
 *
 * O captcha (hCaptcha de imagem, "escolha todos os baldes") aparece só depois
 * de clicar em Consultar. Quem resolve é a pessoa.
 */
const HOME = 'https://certidoes.cgu.gov.br/';

export default {
  id: 'cgu',
  nome: 'Certidão Negativa Correcional - Entes Privados (CGU)',
  arquivo: '09 Certidao Negativa Correcional Entes Privados (CGU)',
  url: HOME,
  humano: 'captcha',

  async emitir(ctx) {
    const { page, cnpj, log } = ctx;

    // 1) Home -> "Emitir Certidão de Entes Privados ou Agentes Públicos"
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.click('a[href="/consulta-certidao"]', { timeout: 30000 });
    await page.waitForSelector('text=/Selecione a certid[ãa]o desejada/i', { timeout: 45000 });

    if (/\/signin/.test(page.url())) {
      throw new Error('a CGU exigiu login — o caminho público pelo menu mudou');
    }

    // 2) Ente Privado (os ids são gerados pelo BootstrapVue: __BVID__26 muda a
    //    cada build, então clicamos pelo texto do rótulo)
    await page.getByText(/Ente Privado/i).first().click();
    await page.waitForTimeout(2500);

    // 3) A certidão de entes privados é a única da lista; garantir marcada.
    const caixa = page.locator('input[type="checkbox"]').first();
    await caixa.waitFor({ timeout: 30000 });
    if (!(await caixa.isChecked())) await caixa.check();

    // 4) CNPJ + botão "+" (adiciona à lista de consulta, virando uma etiqueta)
    await ctx.preencherCnpj('#cpfCnpj');
    const adicionar = page.locator('#cpfCnpj').locator('xpath=following::button[1]');
    await adicionar.click().catch(() => {});
    await page.waitForTimeout(1500);

    // 5) Consultar -> aparece o captcha
    await page.click('#consultar');
    await page.waitForTimeout(3000);
    log.passo('consulta enviada — a CGU deve pedir o captcha agora');

    await ctx.aguardarHumano({
      mensagem: 'CGU: resolva o captcha de imagens na janela ("escolha todos os ...") e confirme',
      condicao: async () => {
        if (ctx.downloads.pendentes() > 0 || ctx.pdfsDaRede.pendentes() > 0) return true;
        // Basta o desafio sair da tela. Exigir também um texto tipo "baixar"
        // era estrito demais: a CGU não escreve nada disso depois de confirmar,
        // e o robô ficava esperando para sempre com o captcha já resolvido.
        return page.evaluate(
          () => !/confirmar que voc[êe] [ée] humano/i.test(document.body.innerText),
        ).catch(() => false);
      },
      timeout: 600000,
    });

    // Depois do captcha a CGU ainda leva alguns segundos para montar o PDF.
    log.passo('captcha confirmado — aguardando a certidão');
    await page.waitForTimeout(5000);

    // 6) O PDF pode já ter vindo, ou depender de um último clique.
    try {
      await ctx.colherDownload(this.arquivo, 20000);
      return;
    } catch { /* ainda não veio */ }

    const botaoPdf = page.locator('button:has-text("Baixar"), a:has-text("Baixar"), button:has-text("Emitir"), a:has-text("PDF")').first();
    if (await botaoPdf.isVisible().catch(() => false)) {
      await ctx.baixarOuCapturar(() => botaoPdf.click(), this.arquivo, 60000);
      return;
    }

    // Sem PDF não há certidão — não salvamos print de tela no lugar dela.
    await ctx.imagemDaPagina(page, '_debug 09 CGU tela final');
    throw new Error('a CGU não entregou o PDF (captcha não confirmado ou layout mudou; veja _debug 09 CGU tela final.png)');
  },
};
