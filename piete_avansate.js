#!/usr/bin/env node
// Adauga piete noi, orientate spre ce ofera casele de pariuri reale:
// cornere per echipa, ambele echipe peste X cornere, combo GG+Peste/Sub
// 2.5, total suturi + suturi per echipa, cartonase per echipa.

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

function replaceInFile(relativePath, oldStr, newStr) {
  const fullPath = path.join(__dirname, relativePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  if (!content.includes(oldStr)) {
    console.log('EROARE: nu am gasit textul de inlocuit in ' + relativePath);
    process.exit(1);
  }
  content = content.split(oldStr).join(newStr);
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

writeFile('lib/poisson.ts', `// Model de probabilitate: Poisson + Dixon-Coles pentru scoruri mici,
// medii de goluri specifice per liga, piete de cornere/cartonase/suturi
// (total si per echipa), combo GG+Peste/Sub 2.5, integrare H2H.

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

function clampProb(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
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
  let pBttsYesOver25 = 0;
  let pBttsYesUnder25 = 0;
  let pBttsNoOver25 = 0;
  let pBttsNoUnder25 = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = scoreMatrix[h][a];
      if (h > a) pHomeWin += p;
      else if (h === a) pDraw += p;
      else pAwayWin += p;

      const isBtts = h >= 1 && a >= 1;
      const isOver25 = h + a > 2.5;

      if (isBtts) pBttsYes += p;
      if (isOver25) pOver25 += p;

      if (isBtts && isOver25) pBttsYesOver25 += p;
      else if (isBtts && !isOver25) pBttsYesUnder25 += p;
      else if (!isBtts && isOver25) pBttsNoOver25 += p;
      else pBttsNoUnder25 += p;
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
    { market: 'COMBO', selection: 'GG_PESTE25', label: 'GG si Peste 2.5', probability: pBttsYesOver25, fairOdds: 1 / pBttsYesOver25 },
    { market: 'COMBO', selection: 'GG_SUB25', label: 'GG si Sub 2.5', probability: pBttsYesUnder25, fairOdds: 1 / pBttsYesUnder25 },
    { market: 'COMBO', selection: 'NG_PESTE25', label: 'NG si Peste 2.5', probability: pBttsNoOver25, fairOdds: 1 / pBttsNoOver25 },
    { market: 'COMBO', selection: 'NG_SUB25', label: 'NG si Sub 2.5', probability: pBttsNoUnder25, fairOdds: 1 / pBttsNoUnder25 },
  ];

  return markets.sort((a, b) => b.probability - a.probability);
}

// Piata generica Peste/Sub pentru TOTALUL a doua valori (cornere,
// cartonase, suturi - suma ambelor echipe).
function calculateTotalOverUnderMarkets(
  homeAvg: number | null,
  awayAvg: number | null,
  thresholds: number[],
  marketName: string,
  unitLabel: string
): MarketProbability[] {
  if (homeAvg === null || awayAvg === null) return [];

  const lambdaTotal = homeAvg + awayAvg;
  const markets: MarketProbability[] = [];

  for (const threshold of thresholds) {
    const kMax = Math.floor(threshold);
    let pUnder = 0;
    for (let k = 0; k <= kMax; k++) {
      pUnder += poissonProbability(lambdaTotal, k);
    }
    pUnder = clampProb(pUnder);
    const pOver = 1 - pUnder;

    markets.push({ market: marketName, selection: 'TOTAL_OVER_' + threshold, label: 'Peste ' + threshold + ' ' + unitLabel + ' (total)', probability: pOver, fairOdds: 1 / pOver });
    markets.push({ market: marketName, selection: 'TOTAL_UNDER_' + threshold, label: 'Sub ' + threshold + ' ' + unitLabel + ' (total)', probability: pUnder, fairOdds: 1 / pUnder });
  }

  return markets;
}

// Piata Peste/Sub pentru O SINGURA echipa (nu totalul).
function calculateTeamOverUnderMarkets(
  avg: number | null,
  thresholds: number[],
  marketName: string,
  unitLabel: string,
  teamKey: string,
  teamLabel: string
): MarketProbability[] {
  if (avg === null) return [];

  const markets: MarketProbability[] = [];
  for (const threshold of thresholds) {
    const kMax = Math.floor(threshold);
    let pUnder = 0;
    for (let k = 0; k <= kMax; k++) {
      pUnder += poissonProbability(avg, k);
    }
    pUnder = clampProb(pUnder);
    const pOver = 1 - pUnder;

    markets.push({ market: marketName, selection: teamKey + '_OVER_' + threshold, label: teamLabel + ' peste ' + threshold + ' ' + unitLabel, probability: pOver, fairOdds: 1 / pOver });
    markets.push({ market: marketName, selection: teamKey + '_UNDER_' + threshold, label: teamLabel + ' sub ' + threshold + ' ' + unitLabel, probability: pUnder, fairOdds: 1 / pUnder });
  }
  return markets;
}

// "Ambele echipe peste X" - probabilitate comuna (independenta) ca
// AMBELE echipe sa depaseasca pragul, fiecare pe contul ei.
function calculateBothTeamsOverMarkets(
  homeAvg: number | null,
  awayAvg: number | null,
  thresholds: number[],
  marketName: string,
  unitLabel: string
): MarketProbability[] {
  if (homeAvg === null || awayAvg === null) return [];

  const markets: MarketProbability[] = [];
  for (const threshold of thresholds) {
    const kMax = Math.floor(threshold);
    let pHomeUnder = 0;
    let pAwayUnder = 0;
    for (let k = 0; k <= kMax; k++) {
      pHomeUnder += poissonProbability(homeAvg, k);
      pAwayUnder += poissonProbability(awayAvg, k);
    }
    const pHomeOver = 1 - clampProb(pHomeUnder);
    const pAwayOver = 1 - clampProb(pAwayUnder);
    const pBothOver = clampProb(pHomeOver * pAwayOver);

    markets.push({ market: marketName, selection: 'BOTH_OVER_' + threshold, label: 'Ambele echipe peste ' + threshold + ' ' + unitLabel, probability: pBothOver, fairOdds: 1 / pBothOver });
  }
  return markets;
}

const CORNER_TOTAL_THRESHOLDS = [8.5, 9.5, 10.5];
const CORNER_TEAM_THRESHOLDS = [3.5, 4.5, 5.5];
const CORNER_BOTH_THRESHOLDS = [1.5, 2.5, 3.5];
const CARD_TOTAL_THRESHOLDS = [3.5, 4.5, 5.5];
const CARD_TEAM_THRESHOLDS = [1.5, 2.5];
const SHOTS_TOTAL_THRESHOLDS = [18.5, 22.5];
const SHOTS_TEAM_THRESHOLDS = [8.5, 10.5];

export function calculateCornerMarkets(homeAvgCorners: number | null, awayAvgCorners: number | null): MarketProbability[] {
  return [
    ...calculateTotalOverUnderMarkets(homeAvgCorners, awayAvgCorners, CORNER_TOTAL_THRESHOLDS, 'CORNERS', 'cornere'),
    ...calculateTeamOverUnderMarkets(homeAvgCorners, CORNER_TEAM_THRESHOLDS, 'CORNERS', 'cornere', 'HOME', 'Gazdele'),
    ...calculateTeamOverUnderMarkets(awayAvgCorners, CORNER_TEAM_THRESHOLDS, 'CORNERS', 'cornere', 'AWAY', 'Oaspetii'),
    ...calculateBothTeamsOverMarkets(homeAvgCorners, awayAvgCorners, CORNER_BOTH_THRESHOLDS, 'CORNERS', 'cornere'),
  ];
}

export function calculateCardMarkets(homeAvgCards: number | null, awayAvgCards: number | null): MarketProbability[] {
  return [
    ...calculateTotalOverUnderMarkets(homeAvgCards, awayAvgCards, CARD_TOTAL_THRESHOLDS, 'CARDS', 'cartonase'),
    ...calculateTeamOverUnderMarkets(homeAvgCards, CARD_TEAM_THRESHOLDS, 'CARDS', 'cartonase', 'HOME', 'Gazdele'),
    ...calculateTeamOverUnderMarkets(awayAvgCards, CARD_TEAM_THRESHOLDS, 'CARDS', 'cartonase', 'AWAY', 'Oaspetii'),
  ];
}

export function calculateShotsMarkets(homeAvgShots: number | null, awayAvgShots: number | null): MarketProbability[] {
  return [
    ...calculateTotalOverUnderMarkets(homeAvgShots, awayAvgShots, SHOTS_TOTAL_THRESHOLDS, 'SHOTS', 'suturi'),
    ...calculateTeamOverUnderMarkets(homeAvgShots, SHOTS_TEAM_THRESHOLDS, 'SHOTS', 'suturi', 'HOME', 'Gazdele'),
    ...calculateTeamOverUnderMarkets(awayAvgShots, SHOTS_TEAM_THRESHOLDS, 'SHOTS', 'suturi', 'AWAY', 'Oaspetii'),
  ];
}
`);

// Adaugam extragerea de suturi (din acelasi raspuns unde luam deja
// cornere/cartonase - fara cerere API in plus) si il calculam.
replaceInFile(
  'app/api/sync/route.ts',
  `function computeAverage(values: (number | null)[]): number | null {`,
  `function extractShots(statsResponse: any[], teamId: number): number | null {
  const teamBlock = statsResponse.find((b: any) => b?.team?.id === teamId);
  if (!teamBlock) return null;
  const shotsStat = (teamBlock.statistics || []).find((s: any) => s.type === 'Total Shots');
  if (!shotsStat || shotsStat.value === null || shotsStat.value === undefined) return null;
  return Number(shotsStat.value);
}

function computeAverage(values: (number | null)[]): number | null {`
);

replaceInFile(
  'app/api/sync/route.ts',
  `import { calculateAllMarkets, calculateCornerMarkets, calculateCardMarkets, TeamForm, HeadToHeadStats, LeagueAverages } from '@/lib/poisson';`,
  `import { calculateAllMarkets, calculateCornerMarkets, calculateCardMarkets, calculateShotsMarkets, TeamForm, HeadToHeadStats, LeagueAverages } from '@/lib/poisson';`
);

replaceInFile(
  'app/api/sync/route.ts',
  `      const homeCornersValues: (number | null)[] = [];
      const homeCardsValues: (number | null)[] = [];
      for (const f of homeRecentFixtures) {
        const stats = await fetchFixtureStatistics(f.fixture.id);
        homeCornersValues.push(extractCorners(stats, homeTeam.id));
        homeCardsValues.push(extractCards(stats, homeTeam.id));
      }
      const awayCornersValues: (number | null)[] = [];
      const awayCardsValues: (number | null)[] = [];
      for (const f of awayRecentFixtures) {
        const stats = await fetchFixtureStatistics(f.fixture.id);
        awayCornersValues.push(extractCorners(stats, awayTeam.id));
        awayCardsValues.push(extractCards(stats, awayTeam.id));
      }
      const homeAvgCorners = computeAverage(homeCornersValues);
      const awayAvgCorners = computeAverage(awayCornersValues);
      const homeAvgCards = computeAverage(homeCardsValues);
      const awayAvgCards = computeAverage(awayCardsValues);`,
  `      const homeCornersValues: (number | null)[] = [];
      const homeCardsValues: (number | null)[] = [];
      const homeShotsValues: (number | null)[] = [];
      for (const f of homeRecentFixtures) {
        const stats = await fetchFixtureStatistics(f.fixture.id);
        homeCornersValues.push(extractCorners(stats, homeTeam.id));
        homeCardsValues.push(extractCards(stats, homeTeam.id));
        homeShotsValues.push(extractShots(stats, homeTeam.id));
      }
      const awayCornersValues: (number | null)[] = [];
      const awayCardsValues: (number | null)[] = [];
      const awayShotsValues: (number | null)[] = [];
      for (const f of awayRecentFixtures) {
        const stats = await fetchFixtureStatistics(f.fixture.id);
        awayCornersValues.push(extractCorners(stats, awayTeam.id));
        awayCardsValues.push(extractCards(stats, awayTeam.id));
        awayShotsValues.push(extractShots(stats, awayTeam.id));
      }
      const homeAvgCorners = computeAverage(homeCornersValues);
      const awayAvgCorners = computeAverage(awayCornersValues);
      const homeAvgCards = computeAverage(homeCardsValues);
      const awayAvgCards = computeAverage(awayCardsValues);
      const homeAvgShots = computeAverage(homeShotsValues);
      const awayAvgShots = computeAverage(awayShotsValues);`
);

replaceInFile(
  'app/api/sync/route.ts',
  `      const goalMarkets = calculateAllMarkets(homeForm, awayForm, h2hStats, leagueAvg);
      const cornerMarkets = calculateCornerMarkets(homeAvgCorners, awayAvgCorners);
      const cardMarkets = calculateCardMarkets(homeAvgCards, awayAvgCards);
      const allMarkets = goalMarkets.concat(cornerMarkets, cardMarkets).sort((a, b) => b.probability - a.probability);`,
  `      const goalMarkets = calculateAllMarkets(homeForm, awayForm, h2hStats, leagueAvg);
      const cornerMarkets = calculateCornerMarkets(homeAvgCorners, awayAvgCorners);
      const cardMarkets = calculateCardMarkets(homeAvgCards, awayAvgCards);
      const shotsMarkets = calculateShotsMarkets(homeAvgShots, awayAvgShots);
      const allMarkets = goalMarkets.concat(cornerMarkets, cardMarkets, shotsMarkets).sort((a, b) => b.probability - a.probability);`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga piete avansate: cornere/cartonase per echipa, ambele echipe peste X, GG+Peste2.5, suturi"');
console.log('  git push');
