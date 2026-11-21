# Slayde's Game Shelf

A cosy virtual board game shelf built from a BoardGameGeek collection. It's a free static website on GitHub Pages and updates itself from BGG every night.

- **Covers or spines:** real box art from BGG, or a shelf of spines coloured from each box.
- **Arrange the shelves:** base game with its expansions, by theme, play style, weight, last played, kind, status or decade, or one long row.
- **Sort:** recently played, most played, his rating, friends' rating, BGG rating or rank, newest, heaviest, most players or longest.
- **What shall we play?:** filter by player count (or "best at" from BGG's community vote), time, weight, play style, theme and how much text is on the table. Then let it pick one for you.
- **Game card:** players and best count, time, weight, age and language dependence. Shows his rating, the BGG average and rank, friends' ratings, number of plays and when it was last played, and his BGG review. Links to BGG's how-to-play videos, the rulebooks on BGG and the BGG page. Base games link to their expansions and the other way round.
- **Room:** lights on or off, a torch in the dark, a lively shelf, a visiting cat, zoom, full screen and a "just the shelf" view. Everything has keyboard shortcuts (press `?`).

Everything comes from BGG. To add a game, log it on BGG; it appears on the shelf after the next sync.

---

## One-time setup (about 15 minutes)

1. **Put this folder in a GitHub repository.** Create a new repository on github.com (e.g. `game-shelf`; public is free for Pages) and upload all the files, including the hidden `.github` folder. With git: `git init && git add . && git commit -m "Game shelf" && git push`.
2. **Get a BGG API token.** BGG now requires one for its data API. Log in to BGG and go to **https://boardgamegeek.com/applications**. Register an application (name it "Game Shelf" and choose non-commercial use), then create a token for it.
3. **Give the token to GitHub.** In the repository, go to **Settings → Secrets and variables → Actions → New repository secret**. Set Name `BGG_TOKEN` and paste the token as the value.
4. **Turn on Pages.** Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. **Run the first sync.** Go to the **Actions** tab, choose **Sync from BoardGameGeek and publish**, then **Run workflow**. The first run takes a few minutes because it fetches every game, the plays and the covers.
6. **Open the shelf** at `https://<github-username>.github.io/<repo-name>/`. Share that link with anyone; viewers don't need an account.

After that it syncs every night by itself. To sync right away, press **Run workflow** again.

> His BGG collection and plays need to be public (the BGG default) for the sync to see them.

## Settings: `config.json`

| Field | What it does |
|---|---|
| `title` | Heading on the page |
| `bggUser` | Whose BGG collection to show (`Slayde`) |
| `friends` | BGG usernames of friends. Their BGG ratings of these games show as "Friends' rating". |
| `includeStatuses` | Which BGG collection statuses to fetch. The page shows **Owned** by default; the **Show** menu switches to the others. |
| `includeRated` | Also fetch games he has rated or reviewed but doesn't own (shown under **Show → Rated, not owned**) |
| `includePlays` | Fetch his logged plays, for play counts and "last played" |
| `videoLanguages` | Preferred languages for BGG's how-to-play videos, in order |

## Optional tweaks: `extras.json`

Per-game overrides keyed by BGG id or exact name: a favourite how-to video (`howToPlay`), `rulesUrl`, house `notes`, a spine `color`, and custom `themes` or `styles`.

## Optional fallback: `games.txt`

For a game he doesn't want to log on BGG. Enter one name, BGG id or BGG link per line. After a sync, `data/sync-report.json` shows what each line matched. `docs/photo-list.txt` keeps the list read from the shelf photo; use it to check that BGG has everything.

## Running it locally

```bash
npm install
BGG_TOKEN=your-token npm run sync     # writes site/data/games.json and site/covers/
npm run serve                         # http://localhost:8080
npm run test:sync                     # offline test against the sample BGG replies in test/fixtures
```

## How it fits together

```
BoardGameGeek  ──(nightly GitHub Action: scripts/sync.mjs)──▶  site/data/games.json + site/covers/*.jpg  ──▶  GitHub Pages
   collection · game details · plays · videos · friends' ratings
```

Data from BoardGameGeek is used under the BGG XML API terms (non-commercial, with attribution).
