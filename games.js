// The lobby's game list. To add a game:
//   1. Link its folder into games/:  ln -s "/path/to/My Game" "games/my-game"
//   2. Add a screenshot to thumbs/ (800x500 works well), or run: python3 serve.py --thumbs
//   3. Add an entry below. `url` is relative to this folder.
//
// category: one of the ids in CATEGORIES.
// badge:    optional ribbon on the tile, e.g. "HOT", "NEW", "BETA".
// featured: shows the game in the big banner at the top; a number sets its place (1 = first).
// localOnly: true shows an entry only when the lobby is opened on this Mac (localhost), e.g. an app on a local server.
// meta: a short label shown instead of the RTP for things that aren't casino games (e.g. "P2P").
// startHint: what to tell the player when an app on a local server isn't running.
// sidebarOnly: true keeps an entry out of the lobby itself (rows, banners, tabs, search, favorites, recent)
//              and lists it in its own sidebar section instead.
// Cover art: covers/<id>.png (600x800, title drawn in the art) and covers/<id>-wide.png (1600x900, no title)
// are picked up automatically when they exist; until then the tile uses the screenshot in `thumb`.

window.CATEGORIES = [
  { id: "all",      label: "All games" },
  { id: "slots",    label: "Slots" },
  { id: "cashout",  label: "Cash-out" },
  { id: "board",    label: "Board" },
  { id: "voyages",  label: "Voyages" },
  { id: "table",    label: "Table" },
  { id: "social",   label: "Social" },
  { id: "tools",    label: "Tools" },
];

window.GAMES = [
  {
    id: "fair-winds",
    title: "Fair Winds",
    tagline: "Load freight, set sail, cash out before the storm.",
    description:
      "Send a fleet across the sea and decide when to cash each ship out. Trade winds and monsoons change the pace; escorted ships pay more but stay locked longer.",
    url: "games/fair-winds/index.html",
    thumb: "thumbs/fair-winds.jpg",
    category: "cashout",
    rtp: "99%",
    badge: "HOT",
    accent: "#f6a04d",
    featured: 2,
  },
  {
    id: "climb-cash-out",
    title: "Canopy Climb",
    tagline: "Push-your-luck snakes & ladders.",
    description:
      "Roll, climb the ladders and cash out before a red square busts you. Pick a risk level, shuffle the ladders, or set an auto cash-out target.",
    url: "games/climb-cash-out/index.html",
    thumb: "thumbs/climb-cash-out.jpg",
    category: "board",
    rtp: "97%",
    accent: "#5fd38d",
  },
  {
    id: "marble-ladders",
    title: "Marble Rush",
    tagline: "Pop marbles, climb the rungs, trigger the Marble Run.",
    description:
      "A marble slot where ladder rungs multiply your pops. Pick a lucky marble, and buy straight into the Marble Run bonus if you like.",
    url: "games/marble-ladders/index.html",
    thumb: "thumbs/marble-ladders.jpg",
    category: "slots",
    rtp: "97%",
    accent: "#b07cff",
  },
  {
    id: "sunstone-run",
    title: "Sunstone Run",
    tagline: "Cairo to the Cape. Pick your roads, find the Star of Africa.",
    description:
      "Plot a route across the continent one road at a time. Every road is priced fair when you choose it, so cash out whenever the run looks good.",
    url: "games/sunstone-run/index.html",
    thumb: "thumbs/sunstone-run.jpg",
    category: "voyages",
    rtp: "96%",
    accent: "#e0703a",
  },
  {
    id: "magellan-live",
    title: "Magellan",
    tagline: "One ship, round the world. Cash out before she's lost.",
    description:
      "A crash game: one ship sails Magellan's route and the multiplier climbs with every mile, up to ×1000 for making it home. Every player sees the same voyage at the same moment. Cash out by hand or set an auto target.",
    url: "games/fair-winds/live/index.html",
    thumb: "thumbs/magellan-live.jpg",
    category: "cashout",
    rtp: "99%",
    accent: "#e8b04a",
    featured: 1,
  },
  {
    id: "nuclear-summit-v2",
    title: "Nuclear Summit",
    tagline: "Fill the nuclear meter, or buy launch codes for 20.",
    description:
      "A satirical cluster slot. Nukes go off on every spin and light multiplier squares; every Nuke pushes the nuclear meter up, and a full meter starts 15 free spins. Launch codes buy them for a flat 20. Two modes: Summit (medium) and Brinkmanship (high).",
    url: "games/nuclear-summit-v2/nuclear-summit-v2.html",
    thumb: "thumbs/nuclear-summit-v2.jpg",
    category: "slots",
    rtp: "96%",
    badge: "NEW",
    accent: "#FF6A13",
    featured: 3,
  },
  {
    id: "nuclear-summit",
    title: "OG Nuclear Summit",
    tagline: "A parody slot with free spins and launch codes.",
    description:
      "The original Nuclear Summit, kept as it was before version 2: a satirical slot with free spins you can win or buy in with launch codes. The math is still placeholder.",
    url: "games/og-nuclear-summit/index.html",
    thumb: "thumbs/nuclear-summit.jpg",
    category: "slots",
    rtp: "~95%",
    badge: "OG",
    accent: "#ff5c9a",
    featured: 4,
  },
  {
    id: "blackjack-plus",
    title: "Blackjack Plus",
    tagline: "Blackjack where you can cash out, pick your card or block the dealer's.",
    description:
      "Player-friendly blackjack: 6 or 8 decks, 3:2 blackjack, dealer stands on soft 17, double after split, surrender. Buy powers priced from the exact odds: cash out at any moment, pick or reshuffle your next card, block a value from your next card or the dealer's, or pull a rank from the shoe. About 0.23% house edge on the base game.",
    url: "games/blackjack-plus/index.html",
    thumb: "thumbs/blackjack-plus.jpg",
    category: "table",
    rtp: "99.8%",
    badge: "NEW",
    accent: "#21c25e",
  },
  {
    id: "refbet",
    title: "YourMarket",
    tagline: "Bet your friends on anything. An AI ref settles it.",
    description:
      "A social feed where you post a bet in one line and bet play-money points on it: yes/no or closest guess. An AI ref, a friend or everyone's agreement settles it. Circles, a Nearby feed, comments and profiles, with its own accounts and its own points (not the lobby wallet).",
    url: "http://localhost:3000/",
    thumb: "thumbs/refbet.jpg",
    category: "social",
    meta: "P2P",           // not a casino game: no RTP
    localOnly: true,       // runs as a Node server on this Mac, so the public site leaves it out
    startHint: "Start YourMarket on this Mac: in ~/YourMarket, run npm start (or npm run demo for a fake AI ref with no API costs), then try again.",
    accent: "#4f46e5",
  },
  {
    id: "portfolio",
    title: "Portfolio",
    tagline: "Track your stocks with live prices, right in the browser.",
    description:
      "The Portfolio desktop widget for Übersicht, running in your browser with live prices. It starts on a demo portfolio; add your own stocks with + and they stay in your browser. Value graph with 5-year history, holdings, sectors, dividends, currencies and a chart for every stock. Also free for your Mac on GitHub.",
    url: "games/portfolio/index.html",
    thumb: "thumbs/portfolio.jpg",
    category: "tools",
    sidebarOnly: true,   // not a game: only a link in the sidebar, never in the lobby rows, banners, tabs or search
    badge: "NEW",
    accent: "#6fd3a5",
  },
  {
    id: "serve-return",
    title: "Serve & Return",
    tagline: "Type two tennis players and it prices the match.",
    description:
      "A tennis match pricing model that runs in your browser: pick two players, and optionally the tournament, surface and format, and it gives each player's chance to win. Ratings as of 15 Nov 2026, from Jeff Sackmann's ATP data (CC BY-NC-SA 4.0). For study only, not betting advice. The first visit downloads about 30 MB.",
    url: "https://onnipackalen.github.io/tennis/",   // its own site on GitHub Pages, so it stays up to date on its own
    category: "tools",
    sidebarOnly: true,   // not a game: only a link in the sidebar
    badge: "NEW",
    accent: "#d4e157",
  },
];
