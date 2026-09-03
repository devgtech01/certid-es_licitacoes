import fs from 'node:fs';
import path from 'node:path';

export function limparCnpj(v) {
  return String(v || '').replace(/\D/g, '');
}

export function formatarCnpj(v) {
  const d = limparCnpj(v).padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function cnpjValido(v) {
  const d = limparCnpj(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calc(d.slice(0, 12));
  const dv2 = calc(d.slice(0, 12) + dv1);
  return d.slice(12) === `${dv1}${dv2}`;
}

export function hoje() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const CORES = {
  reset: '\x1b[0m', cinza: '\x1b[90m', verde: '\x1b[32m',
  vermelho: '\x1b[31m', amarelo: '\x1b[33m', azul: '\x1b[36m', negrito: '\x1b[1m',
};
const c = (cor, s) => `${CORES[cor]}${s}${CORES.reset}`;

export const log = {
  titulo: (s) => console.log(`\n${c('negrito', s)}`),
  passo: (s) => console.log(`   ${c('cinza', '·')} ${s}`),
  ok: (s) => console.log(`   ${c('verde', '✓')} ${s}`),
  erro: (s) => console.log(`   ${c('vermelho', '✗')} ${s}`),
  aviso: (s) => console.log(`   ${c('amarelo', '!')} ${s}`),
  humano: (s) => console.log(`\n${c('amarelo', '☛  AÇÃO NECESSÁRIA')} ${c('negrito', s)}`),
  info: (s) => console.log(`${c('azul', s)}`),
};

/** Remove caracteres inválidos para nome de arquivo no Windows. */
export function nomeSeguro(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim();
}

export function garantirPasta(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** Evita sobrescrever: arquivo.pdf -> arquivo (2).pdf */
export function caminhoLivre(destino) {
  if (!fs.existsSync(destino)) return destino;
  const dir = path.dirname(destino);
  const ext = path.extname(destino);
  const base = path.basename(destino, ext);
  for (let i = 2; i < 100; i++) {
    const alt = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(alt)) return alt;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}
