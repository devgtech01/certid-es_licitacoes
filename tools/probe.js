// Sonda manual: node tools/probe.js <nome>
import { chromium } from 'playwright';

const CNPJ = '19711011000108';
const nome = process.argv[2];

const b = await chromium.launch({ headless: false });
const c = await b.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
c.on('page', (p) => console.log('>> POPUP:', p.url()));
const p = await c.newPage();
c.on('page', (pg) => pg.on('download', (d) => console.log('>> DOWNLOAD(popup):', d.suggestedFilename())));
p.on('download', (d) => console.log('>> DOWNLOAD:', d.suggestedFilename()));

const dump = async (pg, tag) => {
  console.log(`--- ${tag} url=${pg.url()}`);
  console.log((await pg.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1800))));
  console.log('--- controles:');
  console.log(await pg.evaluate(() => [...document.querySelectorAll('input,select,button,a[href]')]
    .filter((e) => e.getBoundingClientRect().width > 0)
    .map((e) => `${e.tagName}|id=${e.id}|name=${e.getAttribute('name') || ''}|type=${e.getAttribute('type') || ''}|txt=${(e.value || e.innerText || '').trim().slice(0, 45)}`)
    .join('\n')));
};

if (nome === 'caixa') {
  await p.goto('https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.selectOption('[id="mainForm:tipoEstabelecimento"]', { label: 'CNPJ' });
  await p.fill('[id="mainForm:txtInscricao1"]', CNPJ);
  await p.click('[id="mainForm:btnConsultar"]');
  await p.waitForTimeout(9000);
  await dump(p, 'RESULTADO');
  await p.screenshot({ path: 'tools/recon-out/caixa-resultado.png', fullPage: true });

  console.log('\n===== clicando CRF');
  await p.click('a:has-text("Certificado de Regularidade")');
  await p.waitForTimeout(7000);
  for (const pg of c.pages()) await dump(pg, pg === p ? 'CRF-principal' : 'CRF-popup');
  await p.screenshot({ path: 'tools/recon-out/caixa-crf.png', fullPage: true });

  console.log('\n===== clicando VISUALIZAR');
  await p.click('[id="mainForm:btnVisualizar"]');
  await p.waitForTimeout(7000);
  for (const pg of c.pages()) await dump(pg, pg === p ? 'VIS-principal' : 'VIS-popup');

  console.log('\n===== Voltar (btnVoltar) e HISTORICO');
  const atual = c.pages().find((x) => x !== p) || p;
  if (atual !== p) await atual.close();
  await p.click('[id="mainForm:btnVoltar"]').catch((e) => console.log('btnVoltar falhou', String(e).slice(0, 80)));
  await p.waitForTimeout(4000);
  console.log('tem link historico?', !!(await p.$('a:has-text("Histórico do Empregador")')));
  await p.click('a:has-text("Histórico do Empregador")');
  await p.waitForTimeout(7000);
  for (const pg of c.pages()) await dump(pg, pg === p ? 'HIST-principal' : 'HIST-popup');
  await p.screenshot({ path: 'tools/recon-out/caixa-historico.png', fullPage: true });
}

if (nome === 'sancionados') {
  await p.goto('https://www7.tjba.jus.br/pjlcnet/relatorio/fornecedores_sancionados.wsp', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3000);
  await dump(p, 'FORM');
  await p.fill('[name="tmp.cnpj_cpf"]', CNPJ);
  await p.evaluate(() => pesquisar(document.forms[0]));
  await p.waitForTimeout(9000);
  for (const pg of c.pages()) await dump(pg, pg === p ? 'PRINCIPAL' : 'POPUP');
  await p.screenshot({ path: 'tools/recon-out/sancionados-resultado.png', fullPage: true });
}

if (nome === 'tjba') {
  await p.goto('https://portalcertidoes.tjba.jus.br/#/primeirograu', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(6000);
  console.log('OPCOES selectModelo:');
  console.log(await p.evaluate(() => [...document.querySelectorAll('#selectModelo option')].map((o) => `${o.value} => ${o.textContent.trim()}`).join('\n')));
  console.log('selectModelo visivel?', await p.isVisible('#selectModelo'));
  console.log('mdb custom?', await p.evaluate(() => !!document.querySelector('mdb-select, .mdb-select-wrapper, .single-input')));
  await p.check('#radioJuridica');
  await p.selectOption('#selectModelo', { label: 'Certidão Recup. Judicial, Falência, Concordata' }).catch((e) => console.log('selectOption por label falhou:', String(e).split('\n')[0]));
  await p.check('#radioAmbas');
  await p.waitForTimeout(1000);
  await p.screenshot({ path: 'tools/recon-out/tjba-form1.png', fullPage: true });
  await p.click('input[type=submit][value="Avançar"]');
  await p.waitForTimeout(6000);
  await dump(p, 'ETAPA2');
  await p.screenshot({ path: 'tools/recon-out/tjba-form2.png', fullPage: true });
}

if (nome === 'tcu') {
  await p.goto('https://certidoes.apps.tcu.gov.br/emitir-certidao-inidoneos', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(4000);
  await dump(p, 'FORM');
}

console.log('\n(deixando o navegador aberto 20s para inspeção)');
await p.waitForTimeout(20000);
await b.close();
