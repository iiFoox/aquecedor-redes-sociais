// Energia do aparelho, informada pelo aplicativo (desktop/main.js):
// - bateria abaixo de 20%: o piloto não abre sessão nova até voltar para a tomada (ou passar de 25%);
// - o Windows vai dormir (tampa fechada, suspensão): as sessões abertas param direito antes.
let hold = null; // motivo da pausa ou null
const LOW = 20;
const BACK = 25;

// Decide a pausa a partir do estado da bateria (puro, testado)
function holdFor({ onBattery, level }, current = null) {
  if (!onBattery || level == null) return null;
  if (level < LOW) return 'bateria';
  if (current === 'bateria' && level < BACK) return 'bateria'; // não fica ligando e desligando em 20%
  return null;
}

function setBattery(info) {
  const before = hold;
  hold = holdFor(info, hold);
  return { hold, changed: before !== hold };
}

module.exports = { hold: () => hold, setBattery, holdFor, LOW, BACK };
