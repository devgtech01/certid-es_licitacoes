#!/usr/bin/env node
/**
 * Interface web local. Sobe um servidor em http://localhost:3000, onde você
 * digita o CNPJ e acompanha a emissão em tempo real.
 *
 * Sem dependências além do Playwright: HTTP nativo do Node + SSE.
 * Roda uma emissão por vez — o navegador automatizado é recurso exclusivo.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CERTIDOES } from './certidoes/index.js';
import { esperarPessoa } from './contexto.js';
import { emitirCertidoes } from './emissor.js';
import { cnpjValido, limparCnpj } from './util.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORT || 3000);
const PAGINA = path.join(RAIZ, 'src', 'web', 'index.html');

/** Estado da execução atual (só uma por vez). */
let job = null;

function novoJob() {
  return {
    id: String(Date.now()),
    ouvintes: new Set(),
    historico: [],
    pendente: null, // { mensagem, resolver }
    cancelar: false,
    terminado: false,
  };
}

function publicar(ev) {
  if (!job) return;
  job.historico.push(ev);
  const linha = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of job.ouvintes) res.write(linha);
}

/** Na web, a pessoa avisa que resolveu clicando no botão da página. */
const interacaoWeb = {
  async aguardar(page, opts) {
    const sinalExterno = new Promise((resolve) => {
      job.pendente = { mensagem: opts.mensagem, resolver: () => resolve('botao') };
    });
    publicar({ tipo: 'precisa-humano', mensagem: opts.mensagem });
    try {
      return await esperarPessoa(page, { ...opts, sinalExterno });
    } finally {
      job.pendente = null;
      publicar({ tipo: 'humano-resolvido' });
    }
  },
};

function json(res, codigo, corpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

async function lerCorpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  try { return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { return {}; }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(PAGINA));
    return;
  }

  if (url.pathname === '/api/certidoes') {
    return json(res, 200, CERTIDOES.map((c) => ({
      id: c.id,
      nome: c.nome,
      humano: c.humano || null,
      humanoOpcional: !!c.humanoOpcional,
    })));
  }

  if (url.pathname === '/api/estado') {
    return json(res, 200, {
      rodando: !!job && !job.terminado,
      pendente: job?.pendente?.mensagem || null,
    });
  }

  // --------------------------------------------------- iniciar emissão
  if (url.pathname === '/api/emitir' && req.method === 'POST') {
    if (job && !job.terminado) return json(res, 409, { erro: 'já existe uma emissão em andamento' });

    const corpo = await lerCorpo(req);
    const cnpj = limparCnpj(corpo.cnpj);
    if (!cnpjValido(cnpj)) return json(res, 400, { erro: 'CNPJ inválido — confira os dígitos' });

    const ids = Array.isArray(corpo.ids) && corpo.ids.length ? corpo.ids : null;
    job = novoJob();
    const meu = job;

    emitirCertidoes({
      cnpj,
      raiz: RAIZ,
      saida: corpo.saida?.trim() || undefined,
      only: ids,
      auto: false,
      eventos: publicar,
      interacao: interacaoWeb,
      cancelado: () => meu.cancelar,
    })
      .catch((e) => publicar({ tipo: 'erro-fatal', texto: String(e.message || e) }))
      .finally(() => {
        meu.terminado = true;
        publicar({ tipo: 'encerrado' });
        for (const r of meu.ouvintes) r.end();
        meu.ouvintes.clear();
      });

    return json(res, 200, { jobId: meu.id });
  }

  // --------------------------------------------------- fluxo de eventos (SSE)
  if (url.pathname === '/api/eventos') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    if (!job) { res.write('data: {"tipo":"ocioso"}\n\n'); return; }
    // Reenvia o que já passou, para quem abriu a página no meio da execução.
    for (const ev of job.historico) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (job.terminado) { res.end(); return; }
    job.ouvintes.add(res);
    req.on('close', () => job?.ouvintes.delete(res));
    return;
  }

  if (url.pathname === '/api/continuar' && req.method === 'POST') {
    if (!job?.pendente) return json(res, 400, { erro: 'nada aguardando' });
    job.pendente.resolver();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/cancelar' && req.method === 'POST') {
    if (job) job.cancelar = true;
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/abrir-pasta' && req.method === 'POST') {
    const corpo = await lerCorpo(req);
    const pasta = path.resolve(corpo.pasta || '');
    if (!fs.existsSync(pasta)) return json(res, 404, { erro: 'pasta não encontrada' });
    // explorer.exe sai com código 1 mesmo quando abre — não dá para checar.
    spawn('explorer.exe', [pasta], { detached: true, stdio: 'ignore' }).unref();
    return json(res, 200, { ok: true });
  }

  res.writeHead(404).end('não encontrado');
});

servidor.listen(PORTA, () => {
  console.log(`\n  Emissão de Certidões — interface em http://localhost:${PORTA}\n`);
  console.log('  Ctrl+C para encerrar.\n');
  spawn('cmd', ['/c', 'start', '', `http://localhost:${PORTA}`], { detached: true, stdio: 'ignore' }).unref();
});
