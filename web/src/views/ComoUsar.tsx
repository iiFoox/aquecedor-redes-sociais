// Como usar: o tutorial dentro do app. Explica cada tela, o aquecimento, os avisos, os aparelhos e o ícone do relógio.
import type { ReactNode } from 'react';
import { Icon } from '../components/Icon.tsx';
import { useStore, type View } from '../store.tsx';

type Sec = { id: string; title: string; icon: string; body: ReactNode };

function Go({ view, children }: { view: View; children: ReactNode }) {
  const { go } = useStore();
  return (
    <button className="link" onClick={() => go(view)}>
      {children}
    </button>
  );
}

const Item = ({ t, children }: { t: string; children: ReactNode }) => (
  <li>
    <b>{t}</b> {children}
  </li>
);

export function ComoUsar() {
  const { meta } = useStore();
  const ready = meta?.readyDay || 22;

  const secs: Sec[] = [
    {
      id: 'comeco',
      title: 'Comece por aqui',
      icon: 'flame',
      body: (
        <>
          <p>
            O WarmUp Studio aquece contas novas do TikTok e do Instagram sozinho, como uma pessoa usaria: assiste vídeos, curte e segue aos
            poucos, em horários variados. Em {ready} dias a conta fica pronta para postar.
          </p>
          <ol className="guide-steps">
            <li>
              <b>Cadastre um proxy</b> em <Go view="proxies">Proxies</Go> (um endereço de internet diferente para cada conta).
            </li>
            <li>
              Clique em <b>Nova conta</b> (canto de cima): escolha a plataforma, o @ e o proxy.
            </li>
            <li>
              Uma janela do Edge abre: <b>entre na conta</b> normalmente. O app percebe o login, fecha a janela e guarda o login.
            </li>
            <li>
              Escolha os <b>interesses</b> da conta (os assuntos que ela vai assistir).
            </li>
            <li>
              Ligue o <b>piloto automático</b> (faixa no topo ou em <Go view="rotina">Rotina</Go>). Pronto: o robô cuida do resto todo dia.
            </li>
          </ol>
        </>
      ),
    },
    {
      id: 'aquecimento',
      title: 'Como o aquecimento funciona',
      icon: 'gauge',
      body: (
        <>
          <p>Cada conta segue um plano de 5 fases. O dia da conta conta a partir do cadastro.</p>
          <ul className="guide-list">
            <Item t="Fase 1, Adaptação (dias 1 a 3):">só assiste: rola o feed e vê vídeos. Nenhum follow.</Item>
            <Item t="Fase 2, Interação leve (dias 4 a 7):">primeiras curtidas e poucos follows do nicho.</Item>
            <Item t="Fase 3, Engajamento (dias 8 a 14):">mais curtidas, follows e buscas do nicho.</Item>
            <Item t="Fase 4, Consolidação (dias 15 a 21):">uso parecido com o de uma pessoa ativa.</Item>
            <Item t={`Fase 5, Aquecida (dia ${ready} em diante):`}>pronta para postar; uma sessão por dia mantém a conta.</Item>
          </ul>
          <p>
            Todo dia a conta tem uma <b>meta</b> (quantos vídeos, curtidas, follows). O robô divide a meta em algumas sessões ao longo do
            dia, perto do horário em que a conta mais usa, e para quando bate 100%. Nunca passa de 120% do plano: aquecer rápido demais é o
            que derruba conta.
          </p>
          <p>
            O jeito de mexer é humano: pausas de tamanhos diferentes, rolagem com ritmo, às vezes volta um vídeo, erra e corrige a
            digitação. Cada conta tem a sua "personalidade".
          </p>
        </>
      ),
    },
    {
      id: 'cockpit',
      title: 'Cockpit',
      icon: 'gauge',
      body: (
        <ul className="guide-list">
          <Item t="Números do topo:">
            quantas contas estão aquecendo agora, quanto da meta de hoje já foi feito, quantas esperam você e quando é a próxima sessão.
          </Item>
          <Item t="Agenda de hoje:">
            uma linha por conta. A faixa clara é a janela de horário permitida; os blocos coloridos são as sessões (verde concluída, cinza
            interrompida, amarelo sem login, vermelho problema, tracejado prevista). A linha preta é a hora atual.
          </Item>
          <Item t="Contas:">um cartão por conta com a fase, o dia, a meta de hoje e os últimos 30 dias. Clique para abrir a conta.</Item>
          <Item t="Ao vivo e Alertas:">o que o robô está fazendo agora e os avisos recentes.</Item>
          <Item t="Bolinha ao lado de cada conta (barra lateral):">
            verde aquecendo, amarela precisa de login, vermelha esperando você (captcha, bloqueio ou proxy), cinza parada.
          </Item>
        </ul>
      ),
    },
    {
      id: 'conta',
      title: 'Página da conta',
      icon: 'eye',
      body: (
        <ul className="guide-list">
          <Item t="Iniciar / Parar:">
            roda uma sessão agora, até bater 100% da meta do dia (o piloto automático faz isso sozinho em partes).
          </Item>
          <Item t="Login:">abre o Edge da conta para você entrar. Use quando a conta pedir login.</Item>
          <Item t="Login salvo no Supabase às HH:MM:">
            o login da conta está guardado na nuvem, cifrado. Se a pasta sumir ou a conta for para outro aparelho, ela volta logada sozinha.
          </Item>
          <Item t="Tela da sessão:">o navegador da conta ao vivo, enquanto ela aquece.</Item>
          <Item t="Meta de hoje e Jornada:">o que falta hoje e em que fase a conta está.</Item>
          <Item t="Saúde e Naturalidade:">
            nota de 0 a 100 (constância, metas e segurança) e o quanto as pausas e o tempo por vídeo parecem de gente.
          </Item>
          <Item t="Checklist “conta pronta”:">o que fazer à mão antes de postar: foto, bio, link, 3 primeiros posts e destaques.</Item>
          <Item t="Sessões, Eventos e Prints de problemas:">
            o histórico do que aconteceu. Em captcha, bloqueio ou erro, o robô tira um print da tela.
          </Item>
          <Item t="Ajustes desta conta:">trocar proxy, interesses ou o horário só desta conta.</Item>
        </ul>
      ),
    },
    {
      id: 'rotina',
      title: 'Rotina',
      icon: 'calendar',
      body: (
        <ul className="guide-list">
          <Item t="Piloto automático:">
            liga e desliga as contas sozinho, todo dia. Desligado, as contas só aquecem quando você clica em Iniciar.
          </Item>
          <Item t="Janela padrão:">o horário em que as contas podem aquecer (ex.: 08:00 às 22:00).</Item>
          <Item t="Contas ao mesmo tempo:">quantos navegadores abertos juntos. Mais de 2 pesa no PC.</Item>
          <Item t="Intervalo entre sessões:">sorteado a cada vez, para não ter horário fixo.</Item>
          <Item t="Janelas por conta:">um horário diferente só para uma conta.</Item>
          <Item t="Modo férias:">pausa tudo até uma data. Na volta, cada conta continua do dia em que parou (o plano não pula dias).</Item>
        </ul>
      ),
    },
    {
      id: 'proxies',
      title: 'Proxies',
      icon: 'globe',
      body: (
        <>
          <p>
            O proxy é o endereço de internet que a conta usa. Contas na mesma internet parecem a mesma pessoa; com um proxy para cada, cada
            conta parece um aparelho diferente.
          </p>
          <ul className="guide-list">
            <Item t="Adicionar proxy:">
              cole o endereço (com usuário e senha, se tiver). Com senha, use o endereço HTTP (http://usuario:senha@host:porta): o navegador
              não aceita SOCKS5 com senha.
            </Item>
            <Item t="Teste a cada 30 min:">
              o app confere se cada proxy responde, sem abrir navegador, e mostra o IP, o país e o fuso dele.
            </Item>
            <Item t="Disfarce completo:">
              o navegador da conta usa o fuso do proxy e não deixa o IP real da sua internet escapar (WebRTC).
            </Item>
            <Item t="Proxy fora do ar:">as contas dele esperam (não trocam de proxy sozinhas) e voltam quando ele responder.</Item>
          </ul>
        </>
      ),
    },
    {
      id: 'analises',
      title: 'Análises',
      icon: 'chart',
      body: (
        <p>
          Os últimos 30 dias de todas as contas: sessões, sessões concluídas, tempo de tela, captchas e bloqueios, os minutos por dia e uma
          tabela por conta (dia, fase, meta média, saúde). Serve para ver se o aquecimento está constante.
        </p>
      ),
    },
    {
      id: 'ajustes',
      title: 'Ajustes',
      icon: 'sliders',
      body: (
        <ul className="guide-list">
          <Item t="Conta do painel:">o seu e-mail, trocar a senha, sair e os últimos acessos.</Item>
          <Item t="Aparelhos:">o nome deste aparelho e a lista dos seus aparelhos (ligado ou desligado).</Item>
          <Item t="Logins na nuvem:">
            mostra se os logins das contas estão sendo guardados no Supabase. Se aparecer “Chave trancada”, clique em Destrancar com a senha
            atual.
          </Item>
          <Item t="Navegador das sessões:">esconder as janelas do Edge (elas abrem fora da tela) e deixar os vídeos sem som.</Item>
          <Item t="Backup dos logins:">cópia diária das pastas das contas neste PC, às 04:00.</Item>
          <Item t="Aparência:">tema claro, escuro ou o do sistema.</Item>
        </ul>
      ),
    },
    {
      id: 'avisos',
      title: 'Quando a conta precisa de você',
      icon: 'bell',
      body: (
        <>
          <p>Se a plataforma desconfiar, o robô para a sessão na hora e a conta fica esperando você. Nada volta sozinho, de propósito.</p>
          <ul className="guide-list">
            <Item t="Pediu login:">clique em Login na página da conta e entre de novo.</Item>
            <Item t="Captcha:">clique em Abrir navegador, resolva o captcha e feche a janela.</Item>
            <Item t="Bloqueio de ações:">a conta fica parada até você clicar em Liberar na página dela.</Item>
            <Item t="Proxy fora do ar:">espera o proxy voltar.</Item>
          </ul>
          <p>Esses avisos aparecem no painel, como notificação do Windows e no ícone perto do relógio.</p>
        </>
      ),
    },
    {
      id: 'aparelhos',
      title: 'Vários aparelhos',
      icon: 'window',
      body: (
        <ul className="guide-list">
          <Item t="Um usuário por aparelho:">em cada aparelho novo você pode criar uma conta nova do app, que começa zerada.</Item>
          <Item t="O mesmo usuário em vários aparelhos:">
            entre com o mesmo e-mail (não crie conta). Cada conta roda em um aparelho só; os outros acompanham e mandam iniciar ou parar.
          </Item>
          <Item t="Levar uma conta para este aparelho:">
            abra a conta e clique em Rodar neste aparelho. O login dela vem junto da nuvem.
          </Item>
          <Item t="Uma conta nunca abre em dois aparelhos ao mesmo tempo:">
            o app trava a conta enquanto ela está aberta em algum lugar.
          </Item>
        </ul>
      ),
    },
    {
      id: 'relogio',
      title: 'Ícone perto do relógio',
      icon: 'bolt',
      body: (
        <>
          <p>
            Fechar a janela não para o robô: ele continua rodando ao lado do relógio do Windows. A cor do ícone diz como estão as coisas:
          </p>
          <ul className="guide-list">
            <Item t="Verde:">tudo certo.</Item>
            <Item t="Amarelo:">alguma conta precisa de você, a bateria está fraca ou os logins na nuvem estão trancados.</Item>
            <Item t="Vermelho:">captcha ou bloqueio em alguma conta.</Item>
            <Item t="Cinza:">ligando.</Item>
          </ul>
          <p>
            Com o botão direito: abrir o painel, ligar ou desligar <b>Iniciar com o Windows</b>, procurar atualização, abrir os registros e{' '}
            <b>Sair</b> (este sim para o robô).
          </p>
        </>
      ),
    },
    {
      id: 'duvidas',
      title: 'Perguntas comuns',
      icon: 'search',
      body: (
        <ul className="guide-list">
          <Item t="Preciso deixar o PC ligado?">
            Sim. O robô roda no aparelho; desligado, as contas dele não aquecem (e retomam quando ligar).
          </Item>
          <Item t="E o notebook?">
            Na tomada, roda normal. Na bateria abaixo de 20%, não abre sessão nova. Com a tampa fechada o Windows dorme e as sessões param,
            a menos que você mude isso nas Opções de energia.
          </Item>
          <Item t="Esqueci a senha.">Na tela de login, use Esqueci a senha: chega um link no seu e-mail.</Item>
          <Item t="Como atualizo?">
            Sozinho. Com a janela aberta, o app pergunta “Atualizar agora”. Com a janela fechada, instala assim que nenhuma conta estiver
            aquecendo e volta sozinho, já logado. Nada se perde.
          </Item>
          <Item t="O painel pediu para entrar de novo.">
            Acontece quando a senha é trocada ou recuperada: o login antigo do aparelho deixa de valer. Clique em Entrar de novo e use a
            senha atual.
          </Item>
          <Item t="Busca rápida:">Ctrl+K abre a busca: contas, telas e ações (nova conta, férias, backup, tema).</Item>
        </ul>
      ),
    },
  ];

  return (
    <div className="guide">
      <nav className="guide-index panel" aria-label="Seções do tutorial">
        <div className="eyebrow">Neste guia</div>
        {secs.map((s) => (
          <a
            key={s.id}
            href={`#ajuda`}
            onClick={(e) => (e.preventDefault(), document.getElementById(`g-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }))}
          >
            {s.title}
          </a>
        ))}
      </nav>
      <div className="stack">
        {secs.map((s) => (
          <section key={s.id} id={`g-${s.id}`} className="panel guide-sec">
            <h2>
              <Icon name={s.icon} />
              {s.title}
            </h2>
            {s.body}
          </section>
        ))}
      </div>
    </div>
  );
}
