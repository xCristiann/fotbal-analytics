// Model de probabilitate: Poisson + Dixon-Coles pentru scoruri mici,
// medii de goluri specifice per liga, piata de cornere, integrare H2H.

export interface TeamForm {
  avgGoalsScored: number;
  avgGoalsConceded: number;
}

export interface HeadToHeadStats {
  matchesCount: number;
  bttsRate: number;
  over25Rate: number;
}

export interface LeagueAverages {
  avgHomeGoals: number;
  avgAwayGoals: number;
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

export function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

const DEFAULT_LEAGUE_AVG_HOME_GOALS = 1.45;
const DEFAULT_LEAGUE_AVG_AWAY_GOALS = 1.15;
const MAX_GOALS = 8;
const DIXON_COLES_RHO = -0.13;

function dixonColesTau(x: number, y: number, lambdaHome: number, lambdaAway: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (x === 0 && y === 1) return 1 + lambdaHome * rho;
  if (x === 1 && y === 0) return 1 + lambdaAway * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function calculateExpectedGoals(
  home: TeamForm,
  away: TeamForm,
  leagueAvg?: LeagueAverages
): { lambdaHome: number; lambdaAway: number } {
  const avgHome = leagueAvg?.avgHomeGoals ?? DEFAULT_LEAGUE_AVG_HOME_GOALS;
  const avgAway = leagueAvg?.avgAwayGoals ?? DEFAULT_LEAGUE_AVG_AWAY_GOALS;

  const homeAttackStrength = home.avgGoalsScored / avgHome;
  const homeDefenseWeakness = home.avgGoalsConceded / avgAway;
  const awayAttackStrength = away.avgGoalsScored / avgAway;
  const awayDefenseWeakness = away.avgGoalsConceded / avgHome;

  const lambdaHome = homeAttackStrength * awayDefenseWeakness * avgHome;
  const lambdaAway = awayAttackStrength * homeDefenseWeakness * avgAway;

  return { lambdaHome, lambdaAway };
}

export function calculateAllMarkets(
  home: TeamForm,
  away: TeamForm,
  h2h?: HeadToHeadStats,
  leagueAvg?: LeagueAverages
): MarketProbability[] {
  const { lambdaHome, lambdaAway } = calculateExpectedGoals(home, away, leagueAvg);

  const scoreMatrix: number[][] = [];
  let totalMass = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    scoreMatrix[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      let p = poissonProbability(lambdaHome, h) * poissonProbability(lambdaAway, a);
      p *= dixonColesTau(h, a, lambdaHome, lambdaAway, DIXON_COLES_RHO);
      scoreMatrix[h][a] = p;
      totalMass += p;
    }
  }

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      scoreMatrix[h][a] = scoreMatrix[h][a] / totalMass;
    }
  }

  let pHomeWin = 0;
  let pDraw = 0;
  let pAwayWin = 0;
  let pBttsYes = 0;
  let pOver25 = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = scoreMatrix[h][a];
      if (h > a) pHomeWin += p;
      else if (h === a) pDraw += p;
      else pAwayWin += p;

      if (h >= 1 && a >= 1) pBttsYes += p;
      if (h + a > 2.5) pOver25 += p;
    }
  }

  if (h2h && h2h.matchesCount >= 3) {
    const h2hWeight = 0.25;
    pBttsYes = pBttsYes * (1 - h2hWeight) + h2h.bttsRate * h2hWeight;
    pOver25 = pOver25 * (1 - h2hWeight) + h2h.over25Rate * h2hWeight;
  }

  const pBttsNo = 1 - pBttsYes;
  const pUnder25Final = 1 - pOver25;
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
    { market: 'OU25', selection: 'UNDER', label: 'Sub 2.5 goluri', probability: pUnder25Final, fairOdds: 1 / pUnder25Final },
    { market: 'DC', selection: '1X', label: 'Dubla sansa 1X', probability: pDoubleChance1X, fairOdds: 1 / pDoubleChance1X },
    { market: 'DC', selection: 'X2', label: 'Dubla sansa X2', probability: pDoubleChanceX2, fairOdds: 1 / pDoubleChanceX2 },
    { market: 'DC', selection: '12', label: 'Dubla sansa 12', probability: pDoubleChance12, fairOdds: 1 / pDoubleChance12 },
  ];

  return markets.sort((a, b) => b.probability - a.probability);
}

const CORNER_THRESHOLDS = [8.5, 9.5, 10.5];

// Model Poisson separat pentru totalul de cornere (suma ambelor echipe),
// bazat pe media reala din ultimele 5 meciuri ale fiecarei echipe.
export function calculateCornerMarkets(
  homeAvgCorners: number | null,
  awayAvgCorners: number | null
): MarketProbability[] {
  if (homeAvgCorners === null || awayAvgCorners === null) return [];

  const lambdaTotal = homeAvgCorners + awayAvgCorners;
  const markets: MarketProbability[] = [];

  for (const threshold of CORNER_THRESHOLDS) {
    const kMax = Math.floor(threshold);
    let pUnder = 0;
    for (let k = 0; k <= kMax; k++) {
      pUnder += poissonProbability(lambdaTotal, k);
    }
    pUnder = Math.max(0.01, Math.min(0.99, pUnder));
    const pOver = 1 - pUnder;

    markets.push({
      market: 'CORNERS',
      selection: 'OVER_' + threshold,
      label: 'Peste ' + threshold + ' cornere (total)',
      probability: pOver,
      fairOdds: 1 / pOver,
    });
    markets.push({
      market: 'CORNERS',
      selection: 'UNDER_' + threshold,
      label: 'Sub ' + threshold + ' cornere (total)',
      probability: pUnder,
      fairOdds: 1 / pUnder,
    });
  }

  return markets;
}
