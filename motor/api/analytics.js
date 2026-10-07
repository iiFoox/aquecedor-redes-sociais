const express = require('express');
const store = require('../store');
const runner = require('../runner');
const rules = require('../rules');

const router = express.Router();

router.get('/analytics', (_, res) => {
  const accs = store.all();
  const days = {};
  const today = store.localDate();
  for (let i = 6; i >= 0; i--) days[rules.addDays(today, -i)] = { minutes: 0, likes: 0, follows: 0 };
  const platStats = { instagram: { accs: 0, minutes: 0 }, tiktok: { accs: 0, minutes: 0 } };
  let totalMinutes = 0;
  let totalSessions = 0;
  let successSessions = 0;
  let blockedAccounts = 0;

  for (const a of accs) {
    if (platStats[a.platform]) platStats[a.platform].accs++;
    // Conta parada por captcha ou bloqueio (login não conta: não é sinal da plataforma)
    if (a.attention && a.attention.kind !== 'login') blockedAccounts++;
    totalSessions += a.history.length;
    successSessions += a.history.filter((s) => (s.completion || 0) >= 0.9).length;
    for (const [date, m] of Object.entries(a.daily)) {
      totalMinutes += m.minutes || 0;
      if (platStats[a.platform]) platStats[a.platform].minutes += m.minutes || 0;
      if (days[date]) {
        days[date].minutes += m.minutes || 0;
        days[date].likes += m.like || 0;
        days[date].follows += m.follow || 0;
      }
    }
  }

  res.json({
    kpis: {
      totalAccounts: accs.length,
      blockedAccounts,
      activeNow: Object.keys(runner.activeSessions()).length,
      totalMinutes: totalMinutes.toFixed(1),
      totalSessions,
      successRate: totalSessions ? Math.round((successSessions / totalSessions) * 100) : 100,
    },
    history: Object.keys(days).map((d) => ({ date: d, ...days[d] })),
    platforms: platStats,
  });
});

module.exports = router;
