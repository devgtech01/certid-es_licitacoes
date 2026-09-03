import { formatarCnpj, limparCnpj, log } from './util.js';

// A BrasilAPI devolve 403 para o User-Agent padrão do Node — sempre mandar um.
const CABECALHOS = { 'User-Agent': 'Mozilla/5.0 (compatible; emissao-certidoes/1.0)', Accept: 'application/json' };

async function json(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: CABECALHOS, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const junta = (...p) => p.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

const FONTES = [
  {
    nome: 'BrasilAPI',
    url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`,
    mapear: (j) => ({
      razaoSocial: j.razao_social,
      logradouro: junta(j.descricao_tipo_de_logradouro, j.logradouro, j.numero, j.complemento),
      bairro: j.bairro, municipio: j.municipio, uf: j.uf, cep: j.cep,
      situacao: j.descricao_situacao_cadastral,
    }),
  },
  {
    nome: 'cnpj.ws',
    url: (c) => `https://publica.cnpj.ws/cnpj/${c}`,
    mapear: (j) => {
      const e = j.estabelecimento || {};
      return {
        razaoSocial: j.razao_social,
        logradouro: junta(e.tipo_logradouro, e.logradouro, e.numero, e.complemento),
        bairro: e.bairro, municipio: e.cidade?.nome, uf: e.estado?.sigla, cep: e.cep,
        situacao: e.situacao_cadastral,
      };
    },
  },
  {
    nome: 'ReceitaWS',
    url: (c) => `https://receitaws.com.br/v1/cnpj/${c}`,
    mapear: (j) => ({
      razaoSocial: j.nome,
      logradouro: junta(j.logradouro, j.numero, j.complemento),
      bairro: j.bairro, municipio: j.municipio, uf: j.uf, cep: j.cep,
      situacao: j.situacao,
    }),
  },
];

/**
 * Alguns portais (TJBA) exigem razão social e endereço além do CNPJ.
 * Buscamos isso automaticamente para o usuário digitar só o CNPJ.
 */
export async function buscarDadosEmpresa(cnpj, sobrescritas = {}) {
  const c = limparCnpj(cnpj);
  const base = { cnpj: c, cnpjFmt: formatarCnpj(c), razaoSocial: null, endereco: null, fonte: null };

  if (sobrescritas.razaoSocial && sobrescritas.endereco) {
    return { ...base, ...sobrescritas, fonte: 'informado pelo usuário' };
  }

  for (const f of FONTES) {
    try {
      const d = f.mapear(await json(f.url(c)));
      if (!d.razaoSocial) continue;
      const endereco = junta(
        d.logradouro,
        d.bairro && `- ${d.bairro}`,
        d.municipio && `- ${d.municipio}`,
        d.uf && `/${d.uf}`,
        d.cep && `- CEP ${d.cep}`,
      );
      log.ok(`dados da empresa via ${f.nome}: ${d.razaoSocial}`);
      return { ...base, razaoSocial: d.razaoSocial, endereco, situacao: d.situacao, fonte: f.nome, ...sobrescritas };
    } catch (e) {
      log.passo(`${f.nome} indisponível (${String(e.message).slice(0, 40)})`);
    }
  }

  log.aviso('não foi possível obter razão social/endereço automaticamente');
  return { ...base, ...sobrescritas };
}
