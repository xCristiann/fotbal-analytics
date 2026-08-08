// Link-uri catre paginile de liga de pe Superbet.ro.
// CONFIRMATE prin verificare directa: 39, 140, 135, 78, 61, 283, 2, 88.
// DEDUSE dupa tiparul confirmat la Champions League (3, 848) - ar
// trebui sa fie corecte, dar nu au fost verificate direct.
// Restul: fallback pe pagina generala de fotbal live.

const SUPERBET_LEAGUE_URLS: Record<number, string> = {
  39: 'https://superbet.ro/pariuri-sportive/fotbal/anglia/premier-league/toate',
  140: 'https://superbet.ro/pariuri-sportive/fotbal/spania/laliga/toate',
  135: 'https://superbet.ro/pariuri-sportive/fotbal/italia/serie-a/toate',
  78: 'https://superbet.ro/pariuri-sportive/fotbal/germania/bundesliga/toate',
  61: 'https://superbet.ro/pariuri-sportive/fotbal/franta/ligue-1/toate',
  283: 'https://superbet.ro/pariuri-sportive/fotbal/romania/superliga/toate',
  2: 'https://superbet.ro/pariuri-sportive/fotbal/international-cluburi/uefa-liga-campionilor/toate',
  88: 'https://superbet.ro/pariuri-sportive/fotbal/olanda/eredivisie/toate',
  // deduse dupa tipar, neverificate direct:
  3: 'https://superbet.ro/pariuri-sportive/fotbal/international-cluburi/uefa-europa-league/toate',
  848: 'https://superbet.ro/pariuri-sportive/fotbal/international-cluburi/uefa-conference-league/toate',
};

const SUPERBET_FALLBACK_URL = 'https://superbet.ro/pariuri-sportive/fotbal/live';

export function getSuperbetLink(leagueId: number): string {
  return SUPERBET_LEAGUE_URLS[leagueId] || SUPERBET_FALLBACK_URL;
}
