/**
 * Motor de emissão. Não imprime nada nem lê o teclado: tudo sai por `eventos`
 * e a interação humana (captcha/login) é delegada a `interacao`.
 * Assim o mesmo código serve ao terminal (src/cli.js) e à interface web
 * (src/servidor.js).
 */
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { CERTIDOES } from './certidoes/index.js';
import { montarCtx, ouvirDownloads, ouvirRespostasPdf } from './contexto.js';
import { buscarDadosEmpresa } from './dadosEmpresa.js';
import { formatarCnpj, garantirPasta, hoje, limparCnpj } from './util.js';

// Sites de órgão público caem sozinhos com alguma frequência (o TCU devolveu
// ERR_EMPTY_RESPONSE numa das execuções). Vale uma segunda tentativa.
const ehFalhaDeRede = (msg) =>
  /ERR_EMPTY_RESPONSE|ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|ERR_ABORTED|ECONNRESET|net::/i.test(msg);

export function selecionar({ only, pular = [], auto } = {}) {
  let lista = CERTIDOES;
  if (only?.length) lista = lista.filter((c) => only.includes(c.id));
  if (pular.length) lista = lista.filter((c) => !pular.includes(c.id));
  if (auto) lista = lista.filter((c) => !c.humano || c.humanoOpcional);
  return lista;
}

export async function emitirCertidoes(opcoes) {
  const {
    cnpj: cnpjBruto, saida, raiz, only, pular = [], auto = false, headless = false,
    razaoSocial, endereco, eventos = () => {}, interacao, cancelado = () => false,
  } = opcoes;

  const cnpj = limparCnpj(cnpjBruto);
  const cnpjFmt = formatarCnpj(cnpj);
  const pastaSaida = garantirPasta(path.join(path.resolve(saida || path.join(raiz, 'certidoes')), cnpj, hoje()));
  const perfil = garantirPasta(path.join(raiz, '.perfil-navegador'));

  const lista = selecionar({ only, pular, auto });
  if (!lista.length) throw new Error('nenhuma certidão selecionada');

  eventos({ tipo: 'inicio', cnpj, cnpjFmt, pastaSaida, certidoes: lista.map((c) => ({ id: c.id, nome: c.nome })) });

  const empresa = await buscarDadosEmpresa(cnpj, {
    ...(razaoSocial ? { razaoSocial } : {}),
    ...(endereco ? { endereco } : {}),
  });
  eventos({ tipo: 'empresa', empresa });

  const context = await chromium.launchPersistentContext(perfil, {
    headless,
    acceptDownloads: true,
    viewport: { width: 1366, height: 900 },
    // --disable-popup-blocking: vários portais entregam o documento via window.open
    args: ['--disable-blink-features=AutomationControlled', '--disable-popup-blocking', '--start-maximized'],
  });
  const downloads = ouvirDownloads(context);
  const pdfsDaRede = ouvirRespostasPdf(context);
  const resultados = [];

  try {
    for (const cert of lista) {
      if (cancelado()) {
        resultados.push({ id: cert.id, nome: cert.nome, status: 'cancelada', arquivos: [], segundos: 0 });
        continue;
      }
      eventos({ tipo: 'certidao-inicio', id: cert.id, nome: cert.nome, humano: cert.humano || null });
      const inicio = Date.now();
      let resultado = null;

      for (let tentativa = 1; tentativa <= 2 && !resultado; tentativa++) {
        const page = await context.newPage();
        const ctx = montarCtx({
          context, page, cnpj, cnpjFmt, pastaSaida, downloads, pdfsDaRede,
          interativo: !auto, eventos, interacao,
        });
        ctx.empresa = empresa;
        ctx.opcoes = opcoes;

        try {
          await cert.emitir(ctx);
          resultado = {
            id: cert.id, nome: cert.nome, status: 'ok',
            arquivos: ctx.salvos.map((f) => path.basename(f)),
          };
        } catch (e) {
          const msg = String(e.message || e).split('\n')[0].slice(0, 200);
          if (tentativa === 1 && ehFalhaDeRede(msg)) {
            eventos({ tipo: 'aviso', id: cert.id, texto: `o site falhou (${msg.slice(0, 60)}) — tentando de novo` });
          } else {
            const detalhe = (await cert.diagnostico?.(ctx).catch(() => null)) || null;
            await ctx.imagemDaPagina(page, `_erro ${cert.id}`).catch(() => {});
            resultado = {
              id: cert.id, nome: cert.nome, status: 'falhou', erro: msg, detalheSite: detalhe,
              arquivos: ctx.salvos.map((f) => path.basename(f)),
            };
          }
        } finally {
          // Fecha abas residuais (várias dessas páginas abrem popups).
          for (const p of context.pages()) {
            if (p !== page && p.url().startsWith('about:')) await p.close().catch(() => {});
          }
          await page.close().catch(() => {});
        }
      }

      resultado.segundos = Math.round((Date.now() - inicio) / 1000);
      resultados.push(resultado);
      eventos({ tipo: 'certidao-fim', ...resultado });
    }
  } finally {
    await context.close().catch(() => {});
  }

  const relatorio = { cnpj, cnpjFmt, empresa, data: new Date().toISOString(), pasta: pastaSaida, resultados };
  fs.writeFileSync(path.join(pastaSaida, 'relatorio.json'), JSON.stringify(relatorio, null, 2), 'utf8');
  eventos({ tipo: 'fim', ...relatorio });
  return relatorio;
}
