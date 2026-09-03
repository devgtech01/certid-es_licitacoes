/**
 * Certidão de regularidade fiscal federal (RFB/PGFN).
 *
 * Estratégia: CONSULTAR primeiro. Se já existe uma certidão válida, baixa a
 * 2ª via dela e pronto — é o mesmo documento e não gasta emissão nova.
 * Só quando não há nenhuma válida é que tenta emitir.
 *
 * O caminho de consulta não pede captcha; o de emissão passa por hCaptcha e
 * ainda mente ("emitida com sucesso" mesmo com a API devolvendo 500), por isso
 * depois de emitir voltamos a consultar para pegar o PDF de fato.
 */
const HOME = 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj';

const dataBr = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

async function abrirHome(page) {
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // O banner de cookies cobre o formulário.
  await page.click('button:has-text("Aceitar")', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/** Faz a consulta por data de emissão nos últimos 180 dias. */
async function consultar(ctx) {
  const { page } = ctx;
  await abrirHome(page);
  await ctx.preencherCnpj(page.locator('input[placeholder="Informe o CNPJ"]'));
  await page.getByRole('button', { name: /Consultar Certid/i }).first().click();

  const datas = page.locator('input[placeholder="Selecione a data"]');
  await datas.first().waitFor({ timeout: 45000 });
  await page.locator('input[type="radio"]').first().check(); // por data de emissão

  const hojeD = new Date();
  await datas.nth(0).fill(dataBr(new Date(hojeD.getTime() - 180 * 24 * 3600 * 1000)));
  await datas.nth(1).fill(dataBr(hojeD));
  await page.getByRole('button', { name: /Consultar Certid/i }).last().click();
  await page.waitForTimeout(2500);
}

/** Linhas da tabela de resultado (ngx-datatable) marcadas como "Válida". */
function linhasValidas(page) {
  return page.locator('datatable-body-row').filter({ hasText: /Válida/i });
}

export default {
  id: 'federal',
  nome: 'Certidão Federal (Receita Federal / PGFN)',
  arquivo: '01 Certidao Federal (RFB-PGFN)',
  url: HOME,
  humano: 'captcha',
  // Só pede ajuda humana quando precisa emitir E o hCaptcha exibe desafio.
  humanoOpcional: true,

  async emitir(ctx) {
    const { page, log } = ctx;

    // ---------- 1) já existe certidão válida?
    await consultar(ctx);
    await linhasValidas(page).first().waitFor({ timeout: 30000 }).catch(() => {});
    let validas = await linhasValidas(page).count();

    if (validas) {
      const resumo = (await linhasValidas(page).first().innerText()).replace(/\s+/g, ' ').trim();
      log.passo(`certidão válida encontrada — baixando a 2ª via: ${resumo.slice(0, 70)}`);
      await ctx.baixarOuCapturar(
        () => linhasValidas(page).first().locator('button[title="Segunda via"]').click(),
        this.arquivo,
        60000,
      );
      return;
    }

    // ---------- 2) não há válida: emitir uma nova
    log.passo('nenhuma certidão válida no período — emitindo uma nova');
    await abrirHome(page);
    await ctx.preencherCnpj(page.locator('input[placeholder="Informe o CNPJ"]'));
    await page.getByRole('button', { name: /Emitir Certid/i }).first().click();
    await page.waitForTimeout(3000);

    if (await page.$('text=/Certid[ãa]o V[áa]lida Encontrada/i')) {
      await page.getByRole('button', { name: /Emitir Nova Certid/i }).click();
    }

    const pronto = () => page.evaluate(
      () => /emitida com sucesso|Resultado da Emiss/i.test(document.body.innerText),
    ).catch(() => false);

    let ok = false;
    for (let i = 0; i < 25 && !ok; i++) { ok = await pronto(); if (!ok) await page.waitForTimeout(1000); }

    if (!ok && ctx.interativo) {
      await ctx.aguardarHumano({
        mensagem: 'Receita Federal: resolva o hCaptcha na janela (se ele tiver exibido um desafio)',
        condicao: pronto,
        timeout: 240000,
      });
    }

    // ---------- 3) consultar de novo para baixar o PDF recém-emitido
    await consultar(ctx);
    await linhasValidas(page).first().waitFor({ timeout: 60000 });
    validas = await linhasValidas(page).count();
    if (!validas) throw new Error('a emissão não produziu certidão válida (hCaptcha pode ter barrado)');

    await ctx.baixarOuCapturar(
      () => linhasValidas(page).first().locator('button[title="Segunda via"]').click(),
      this.arquivo,
      60000,
    );
  },
};
