// Gera os ícones do aplicativo a partir da chama do painel (npm run icones). Os PNGs ficam no Git:
//   desktop/icons/app.png (256 px, instalador e janela) e desktop/icons/tray-<cor>.png (bandeja, 32 px).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FLAME = 'M12 2.6c.7 3 4.6 5.1 4.6 9.9a4.6 4.6 0 0 1-9.2 0c0-2.1 1-3.5 2.3-4.6.1 1.9.9 3 2 3.4-.5-2.9 0-5.9.3-8.7z';
const OUT = path.join(__dirname, '..', 'desktop', 'icons');
// Cor de cada estado da bandeja: verde tudo certo, amarelo precisa de você, vermelho problema, cinza desligado
const DOTS = { verde: '#22c55e', amarelo: '#f5b301', vermelho: '#ef4444', cinza: '#8a8f98' };

const app = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256">
  <rect width="24" height="24" rx="5.5" fill="#16121c"/>
  <g transform="translate(2.4 2.2) scale(0.8)"><path d="${FLAME}" fill="#ff3d7f"/></g></svg>`;
const tray = (dot) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
  <path d="${FLAME}" fill="#ff3d7f" transform="translate(-3.5 -1.5) scale(1.25)"/>
  <circle cx="18.6" cy="18.6" r="5" fill="${dot}" stroke="#16121c" stroke-width="1.6"/></svg>`;

async function shot(page, svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: file, omitBackground: true });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await shot(page, app, 256, path.join(OUT, 'app.png'));
  for (const [name, color] of Object.entries(DOTS)) await shot(page, tray(color), 32, path.join(OUT, `tray-${name}.png`));
  await browser.close();
  console.log(`Ícones gerados em ${OUT}`);
})();
