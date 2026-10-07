// Gera os ícones do aplicativo a partir da chama do painel (npm run icones). Os arquivos ficam no Git:
//   desktop/icons/app.png (256 px, janela), desktop/icons/app.ico (instalador, desinstalador e atalhos;
//   16 a 256 px) e desktop/icons/tray-<cor>.png (bandeja, 32 px).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FLAME = 'M12 2.6c.7 3 4.6 5.1 4.6 9.9a4.6 4.6 0 0 1-9.2 0c0-2.1 1-3.5 2.3-4.6.1 1.9.9 3 2 3.4-.5-2.9 0-5.9.3-8.7z';
const OUT = path.join(__dirname, '..', 'desktop', 'icons');
// Cor de cada estado da bandeja: verde tudo certo, amarelo precisa de você, vermelho problema, cinza desligado
const DOTS = { verde: '#22c55e', amarelo: '#f5b301', vermelho: '#ef4444', cinza: '#8a8f98' };
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const app = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">
  <rect width="24" height="24" rx="5.5" fill="#16121c"/>
  <g transform="translate(2.4 2.2) scale(0.8)"><path d="${FLAME}" fill="#ff3d7f"/></g></svg>`;
const tray = (dot) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
  <path d="${FLAME}" fill="#ff3d7f" transform="translate(-3.5 -1.5) scale(1.25)"/>
  <circle cx="18.6" cy="18.6" r="5" fill="${dot}" stroke="#16121c" stroke-width="1.6"/></svg>`;

async function shot(page, svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  return page.locator('svg').screenshot({ path: file, omitBackground: true });
}

// .ico com PNGs dentro (aceito pelo Windows desde o Vista e pelo NSIS)
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // ícone
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); // 0 = 256
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); // sem paleta
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); // planos
    head.writeUInt16LE(32, e + 6); // bits por pixel
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await shot(page, app(256), 256, path.join(OUT, 'app.png'));
  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: await shot(page, app(size), size) });
  fs.writeFileSync(path.join(OUT, 'app.ico'), ico(pngs));
  for (const [name, color] of Object.entries(DOTS)) await shot(page, tray(color), 32, path.join(OUT, `tray-${name}.png`));
  await browser.close();
  console.log(`Ícones gerados em ${OUT}`);
})();
