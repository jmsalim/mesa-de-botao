export type Lang = 'pt' | 'en';

const STRINGS = {
  pt: {
    title: 'Mesa de Botão',
    subtitle: 'Futebol de botão para dois jogadores',
    howto: [
      'Arraste para trás um botão do seu time e solte para dar a pancada.',
      'Tocou na bola? Você joga de novo (até 3 toques seguidos).',
      'Bateu primeiro no botão do adversário? Falta: a vez passa.',
      'Para fazer gol, toque em “Chutar ao gol” antes: o adversário posiciona o goleiro.',
      'Cada toque na bola carrega o ⚡ Super Chute: com 3 cargas, sua próxima pancada vem pesada!',
      'Ao arrastar, a linha mostra até onde o botão vai. Linha vermelha = vai dar falta.',
      'Quem fizer 3 gols primeiro vence.',
    ],
    start: 'Jogar',
    twoPlayers: '2 jogadores',
    vsCpu: 'Contra o computador',
    superReady: (t: string) => `⚡ Super Chute carregado! ${t}, jogue de novo`,
    superTag: 'SUPER!',
    cpu: 'PC',
    team0: 'Azul',
    team1: 'Vermelho',
    turn: (t: string) => `Vez do ${t}`,
    flicks: (n: number) => (n === 1 ? 'último toque' : `${n} toques`),
    shoot: 'Chutar ao gol!',
    ready: 'Pronto!',
    keeperPrompt: (t: string) => `${t}: posicione o goleiro!`,
    goal: (t: string) => `GOL do ${t}!`,
    ownGoal: (t: string) => `Gol contra! Ponto do ${t}`,
    noGoal: (t: string) => `Gol anulado: faltou chamar o chute. Tiro de meta do ${t}`,
    foul: (t: string) => `Falta! Vez do ${t}`,
    again: () => 'Tocou na bola: jogue de novo',
    miss: (t: string) => `Errou a bola. Vez do ${t}`,
    limit: (t: string) => `Fim dos toques. Vez do ${t}`,
    win: (t: string) => `${t} venceu!`,
    playAgain: 'Jogar de novo',
    lang: 'EN',
  },
  en: {
    title: 'Mesa de Botão',
    subtitle: 'Button football for two players',
    howto: [
      'Drag back on one of your buttons and release to flick it.',
      'Touched the ball? Flick again (up to 3 in a row).',
      'Hit an opponent’s button before the ball? Foul: the turn passes.',
      'To score, tap “Shoot!” first: your opponent then positions their keeper.',
      'Every ball touch charges the ⚡ Super Flick: at 3 charges your next flick hits heavy!',
      'While dragging, the line shows how far the button slides. A red line means a foul.',
      'First to 3 goals wins.',
    ],
    start: 'Play',
    twoPlayers: '2 players',
    vsCpu: 'Vs computer',
    superReady: (t: string) => `⚡ Super Flick charged! ${t}, flick again`,
    superTag: 'SUPER!',
    cpu: 'CPU',
    team0: 'Blue',
    team1: 'Red',
    turn: (t: string) => `${t}'s turn`,
    flicks: (n: number) => (n === 1 ? 'last flick' : `${n} flicks`),
    shoot: 'Shoot!',
    ready: 'Ready!',
    keeperPrompt: (t: string) => `${t}: place your keeper!`,
    goal: (t: string) => `GOAL for ${t}!`,
    ownGoal: (t: string) => `Own goal! Point for ${t}`,
    noGoal: (t: string) => `No goal: the shot wasn't called. Goal kick for ${t}`,
    foul: (t: string) => `Foul! ${t}'s turn`,
    again: () => 'Ball touched: flick again',
    miss: (t: string) => `Missed the ball. ${t}'s turn`,
    limit: (t: string) => `Out of flicks. ${t}'s turn`,
    win: (t: string) => `${t} wins!`,
    playAgain: 'Play again',
    lang: 'PT',
  },
} as const;

export type Strings = (typeof STRINGS)['pt'];

let current: Lang = 'pt';
try {
  const saved = localStorage.getItem('botao-lang');
  if (saved === 'en' || saved === 'pt') current = saved;
} catch { /* storage may be unavailable */ }

export function getLang(): Lang { return current; }
export function setLang(l: Lang): void {
  current = l;
  try { localStorage.setItem('botao-lang', l); } catch { /* ignore */ }
}
export function t(): Strings { return STRINGS[current] as unknown as Strings; }
