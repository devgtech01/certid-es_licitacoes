/**
 * CNDT (Justiça do Trabalho). Captcha de imagem: o robô preenche o CNPJ e
 * espera a pessoa digitar os caracteres; ao detectar o campo preenchido,
 * clica em emitir sozinho. Faz até 3 tentativas (captcha errado é comum).
 *
 * Ids do JSF (com ':' — por isso seletor por atributo, e não '#'):
 *   gerarCertidaoForm:cpfCnpj          campo do CNPJ
 *   idCampoResposta                    campo do captcha
 *   gerarCertidaoForm:btnEmitirCertidao  emite e BAIXA o PDF
 * Cuidado: existe um segundo botão "Emitir e Enviar Certidão por e-mail"
 * (#botaoEmitirEEnviar) que manda por e-mail em vez de baixar.
 */
const CAMPO_CNPJ = '[id="gerarCertidaoForm:cpfCnpj"]';
const CAMPO_CAPTCHA = '#idCampoResposta';
const BOTAO_EMITIR = '[id="gerarCertidaoForm:btnEmitirCertidao"]';

export default {
  id: 'cndt',
  nome: 'Certidão Negativa de Débitos Trabalhistas (CNDT/TST)',
  arquivo: '05 CNDT Certidao Negativa Debitos Trabalhistas',
  url: 'https://cndt-certidao.tst.jus.br/inicio.faces',
  humano: 'captcha',

  async emitir(ctx) {
    const { page, cnpj, log } = ctx;

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.click('input[value="Emitir Certidão"], button:has-text("Emitir Certidão")');
      await page.waitForSelector(CAMPO_CAPTCHA, { timeout: 45000 });
      await ctx.preencherCnpj(CAMPO_CNPJ);

      // Só repassa para a pessoa depois que a imagem do captcha realmente
      // decodificou — senão ela olha para um ícone de imagem quebrada.
      await page.waitForFunction(
        () => [...document.images].some((i) => /Captcha/i.test(i.alt) && i.naturalWidth > 0),
        { timeout: 30000 },
      ).catch(() => log.aviso('a imagem do captcha demorou a carregar'));

      await ctx.aguardarHumano({
        mensagem: `CNDT: digite os caracteres do captcha na janela (tentativa ${tentativa}/3)`,
        condicao: async () => ((await page.inputValue(CAMPO_CAPTCHA).catch(() => '')) || '').trim().length >= 4,
      });

      try {
        // A CNDT só entrega por download. Se não veio download, não veio
        // certidão — nunca salvar um print da tela no lugar dela.
        await ctx.baixar(() => page.click(BOTAO_EMITIR), this.arquivo, 60000);
        return;
      } catch {
        const txt = await page.innerText('body').catch(() => '');
        const motivo = /inv[áa]lid|incorret|n[ãa]o confere/i.test(txt) ? 'captcha recusado' : 'sem resposta do site';
        log.aviso(`${motivo} — tentativa ${tentativa}/3`);
      }
    }
    throw new Error('a CNDT não foi emitida em 3 tentativas (captcha recusado?)');
  },
};
