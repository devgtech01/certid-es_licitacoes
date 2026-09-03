// Recon: abre cada site, despeja os elementos interativos e tira screenshot.
// Uso: node tools/recon.js <apelido>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ALVOS = {
  federal: 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cnpj',
  estadual: 'https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx',
  municipal: 'https://www2.sefaz.salvador.ba.gov.br/servico/certidao-regularidade-fiscal-pj',
  tjba: 'https://portalcertidoes.tjba.jus.br/#/primeirograu',
  cndt: 'https://cndt-certidao.tst.jus.br/inicio.faces',
  tcu: 'https://certidoes.apps.tcu.gov.br/emitir-certidao-inidoneos',
  sancionados: 'https://www7.tjba.jus.br/pjlcnet/relatorio/fornecedores_sancionados.wsp',
  caixa: 'https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf',
  cgu: 'https://certidoes.cgu.gov.br/consulta-certidao',
};

const DUMP = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sel = 'input,select,textarea,button,a[href],[role=button],iframe,mat-select,[formcontrolname]';
  return [...document.querySelectorAll(sel)].filter(vis).map((e) => ({
    tag: e.tagName.toLowerCase(),
    id: e.id || undefined,
    name: e.getAttribute('name') || undefined,
    type: e.getAttribute('type') || undefined,
    fc: e.getAttribute('formcontrolname') || undefined,
    cls: (e.className && typeof e.className === 'string' ? e.className : '').slice(0, 60) || undefined,
    txt: (e.innerText || e.value || '').trim().replace(/\\s+/g, ' ').slice(0, 60) || undefined,
    href: (e.getAttribute('href') || '').slice(0, 90) || undefined,
    src: (e.getAttribute('src') || '').slice(0, 90) || undefined,
  }));
})()`;

const apelido = process.argv[2];
const alvos = apelido ? { [apelido]: ALVOS[apelido] } : ALVOS;
const outDir = path.resolve('tools/recon-out');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: false });
for (const [nome, url] of Object.entries(alvos)) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const log = { nome, url, erro: null, titulo: null, urlFinal: null, elementos: [], frames: [] };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    log.titulo = await page.title();
    log.urlFinal = page.url();
    log.elementos = await page.evaluate(DUMP);
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      log.frames.push({ url: f.url().slice(0, 120) });
    }
    await page.screenshot({ path: path.join(outDir, `${nome}.png`), fullPage: true });
  } catch (e) {
    log.erro = String(e).split('\n')[0];
  }
  fs.writeFileSync(path.join(outDir, `${nome}.json`), JSON.stringify(log, null, 1));
  console.log(`== ${nome} :: ${log.urlFinal || url} :: ${log.erro || 'ok'} :: ${log.elementos.length} elementos`);
  await ctx.close();
}
await browser.close();
