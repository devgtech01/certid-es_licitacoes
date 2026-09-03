import path from 'node:path';
import fs from 'node:fs';
import { caminhoLivre, garantirPasta, nomeSeguro } from './util.js';

/**
 * Espera um download disparado em QUALQUER aba do contexto (vários sites abrem
 * o PDF numa popup). O evento 'download' do Playwright é por Page, então
 * escutamos todas as páginas existentes e as que forem criadas.
 */
export function ouvirDownloads(context) {
  const fila = [];
  const espera = [];
  const entregar = (dl) => {
    const w = espera.shift();
    if (w) w(dl);
    else fila.push(dl);
  };
  const ligar = (page) => page.on('download', entregar);
  context.pages().forEach(ligar);
  context.on('page', ligar);
  return {
    proximo(timeout = 60000) {
      if (fila.length) return Promise.resolve(fila.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`nenhum download em ${timeout}ms`)), timeout);
        espera.push((dl) => { clearTimeout(t); resolve(dl); });
      });
    },
    limpar() { fila.length = 0; },
    pendentes() { return fila.length; },
  };
}

/**
 * Alguns portais entregam o PDF embutido num frame: não há download e o
 * screenshot do visualizador sai cortado. Aqui pegamos os bytes direto da
 * resposta HTTP, enquanto a página ainda está viva.
 */
export function ouvirRespostasPdf(context) {
  const fila = [];
  const espera = [];
  context.on('response', async (resp) => {
    try {
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('pdf')) return;
      const body = await resp.body();
      if (!body?.length || !body.slice(0, 5).toString().startsWith('%PDF')) return;
      const item = { url: resp.url(), body };
      const w = espera.shift();
      if (w) w(item); else fila.push(item);
    } catch { /* corpo já descartado pelo navegador */ }
  });
  return {
    proximo(timeout = 60000) {
      if (fila.length) return Promise.resolve(fila.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`nenhum PDF na rede em ${timeout}ms`)), timeout);
        espera.push((it) => { clearTimeout(t); resolve(it); });
      });
    },
    limpar() { fila.length = 0; },
    pendentes() { return fila.length; },
  };
}

/** Faixa visual dentro da própria página, para o usuário saber o que fazer. */
export async function mostrarFaixa(page, texto, cor = '#b45309') {
  try {
    await page.evaluate(({ texto, cor }) => {
      let el = document.getElementById('__certidoes_faixa');
      if (!el) {
        el = document.createElement('div');
        el.id = '__certidoes_faixa';
        el.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;right:0;padding:14px 18px;'
          + 'font:600 15px/1.4 system-ui,sans-serif;color:#fff;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.4)';
        document.documentElement.appendChild(el);
      }
      el.style.background = cor;
      el.textContent = texto;
    }, { texto, cor });
  } catch { /* página pode estar navegando */ }
}

export async function limparFaixa(page) {
  try {
    await page.evaluate(() => document.getElementById('__certidoes_faixa')?.remove());
  } catch { /* ignora */ }
}

/**
 * Espera a pessoa resolver captcha/login. Termina quando `condicao()` ficar
 * verdadeira OU quando `sinalExterno` resolver (ENTER no terminal, botão na
 * interface web). Nunca resolve captcha automaticamente — só espera.
 */
export async function esperarPessoa(page, { mensagem, condicao, timeout = 300000, sinalExterno }) {
  await mostrarFaixa(page, `⚠  ${mensagem}`);
  let parar = false;

  const porCondicao = (async () => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite && !parar) {
      try { if (await condicao()) return 'condicao'; } catch { /* navegando */ }
      await new Promise((r) => setTimeout(r, 800));
    }
    if (parar) return 'externo';
    throw new Error('tempo esgotado esperando ação humana');
  })();

  try {
    const via = await (sinalExterno ? Promise.race([porCondicao, sinalExterno]) : porCondicao);
    parar = true;
    return via;
  } finally {
    await limparFaixa(page);
  }
}

/** Monta o contexto passado para cada módulo de certidão. */
export function montarCtx({
  context, page, cnpj, cnpjFmt, pastaSaida, downloads, pdfsDaRede, interativo,
  eventos = () => {}, interacao,
}) {
  const salvos = [];

  // Os módulos continuam chamando log.passo/ok/aviso; quem decide se isso vira
  // texto no terminal ou linha na interface web é quem passou `eventos`.
  const log = {
    passo: (texto) => eventos({ tipo: 'log', nivel: 'passo', texto }),
    ok: (texto) => eventos({ tipo: 'log', nivel: 'ok', texto }),
    aviso: (texto) => eventos({ tipo: 'log', nivel: 'aviso', texto }),
    erro: (texto) => eventos({ tipo: 'log', nivel: 'erro', texto }),
  };

  const destinoDe = (rotulo, ext) =>
    caminhoLivre(path.join(garantirPasta(pastaSaida), `${nomeSeguro(rotulo)}${ext}`));

  return {
    context, page, cnpj, cnpjFmt, pastaSaida, downloads, pdfsDaRede, interativo, salvos, log,

    /**
     * Preenche um campo de CNPJ sem cair na armadilha do maxlength: com
     * maxlength=14 a versão pontuada (18 caracteres) entra cortada e o site
     * consulta o CNPJ errado. Tenta os dois formatos e confere o resultado.
     */
    async preencherCnpj(seletor) {
      const campo = typeof seletor === 'string' ? page.locator(seletor) : seletor;
      await campo.waitFor({ timeout: 45000 });
      const max = Number(await campo.getAttribute('maxlength')) || 0;
      const tentativas = max && max < 18 ? [cnpj, cnpjFmt] : [cnpjFmt, cnpj];

      for (const valor of tentativas) {
        await campo.click();
        await campo.fill('');
        await campo.fill(valor).catch(() => {});
        let atual = await campo.inputValue().catch(() => '');
        if (atual.replace(/\D/g, '') !== cnpj) {
          // Campos com máscara por JS às vezes só reagem à digitação real.
          await campo.fill('');
          await campo.type(valor, { delay: 40 });
          atual = await campo.inputValue().catch(() => '');
        }
        if (atual.replace(/\D/g, '') === cnpj) {
          log.passo(`CNPJ informado: ${atual}`);
          return atual;
        }
      }
      const final = await campo.inputValue().catch(() => '');
      throw new Error(`campo de CNPJ ficou com "${final}" em vez de ${cnpjFmt} (confira maxlength/máscara)`);
    },

    /** Salva um download do Playwright com nome padronizado. */
    async salvarDownload(dl, rotulo) {
      const ext = path.extname(dl.suggestedFilename() || '') || '.pdf';
      const destino = destinoDe(rotulo, ext);
      await dl.saveAs(destino);
      salvos.push(destino);
      log.ok(`salvo: ${path.basename(destino)}`);
      return destino;
    },

    /** Executa `acao` e salva o download que ela disparar (em qualquer aba). */
    async baixar(acao, rotulo, timeout = 90000) {
      downloads.limpar();
      const p = downloads.proximo(timeout);
      await acao();
      return this.salvarDownload(await p, rotulo);
    },

    /**
     * Baixa uma URL direto pela sessão do navegador (mesmos cookies).
     * Serve para PDFs que o site mostra embutido num frame em vez de baixar.
     */
    async baixarUrl(url, rotulo, ext = '.pdf') {
      const resp = await context.request.get(url, { timeout: 60000 });
      if (!resp.ok()) throw new Error(`HTTP ${resp.status()} em ${url}`);
      const corpo = await resp.body();
      const tipo = resp.headers()['content-type'] || '';
      if (ext === '.pdf' && !corpo.slice(0, 5).toString().startsWith('%PDF')) {
        throw new Error(`resposta não é PDF (content-type: ${tipo})`);
      }
      const destino = destinoDe(rotulo, ext);
      fs.writeFileSync(destino, corpo);
      salvos.push(destino);
      log.ok(`salvo: ${path.basename(destino)}`);
      return destino;
    },

    /**
     * Executa `acao` e salva o PDF venha ele como download OU embutido na
     * página. Use quando o site pode fazer os dois (ex.: Receita Federal).
     */
    async baixarOuCapturar(acao, rotulo, timeout = 60000) {
      downloads.limpar();
      pdfsDaRede.limpar();
      const corrida = Promise.any([
        downloads.proximo(timeout).then((dl) => ({ dl })),
        pdfsDaRede.proximo(timeout).then((it) => ({ bytes: it.body })),
      ]);
      await acao();
      let r;
      try {
        r = await corrida;
      } catch (e) {
        throw new Error(`nenhum PDF (download ou rede) em ${timeout}ms`);
      }
      if (r.dl) return this.salvarDownload(r.dl, rotulo);
      const destino = destinoDe(rotulo, '.pdf');
      fs.writeFileSync(destino, r.bytes);
      salvos.push(destino);
      log.ok(`salvo: ${path.basename(destino)}`);
      return destino;
    },

    /** Executa `acao` e salva o primeiro PDF que trafegar na rede. */
    async capturarPdfDaRede(acao, rotulo, timeout = 60000) {
      pdfsDaRede.limpar();
      const p = pdfsDaRede.proximo(timeout);
      await acao();
      const { body } = await p;
      const destino = destinoDe(rotulo, '.pdf');
      fs.writeFileSync(destino, body);
      salvos.push(destino);
      log.ok(`salvo: ${path.basename(destino)}`);
      return destino;
    },

    /** Pega um download que já pode ter sido disparado (não descarta a fila). */
    async colherDownload(rotulo, timeout = 20000) {
      return this.salvarDownload(await downloads.proximo(timeout), rotulo);
    },

    /** Converte a página visível em PDF. Funciona em modo headed nesta versão. */
    async pdfDaPagina(alvo, rotulo, opts = {}) {
      const destino = destinoDe(rotulo, '.pdf');
      // Botões de "Voltar/Imprimir" do próprio site sujam o PDF — somem antes.
      if (opts.ocultar) {
        await alvo.evaluate((sels) => {
          document.querySelectorAll(sels.join(',')).forEach((e) => { e.style.display = 'none'; });
        }, opts.ocultar).catch(() => {});
      }
      await alvo.emulateMedia({ media: opts.media || 'print' });
      await alvo.pdf({
        path: destino,
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
        ...opts.pdf,
      });
      await alvo.emulateMedia({ media: null });
      salvos.push(destino);
      log.ok(`salvo: ${path.basename(destino)}`);
      return destino;
    },

    /** Print screen de apoio (quando o resultado não é imprimível). */
    async imagemDaPagina(alvo, rotulo) {
      const destino = destinoDe(rotulo, '.png');
      await alvo.screenshot({ path: destino, fullPage: true });
      salvos.push(destino);
      log.ok(`salvo: ${path.basename(destino)}`);
      return destino;
    },

    async aguardarHumano(opts) {
      if (!interativo) throw new Error('exige ação humana (captcha/login) e a execução está em modo --auto');
      if (!interacao) throw new Error('nenhuma forma de pedir ajuda humana foi configurada');
      // CERTIDOES_DEBUG=1 registra a tela no momento do repasse para a pessoa
      // e CERTIDOES_TIMEOUT_HUMANO encurta a espera — usados para testar o
      // preenchimento automático sem precisar resolver o captcha.
      if (process.env.CERTIDOES_DEBUG) {
        await this.imagemDaPagina(page, `_aguardando humano (${page.url().slice(8, 40)})`).catch(() => {});
      }
      const curto = Number(process.env.CERTIDOES_TIMEOUT_HUMANO || 0);
      return interacao.aguardar(page, { ...opts, ...(curto ? { timeout: curto } : {}) });
    },

    /** Guarda o HTML bruto do resultado — útil para depurar quebras futuras. */
    async dumpHtml(alvo, rotulo) {
      const destino = destinoDe(`_debug ${rotulo}`, '.html');
      fs.writeFileSync(destino, await alvo.content(), 'utf8');
      return destino;
    },
  };
}
