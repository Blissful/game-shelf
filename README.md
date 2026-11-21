# Game Shelf

**Your BoardGameGeek collection on a cosy virtual shelf.** It's a free static website on GitHub Pages and updates itself from BGG every night. Anyone can run one for their own collection; no coding needed.

**Live example:** https://blissful.github.io/game-shelf/

- **Covers or spines:** real box art from BGG, or a shelf of spines coloured from each box.
- **Arrange the shelves:** base game with its expansions, by theme, play style, weight, last played, kind, status or decade, or one long row.
- **Sort:** recently played, most played, the owner's rating, friends' rating, BGG rating or rank, newest, heaviest, most players or longest.
- **What shall we play?:** filter by player count (or "best at" from BGG's community vote), time, weight, play style, theme and how much text is on the table. Then let it pick one for you.
- **Game card:** players and best count, time, weight, age and language dependence. Shows the owner's rating and review, the BGG average and rank, friends' ratings, number of plays and when it was last played. Links to BGG's how-to-play videos, the rulebooks on BGG and the BGG page. Base games link to their expansions and the other way round.
- **Room:** lights on or off, a torch in the dark, a lively shelf, a visiting cat, zoom, full screen and a "just the shelf" view. Everything has keyboard shortcuts (press `?`).

Everything comes from BGG. To add a game, log it in your BGG collection; it appears on the shelf after the next sync.

---

## Make your own shelf (about 15 minutes, no coding)

1. **Copy this repository.** Click **Use this template → Create a new repository** (or **Fork**). Make it **public**, since GitHub Pages is free for public repositories.
2. **Get a BGG API token.** BGG has required one for its data API since late 2025. Log in to BGG and go to **https://boardgamegeek.com/applications**, then register an application and choose non-commercial use. **BGG reviews every application, which can take a week or more.** Once it's approved, click **Tokens** next to your application and create one.
3. **Tell your copy who you are.** In your repository, go to **Settings → Secrets and variables → Actions**:
   - **Secrets** tab → New repository secret: `BGG_TOKEN` = your token.
   - **Variables** tab → New repository variable: `BGG_USER` = your BGG username.
   - Optional variables: `BGG_FRIENDS` = friends' BGG usernames separated by commas (their ratings show as "Friends' rating"), and `SHELF_TITLE` = a custom heading.
4. **Turn on Pages:** **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. **Run the first sync:** **Actions** tab → **Sync from BoardGameGeek and publish** → **Run workflow**. The first run takes a few minutes because it fetches every game, the plays and the box art.
6. **Open your shelf** at `https://<your-github-username>.github.io/<repository-name>/` and share the link. Viewers don't need an account.

After that it syncs every night by itself. **Run workflow** syncs right away.

Until the token is added, the workflow still publishes the site with a demo shelf, so you can see it working.

> Your BGG collection and plays need to be public (the BGG default) for the sync to see them.

## More settings: `config.json`

Repository variables override the first three fields, so most people never need to edit this file.

| Field | What it does |
|---|---|
| `title` | Heading on the page (default: "<username>'s Game Shelf") |
| `bggUser` | Whose BGG collection to show |
| `friends` | BGG usernames of friends whose ratings to include |
| `includeStatuses` | Which BGG collection statuses to fetch. The page shows **Owned** by default; the **Show** menu switches to the others. |
| `includeRated` | Also fetch games the owner has rated or reviewed but doesn't own (**Show → Rated, not owned**) |
| `includePlays` | Fetch logged plays, for play counts and "last played" |
| `videoLanguages` | Preferred languages for BGG's how-to-play videos, in order, e.g. `["Finnish", "English"]` |

## Optional tweaks: `extras.json`

Per-game overrides keyed by BGG id or exact name: a favourite how-to video (`howToPlay`), `rulesUrl`, house `notes`, a spine `color`, and custom `themes` or `styles`.

## Optional fallback: `games.txt`

For games you don't want to log on BGG. Enter one name, BGG id or BGG link per line. After a sync, `data/sync-report.json` shows what each line matched.

## Running it locally

```bash
npm install
BGG_TOKEN=your-token BGG_USER=your-username npm run sync   # writes site/data/games.json and site/covers/
npm run serve                                              # http://localhost:8080
npm run test:sync                                          # offline test against the sample BGG replies in test/fixtures
```

## How it fits together

```
BoardGameGeek  ──(nightly GitHub Action: scripts/sync.mjs)──▶  site/data/games.json + site/covers/*.jpg  ──▶  GitHub Pages
   collection · game details · plays · videos · friends' ratings
```

The site itself is plain HTML, CSS and JavaScript in `site/`, with no build step. The code is MIT licensed. Board game data and images belong to BoardGameGeek and its contributors and are used under the BGG XML API terms (non-commercial, with attribution: "Powered by BoardGameGeek").
