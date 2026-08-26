/**
 * DEMO DATA — style-sample only.
 *
 * Per DESIGN-BRIEF.md §3 Asset Readiness Gate: `packages/core` is not wired to
 * this UI yet, so this file stands in for the real addon/IPTV/sports data
 * layer. Poster art uses Cinemeta's public poster CDN for real, well-known
 * titles (rights-appropriate for a personal dev build). Game matchups and
 * channel names are deliberately fictional — never real teams/scores/networks.
 */

export type GameState = "live" | "upcoming" | "final";

export interface DemoGame {
  id: string;
  league: string;
  home: string;
  away: string;
  state: GameState;
  clock: string; // e.g. "LIVE", "8:15 PM", "FINAL"
  channel: string;
  posterUrl: string;
}

export interface DemoHero {
  title: string;
  synopsis: string;
  posterUrl: string;
  backdropUrl: string;
}

// Cinemeta poster CDN, real well-known titles — see gate note above.
const metahubPoster = (imdbId: string) =>
  `https://images.metahub.space/poster/medium/${imdbId}/img`;
const metahubBackdrop = (imdbId: string) =>
  `https://images.metahub.space/background/medium/${imdbId}/img`;

export const heroDemo: DemoHero = {
  title: "Dune: Part Two",
  synopsis:
    "Paul Atreides unites with the Fremen to seek revenge against those who destroyed his family.",
  posterUrl: metahubPoster("tt15239678"),
  backdropUrl: metahubBackdrop("tt15239678"),
};

export const continueWatchingDemo = [
  { id: "cw1", title: "Severance", progress: 0.62, posterUrl: metahubPoster("tt11280740") },
  { id: "cw2", title: "Chernobyl", progress: 0.31, posterUrl: metahubPoster("tt7366338") },
  { id: "cw3", title: "Dune: Part One", progress: 0.88, posterUrl: metahubPoster("tt1160419") },
];

export const popularMoviesDemo = [
  { id: "m1", title: "The Dark Knight", posterUrl: metahubPoster("tt0468569") },
  { id: "m2", title: "Inception", posterUrl: metahubPoster("tt1375666") },
  { id: "m3", title: "Parasite", posterUrl: metahubPoster("tt6751668") },
  { id: "m4", title: "Whiplash", posterUrl: metahubPoster("tt2582802") },
  { id: "m5", title: "Arrival", posterUrl: metahubPoster("tt2543164") },
];

// Fictional matchups — DEMO DATA, never real teams/networks/scores.
export const todaysGamesDemo: DemoGame[] = [
  {
    id: "g1",
    league: "DEMO LEAGUE",
    home: "Harbor City",
    away: "North Point",
    state: "live",
    clock: "LIVE — Q3",
    channel: "Sample Sports 1",
    posterUrl: "",
  },
  {
    id: "g2",
    league: "DEMO LEAGUE",
    home: "Riverside",
    away: "Old Mill",
    state: "upcoming",
    clock: "8:15 PM",
    channel: "Sample Sports 2",
    posterUrl: "",
  },
  {
    id: "g3",
    league: "DEMO CUP",
    home: "Union AFC",
    away: "Ashfield",
    state: "upcoming",
    clock: "9:00 PM",
    channel: "Sample Feed 3",
    posterUrl: "",
  },
  {
    id: "g4",
    league: "DEMO LEAGUE",
    home: "Fairview",
    away: "Bay Ridge",
    state: "final",
    clock: "FINAL",
    channel: "Sample Sports 1",
    posterUrl: "",
  },
];
