// Usuários do painel (Supabase Auth), pelo terminal:
//   npm run usuario -- criar <email>    cria (pede a senha sem mostrar). O primeiro usuário fica com as contas já existentes.
//   npm run usuario -- senha <email>    troca a senha (esqueci a senha)
//   npm run usuario -- listar           mostra os usuários e quantas contas cada um tem
const path = require('path');
const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');
const cred = require('../painel/credenciais');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* sem .env: usa as variáveis do sistema */
}

const die = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

// Pergunta sem mostrar o que é digitado (senha)
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function askPassword() {
  const a = await ask('Senha: ');
  const r = cred.password.safeParse(a);
  if (!r.success) die(cred.firstError(r));
  if ((await ask('Repita a senha: ')) !== a) die('As senhas não são iguais');
  return a;
}

async function allUsers(sb) {
  const out = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`Não consegui listar os usuários: ${error.message}`);
    out.push(...data.users);
    if (data.users.length < 200) return out;
  }
}

async function main() {
  const [cmd, rawEmail] = process.argv.slice(2);
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) die('Faltam SUPABASE_URL e SUPABASE_KEY no .env');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  if (cmd === 'listar') {
    const users = await allUsers(sb);
    if (!users.length) return console.log('Nenhum usuário ainda. Crie com: npm run usuario -- criar seu@email.com');
    for (const u of users) {
      const { count } = await sb.from('accounts').select('id', { count: 'exact', head: true }).eq('owner_id', u.id);
      console.log(`${u.email}  ·  ${count || 0} conta(s)  ·  criado em ${u.created_at.slice(0, 10)}`);
    }
    return;
  }

  const em = cred.email.safeParse(rawEmail || '');
  if (!em.success) die(`Uso: npm run usuario -- ${cmd === 'senha' ? 'senha' : 'criar'} seu@email.com`);
  const email = em.data;
  const users = await allUsers(sb);

  if (cmd === 'criar') {
    if (users.some((u) => u.email === email))
      die('Já existe um usuário com esse e-mail. Para trocar a senha: npm run usuario -- senha ' + email);
    const password = await askPassword();
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) die(`Não consegui criar: ${error.message}`);
    console.log(`✅ Usuário ${email} criado.`);
    // Primeiro usuário: fica com as contas e proxies que já existiam (sem dono)
    if (!users.length) {
      const a = await sb.from('accounts').update({ owner_id: data.user.id }).is('owner_id', null).select('id');
      const p = await sb.from('proxies').update({ owner_id: data.user.id }).is('owner_id', null).select('id');
      if (a.error || p.error) die(`Usuário criado, mas não consegui passar as contas para ele: ${(a.error || p.error).message}`);
      console.log(`   As ${a.data.length} conta(s) e ${p.data.length} proxy(s) que já existiam agora são suas.`);
    }
    return;
  }

  if (cmd === 'senha') {
    const user = users.find((u) => u.email === email);
    if (!user) die('Nenhum usuário com esse e-mail. Para ver os usuários: npm run usuario -- listar');
    const password = await askPassword();
    const { error } = await sb.auth.admin.updateUserById(user.id, { password });
    if (error) die(`Não consegui trocar: ${error.message}`);
    // Senha nova: encerra as sessões abertas do painel desse usuário
    await sb.from('panel_sessions').delete().eq('user_id', user.id);
    console.log(`✅ Senha de ${email} trocada. As sessões abertas no painel foram encerradas.`);
    return;
  }

  die('Uso: npm run usuario -- criar <email> | senha <email> | listar');
}

main().catch((e) => die(e.message));
