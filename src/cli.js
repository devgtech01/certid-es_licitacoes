#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CERTIDOES } from './certidoes/index.js';
import { esperarPessoa } from './contexto.js';
import { emitirCertidoes } from './emissor.js';
import { cnpjValido, formatarCnpj, limparCnpj, log } from './util.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lerArgs(argv) {
  const o = { only: null, pular: [], auto: false, headless: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--cnpj') o.cnpj = val();
    else if (a === '--saida' || a === '--out') o.saida = val();
    else if (a === '--only' || a === '--somente') o.only = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--pular' || a === '--skip') o.pular = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--razao-social') o.razaoSocial = val();
    else if (a === '--endereco') o.endereco = val();
    else if (a === '--data-inicial') o.dataInicial = val();
    else if (a === '--data-final') o.dataFinal = val();
    else if (a === '--auto') o.auto = true;
    else if (a === '--headless') o.headless = true;
    else if (a === '--listar') o.listar = true;
    else if (a === '-h' || a === '--help') o.ajuda = true;
    else if (!o.cnpj && /^[\d./-]{14,18}$/.test(a)) o.cnpj = a;
  }
  return o;
}

const AJUDA = `
Emissão de Certidões — informe o CNPJ e receba as certidões em PDF numa pasta.

  node src/cli.js --cnpj 19711011000108
  node src/cli.js --cnpj 19711011000108 --saida "C:\\Certidoes" --only estadual,tcu

Prefere clicar em vez de digitar comando?  npm run web

Opções
  --cnpj <cnpj>          CNPJ da empresa (com ou sem pontuação)
  --saida <pasta>        pasta base de saída (padrão: ./certidoes)
  --only <ids>           executa só estes (separados por vírgula)
  --pular <ids>          pula estes
  --auto                 não roda as que exigem captcha/login
  --headless             sem janela (só funciona com --auto)
  --razao-social <txt>   sobrescreve a razão social (usada pelo TJBA)
  --endereco <txt>       sobrescreve o endereço (usado pelo TJBA)
  --data-inicial <dd/mm/aaaa>  período do relatório de sancionados
  --listar               lista os ids disponíveis
`;

/** No terminal, a pessoa avisa que resolveu o captcha apertando ENTER. */
const interacaoTerminal = {
  async aguardar(page, opts) {
    log.humano(opts.mensagem);
    log.passo('Resolva na janela do navegador. O robô segue sozinho quando detectar o resultado.');
    log.passo('Se ele não detectar, aperte ENTER aqui no terminal para forçar a continuação.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const sinalExterno = new Promise((resolve) => rl.once('line', () => resolve('enter')));
    try {
      return await esperarPessoa(page, { ...opts, sinalExterno });
    } finally {
      rl.close();
    }
  },
};

function imprimir(ev) {
  if (ev.tipo === 'log') {
    ({ passo: log.passo, ok: log.ok, aviso: log.aviso, erro: log.erro }[ev.nivel] || log.passo)(ev.texto);
  } else if (ev.tipo === 'inicio') {
    log.titulo(`Emissão de certidões — ${ev.cnpjFmt}`);
    log.info(`  saída: ${ev.pastaSaida}`);
  } else if (ev.tipo === 'empresa') {
    if (ev.empresa?.razaoSocial) log.ok(`empresa: ${ev.empresa.razaoSocial} (${ev.empresa.fonte})`);
  } else if (ev.tipo === 'certidao-inicio') {
    log.titulo(`▶ ${ev.nome}`);
  } else if (ev.tipo === 'aviso') {
    log.aviso(ev.texto);
  } else if (ev.tipo === 'certidao-fim' && ev.status === 'falhou') {
    log.erro(ev.erro);
    if (ev.detalheSite) log.erro(`site respondeu: ${ev.detalheSite}`);
  }
}

async function main() {
  const o = lerArgs(process.argv.slice(2));

  if (o.ajuda) { console.log(AJUDA); return; }
  if (o.listar) {
    console.log('\nCertidões disponíveis:\n');
    for (const c of CERTIDOES) {
      const marca = !c.humano ? '(automática)'
        : c.humanoOpcional ? `(automática; ${c.humano} só se o site pedir)` : `(exige ${c.humano})`;
      console.log(`  ${c.id.padEnd(12)} ${c.nome}  ${marca}`);
    }
    console.log();
    return;
  }

  const cnpj = limparCnpj(o.cnpj);
  if (!cnpj) { console.log(AJUDA); process.exit(1); }
  if (!cnpjValido(cnpj)) {
    log.erro(`CNPJ inválido: ${o.cnpj} (dígitos verificadores não conferem)`);
    process.exit(1);
  }
  if (o.headless && !o.auto) {
    log.erro('--headless só faz sentido junto com --auto (as demais precisam da janela para captcha/login)');
    process.exit(1);
  }

  const relatorio = await emitirCertidoes({
    ...o, cnpj, raiz: RAIZ, eventos: imprimir, interacao: interacaoTerminal,
  });

  log.titulo('Resumo');
  for (const r of relatorio.resultados) {
    const linha = `${r.status === 'ok' ? '✓' : '✗'} ${r.nome.padEnd(58).slice(0, 58)} ${r.arquivos.length} arq  ${r.segundos}s`;
    console.log(r.status === 'ok' ? `   \x1b[32m${linha}\x1b[0m` : `   \x1b[31m${linha}\x1b[0m`);
    if (r.erro) console.log(`      \x1b[90m${r.erro}\x1b[0m`);
  }
  const ok = relatorio.resultados.filter((r) => r.status === 'ok').length;
  log.info(`\n  ${ok}/${relatorio.resultados.length} certidões · ${formatarCnpj(cnpj)} · ${relatorio.pasta}\n`);

  process.exit(relatorio.resultados.some((r) => r.status === 'falhou') ? 2 : 0);
}

main().catch((e) => { log.erro(String(e.stack || e)); process.exit(1); });
