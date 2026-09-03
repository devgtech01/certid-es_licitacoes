// Renderiza a 1ª página dos PDFs de uma pasta em PNG, usando o visualizador do
// Chromium. Serve para conferir visualmente o que foi emitido.
// Uso: node tools/ver-pdf.js "<pasta>"
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const pasta = path.resolve(process.argv[2] || '.');
const saida = path.join(pasta, '_preview');
fs.mkdirSync(saida, { recursive: true });

const pdfs = fs.readdirSync(pasta).filter((f) => f.toLowerCase().endsWith('.pdf'));
if (!pdfs.length) { console.log('nenhum PDF em', pasta); process.exit(0); }

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1500 }, acceptDownloads: true });
const page = await ctx.newPage();

for (const f of pdfs) {
  const url = 'file:///' + path.join(pasta, f).replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const png = path.join(saida, `${path.basename(f, '.pdf')}.png`);
  await page.screenshot({ path: png });
  console.log('->', png);
}
await browser.close();
