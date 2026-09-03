import federal from './01-federal-rfb.js';
import estadual from './02-estadual-sefaz-ba.js';
import municipal from './03-municipal-salvador.js';
import tjba from './04-tjba-primeiro-grau.js';
import cndt from './05-cndt-tst.js';
import tcu from './06-tcu-inidoneos.js';
import sancionados from './07-tjba-fornecedores-sancionados.js';
import caixa from './08-caixa-crf-fgts.js';
import cgu from './09-cgu-correcional.js';

/** Ordem de execução: as automáticas primeiro, para render resultado rápido. */
export const CERTIDOES = [
  estadual, tcu, sancionados, caixa, federal, // rodam sozinhas
  municipal, tjba, cndt, // captcha digitado pela pessoa
  cgu, // login gov.br
];

export const porId = (id) => CERTIDOES.find((c) => c.id === id);
