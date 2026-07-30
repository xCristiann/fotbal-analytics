// Model de probabilitate bazat pe distributia Poisson.
// Calculeaza sansele pentru principalele piete de pariuri, pornind
// de la golurile medii marcate / incasate de fiecare echipa.
//
// Important: acest model estimeaza probabilitati reale, nu "sanse
// garantate". O piata cu probabilitate 90%+ va aparea rar pe piete
// cu cota mare (ex. BTTS) si des pe piete cu cota mica (ex. dubla
// sansa). Asta e asteptat si corect din punct de vedere statistic.

export interface TeamForm {
  avgGoalsScored: number;
  avgGoalsConceded: number;
}

export interface MarketProbability {
  market: string;
  selection: string;
  label: string;
  probability: number;
  fairOdds: number;
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// Medii de referinta pentru golurile marcate in fotbalul european.
// Le poti recalibra ulterior pe baza datelor istorice reale.
const LEAGUE_AVG_HOME_GOALS = 1.45;
const LEAGUE_AVG_AWAY_GOALS = 1.15;
const MAX_GOALS = 8;

export function calculateExpectedGoals(
  home: TeamForm,
  away: TeamForm
): { lambdaHome: number; lambdaAway: number } {
  const homeAttackStrength = home.avgGoalsScored / LEAGUE_AVG_HOME_GOALS;
  const homeDefenseWeakness = home.avgGoalsConceded / LEAGUE_AVG_AWAY_GOALS;
  const awayAttackStrength = away.avgGoalsScored / LEAGUE_AVG_AWAY_GOALS;
  const awayDefenseWeakness = away.avgGoalsConceded / LEAGUE_AVG_HOME_GOALS;

  const lambdaHome = homeAttackStrength * awayDefenseWeakness * LEAGUE_AVG_HOME_GOALS;
  const lambdaAway = awayAttackStrength * homeDefenseWeakness * LEAGUE_AVG_AWAY_GOALS;

  return { lambdaHome, lambdaAway };
}

export function calculateAllMarkets(home: TeamForm, away: TeamForm): MarketProbability[] {
  const { lambdaHome, lambdaAway } = calculateExpectedGoals(home, away);

  const scoreMatrix: number[][] = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    scoreMatrix[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      scoreMatrix[h][a] = poissonProbability(lambdaHome, h) * poissonProbability(lambdaAway, a);
    }
  }

  let pHomeWin = 0;
  let pDraw = 0;
  let pAwayWin = 0;
  let pBttsYes = 0;
  let pOver25 = 0;
  let pUnder25 = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = scoreMatrix[h][a];
      if (h > a) pHomeWin += p;
      else if (h === a) pDraw += p;
      else pAwayWin += p;

      if (h >= 1 && a >= 1) pBttsYes += p;

      if (h + a > 2.5) pOver25 += p;
      else pUnder25 += p;
    }
  }

  const pBttsNo = 1 - pBttsYes;
  const pDoubleChance1X = pHomeWin + pDraw;
  const pDoubleChanceX2 = pDraw + pAwayWin;
  const pDoubleChance12 = pHomeWin + pAwayWin;

  const markets: MarketProbability[] = [
    { market: '1X2', selection: 'HOME', label: 'Victorie gazde', probability: pHomeWin, fairOdds: 1 / pHomeWin },
    { market: '1X2', selection: 'DRAW', label: 'Egal', probability: pDraw, fairOdds: 1 / pDraw },
    { market: '1X2', selection: 'AWAY', label: 'Victorie oaspeti', probability: pAwayWin, fairOdds: 1 / pAwayWin },
    { market: 'BTTS', selection: 'YES', label: 'Ambele echipe marcheaza', probability: pBttsYes, fairOdds: 1 / pBttsYes },
    { market: 'BTTS', selection: 'NO', label: 'Nu marcheaza ambele echipe', probability: pBttsNo, fairOdds: 1 / pBttsNo },
    { market: 'OU25', selection: 'OVER', label: 'Peste 2.5 goluri', probability: pOver25, fairOdds: 1 / pOver25 },
    { market: 'OU25', selection: 'UNDER', label: 'Sub 2.5 goluri', probability: pUnder25, fairOdds: 1 / pUnder25 },
    { market: 'DC', selection: '1X', label: 'Dubla sansa 1X', probability: pDoubleChance1X, fairOdds: 1 / pDoubleChance1X },
    { market: 'DC', selection: 'X2', label: 'Dubla sansa X2', probability: pDoubleChanceX2, fairOdds: 1 / pDoubleChanceX2 },
    { market: 'DC', selection: '12', label: 'Dubla sansa 12', probability: pDoubleChance12, fairOdds: 1 / pDoubleChance12 },
  ];

  return markets.sort((a, b) => b.probability - a.probability);
}
