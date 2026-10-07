const { chromium } = require('playwright');
const path = require('path');

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const human = (min = 1500, max = 5000) => sleep(rand(min, max));

// Plano de aquecimento: limites conservadores por dia de vida do aquecimento.
function planForDay(day) {
  if (day <= 3) return { minutes: 8, likes: 3, follows: 0, stories: 3 };
  if (day <= 7) return { minutes: 12, likes: 8, follows: 3, stories: 5 };
  if (day <= 14) return { minutes: 18, likes: 15, follows: 6, stories: 8 };
  if (day <= 21) return { minutes: 25, likes: 25, follows: 10, stories: 10 };
  return { minutes: 30, likes: 35, follows: 15, stories: 12 };
}

function profileDir(id) {
  return path.join(__dirname, 'data', 'profiles', id);
}

function launch(account, headless) {
  const opts = {
    headless,
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  };
  if (account.proxy) opts.proxy = { server: account.proxy };
  return chromium.launchPersistentContext(profileDir(account.id), opts);
}

// Abre o navegador visível para o usuário logar manualmente.
async function openLogin(account) {
  const ctx = await launch(account, false);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://www.instagram.com/accounts/login/');
  return ctx;
}

async function scrollSome(page, times) {
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, rand(300, 900));
    await human(1200, 4500);
    if (Math.random() < 0.15) {
      await page.mouse.wheel(0, -rand(100, 300));
      await human(800, 2000);
    }
  }
}

async function likeVisible(page, budget, log) {
  let done = 0;
  const buttons = page.locator('svg[aria-label="Curtir"], svg[aria-label="Like"]');
  const n = await buttons.count();
  for (let i = 0; i < n && done < budget; i++) {
    if (Math.random() < 0.45) continue; // nem tudo é curtido
    try {
      const el = buttons.nth(i);
      await el.scrollIntoViewIfNeeded({ timeout: 3000 });
      await human(1500, 4000);
      await el.click({ timeout: 3000 });
      done++;
      log(`Curtida #${done}`);
      await human(3000, 9000);
    } catch (_) {}
  }
  return done;
}

async function watchStories(page, count, log) {
  try {
    const story = page.locator('canvas ~ span, header ~ div ul li button').first();
    await story.click({ timeout: 4000 });
    for (let i = 0; i < count; i++) {
      await human(3000, 7000);
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Escape');
    log(`Stories assistidos: ${count}`);
  } catch (_) {
    log('Stories indisponíveis, pulando');
  }
}

async function followFromExplore(page, budget, log) {
  if (budget <= 0) return 0;
  let done = 0;
  await page.goto('https://www.instagram.com/explore/');
  await human(3000, 6000);
  const tiles = page.locator('a[href*="/p/"]');
  const n = Math.min(await tiles.count(), 12);
  for (let i = 0; i < n && done < budget; i++) {
    try {
      await tiles.nth(rand(0, n - 1)).click({ timeout: 3000 });
      await human(3000, 7000);
      const btn = page.getByRole('button', { name: /^(Seguir|Follow)$/ }).first();
      if (await btn.isVisible()) {
        await btn.click();
        done++;
        log(`Seguiu perfil #${done}`);
      }
      await page.keyboard.press('Escape');
      await human(8000, 20000);
    } catch (_) {}
  }
  return done;
}

// Executa uma sessão completa de aquecimento.
async function runSession(account, { day, log, shouldStop }) {
  const plan = planForDay(day);
  log(`Dia ${day}: ${plan.minutes}min, ${plan.likes} curtidas, ${plan.follows} follows, ${plan.stories} stories`);
  const ctx = await launch(account, false);
  const stats = { likes: 0, follows: 0, stories: 0 };
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await human(4000, 8000);
    if (page.url().includes('login')) {
      log('Conta não está logada. Use "Login" no painel primeiro.');
      return { ...stats, error: 'not_logged' };
    }
    const end = Date.now() + plan.minutes * 60000;
    let step = 0;
    while (Date.now() < end && !shouldStop()) {
      step++;
      await scrollSome(page, rand(3, 6));
      if (stats.likes < plan.likes) stats.likes += await likeVisible(page, Math.min(2, plan.likes - stats.likes), log);
      if (step === 2 && plan.stories) {
        await page.goto('https://www.instagram.com/');
        await human(2000, 4000);
        await watchStories(page, plan.stories, log);
        stats.stories = plan.stories;
      }
      if (step === 4) {
        stats.follows += await followFromExplore(page, plan.follows, log);
        await page.goto('https://www.instagram.com/');
      }
      await human(5000, 15000);
    }
    log('Sessão finalizada');
  } finally {
    await ctx.close();
  }
  return stats;
}

module.exports = { runSession, openLogin, planForDay };
