// Validação de tudo que entra na API do motor. Campos desconhecidos são descartados.
const { z } = require('zod');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PROXY_URL = /^(https?|socks5):\/\/\S+:\d{2,5}\/?$/i;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const PROXY_MSG = 'Proxy inválido. Use o formato http://usuario:senha@host:porta';

const interests = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    (Array.isArray(v) ? v : String(v || '').split(','))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
  )
  .refine((list) => list.every((s) => s.length <= 40), 'Cada interesse pode ter no máximo 40 letras');

const newAccount = z.object({
  platform: z.enum(['instagram', 'tiktok'], { errorMap: () => ({ message: 'Plataforma inválida' }) }).default('instagram'),
  username: z
    .string({ required_error: 'Informe o usuário', invalid_type_error: 'Informe o usuário' })
    .transform((s) => s.trim().replace(/^@/, ''))
    .refine((s) => s.length > 0, 'Informe o usuário')
    .refine((s) => USERNAME.test(s), 'Usuário inválido: use só letras, números, ponto e _ (até 30)'),
  proxy: z
    .string()
    .optional()
    .transform((s) => (s || '').trim())
    .refine((s) => !s || PROXY_URL.test(s), PROXY_MSG),
  interests,
});

const newProxy = z.object({
  url: z
    .string({ required_error: 'Informe o endereço do proxy', invalid_type_error: 'Informe o endereço do proxy' })
    .transform((s) => s.trim())
    .refine((s) => PROXY_URL.test(s), PROXY_MSG),
});

const configPatch = z.object({
  active: z.boolean().optional(),
  start: z.string().regex(HHMM, 'Horário de início inválido (use HH:MM)').optional(),
  end: z.string().regex(HHMM, 'Horário de fim inválido (use HH:MM)').optional(),
  max: z.coerce.number().int('Use um número inteiro').min(1, 'Mínimo de 1 conta').max(6, 'Máximo de 6 contas ao mesmo tempo').optional(),
  headless: z.boolean().optional(),
  muteAudio: z.boolean().optional(),
});

const openBrowser = z.object({
  purpose: z.enum(['login', 'captcha'], { errorMap: () => ({ message: 'Use purpose "login" ou "captcha"' }) }).default('login'),
});

// Middleware: valida o corpo e troca pelo valor limpo, ou responde 400 com a primeira mensagem
const body = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) return res.status(400).json({ error: r.error.issues[0].message });
  req.body = r.data;
  next();
};

module.exports = { body, schemas: { newAccount, newProxy, configPatch, openBrowser } };
