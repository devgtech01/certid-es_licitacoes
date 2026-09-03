/** Relatório de fornecedores sancionados do TJBA. As datas são obrigatórias. */
export default {
  id: 'sancionados',
  nome: 'Relatório de Fornecedores Sancionados (TJBA)',
  arquivo: '07 Relatorio Fornecedores Sancionados (TJBA)',
  url: 'https://www7.tjba.jus.br/pjlcnet/relatorio/fornecedores_sancionados.wsp',
  humano: false,

  async emitir(ctx) {
    const { page, cnpj, log, opcoes } = ctx;
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[name="tmp.cnpj_cpf"]', { timeout: 30000 });

    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const dtInicial = opcoes?.dataInicial || '01/01/2000';
    const dtFinal = opcoes?.dataFinal || `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;

    await page.check('[name="tmp.tipo_relatorio"][value="1"]').catch(() => {}); // 1 = PDF, 2 = XLS
    await page.fill('[name="tmp.cnpj_cpf"]', cnpj);
    await page.fill('[name="tmp.dt_inicial"]', dtInicial);
    await page.fill('[name="tmp.dt_final"]', dtFinal);
    await page.selectOption('[name="tmp.desempenho"]', { label: 'TODOS' }).catch(() => {});
    log.passo(`período ${dtInicial} a ${dtFinal}, sanção TODOS, formato PDF`);

    // Duas etapas: pesquisar() monta a tabela; só então aparece o botão
    // "Imprimir", que chama gerarRelatorio() e produz o PDF oficial.
    await page.evaluate(() => window.pesquisar(document.forms[0]));
    await page.waitForFunction(
      () => /registro\(s\)/i.test(document.body.innerText) && typeof window.gerarRelatorio === 'function',
      { timeout: 60000 },
    );

    const registros = await page.evaluate(() => {
      const m = document.body.innerText.match(/(\d+)\s*registro\(s\)/i);
      return m ? Number(m[1]) : null;
    });
    log.passo(`pesquisa concluída: ${registros ?? '?'} registro(s)`);

    // gerarRelatorio() faz submit num window.open nomeado, apontando para
    // "?tmp.rel=5". Não há download: o relatório é uma página. Esperamos a
    // popup certa (ele abre uma about:blank antes, que precisa ser ignorada).
    // A popup é um <frameset> e o PDF fica embutido no frame ReportConnector:
    // não dispara download, e um GET solto nessa URL volta vazio (o relatório
    // está preso à sessão). Pegamos os bytes direto da resposta HTTP.
    await ctx.capturarPdfDaRede(
      () => page.evaluate(() => window.gerarRelatorio(document.forms[0])),
      this.arquivo,
      60000,
    );

    // Sobra uma popup vazia ('perfil_usuario') aberta pelo próprio site.
    for (const x of ctx.context.pages()) {
      if (x !== page && (x.url() === 'about:blank' || /tmp\.rel=/.test(x.url()))) await x.close().catch(() => {});
    }
  },
};
