// Regras de e-mail e senha (zod), usadas pelo login, pelo cadastro, pela troca de senha e pelo "npm run usuario"
const { z } = require('zod');

const email = z.string().trim().toLowerCase().max(254).email('E-mail inválido');

// Senha: 10 a 128 caracteres, com letra e número. Sem limite de símbolos (frase-senha vale).
const password = z
  .string()
  .min(10, 'A senha precisa de pelo menos 10 caracteres')
  .max(128, 'Senha longa demais (máximo 128)')
  .refine((s) => /\p{L}/u.test(s) && /\d/.test(s), 'Use letras e números na senha');

const login = z.object({ email, password: z.string().min(1).max(128), remember: z.boolean().optional().default(false) });
const signup = z.object({ email, password });
const change = z.object({ current: z.string().min(1).max(128), password });

// Primeira mensagem de erro do zod, em português
const firstError = (r) => (r.success ? null : r.error.issues[0].message);

module.exports = { email, password, login, signup, change, firstError };
