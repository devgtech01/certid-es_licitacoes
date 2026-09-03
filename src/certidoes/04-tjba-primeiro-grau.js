/**
 * Certidão de 1º grau do TJBA, no modelo pedido:
 *   Pessoa Jurídica · Participação "Ambas" · Modelo "Certidão Recup. Judicial,
 *   Falência, Concordata".
 *
 * Atenção: o <select> de modelos muda conforme Física/Jurídica — marcar
 * "Pessoa Jurídica" ANTES de escolher o modelo, senão a opção nem existe.
 * A 2ª etapa exige razão social e endereço, que vêm da consulta de CNPJ.
 */
export default {
  id: 'tjba',
  nome: 'Certidão 1º Grau - Falência/Recuperação Judicial (TJBA)',
  arquivo: '04 Certidao 1 Grau Falencia Recuperacao (TJBA)',
  url: 'https://portalcertidoes.tjba.jus.br/#/primeirograu',
  humano: 'captcha',

  async emitir(ctx) {
    const { page, cnpjFmt, cnpj, empresa, log } = ctx;

    if (!empresa?.razaoSocial || !empresa?.endereco) {
      throw new Error('o TJBA exige razão social e endereço; não foi possível obtê-los pelo CNPJ '
        + '(informe --razao-social e --endereco)');
    }

    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#radioJuridica', { timeout: 45000 });

    await page.check('#radioJuridica');
    await page.waitForTimeout(1200); // o select é recarregado
    await page.selectOption('#selectModelo', { label: 'Certidão Recup. Judicial, Falência, Concordata' });
    await page.check('#radioAmbas');
    log.passo('Pessoa Jurídica · Ambas · Recup. Judicial/Falência/Concordata');

    await page.click('input[type="submit"][value="Avançar"]');
    await page.waitForSelector('#cnpj', { timeout: 45000 });

    await page.fill('#razaoSocial', empresa.razaoSocial);
    await ctx.preencherCnpj('#cnpj');
    await page.fill('#endereco', empresa.endereco);
    log.passo(`razão social: ${empresa.razaoSocial}`);

    await page.click('input[type="submit"][value="Avançar"]');
    await page.waitForTimeout(2500);

    await ctx.aguardarHumano({
      mensagem: 'TJBA: resolva o reCAPTCHA ("Não sou um robô") na janela do navegador',
      condicao: async () => page.evaluate(() => {
        const t = document.querySelector('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
        return !!(t && t.value && t.value.length > 20);
      }).catch(() => false),
    });

    const avancar = page.locator('input[type="submit"][value="Avançar"]');
    if (await avancar.isVisible().catch(() => false)) await avancar.click().catch(() => {});

    // A certidão é renderizada na própria página (não há download): o sinal de
    // sucesso é o número da certidão aparecer. Sem isso, NÃO salvamos nada —
    // salvar um print do formulário como se fosse certidão seria pior que falhar.
    log.passo('aguardando a certidão ser gerada...');
    await page.waitForFunction(
      () => /CERTID[ÃA]O\s*N[ºo°:]/i.test(document.body.innerText),
      { timeout: 120000 },
    ).catch(() => {
      throw new Error('a certidão não foi gerada (reCAPTCHA não resolvido ou site fora do ar)');
    });

    const numero = await page.evaluate(() => {
      const m = document.body.innerText.match(/CERTID[ÃA]O\s*N[ºo°:]*\s*([\w.-]+)/i);
      return m ? m[1] : null;
    });
    log.passo(`certidão nº ${numero || '?'}`);

    // media 'print' + esconder a barra do portal: o PDF sai só com a certidão,
    // sem o cabeçalho "PORTAL DE CERTIDÕES" nem os botões Voltar/Imprimir.
    await ctx.pdfDaPagina(page, this.arquivo, {
      ocultar: ['input[type="submit"]', 'input[type="button"]', '.btn', 'header', 'nav', 'button'],
    });
  },
};
