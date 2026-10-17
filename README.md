# Open Game Review

Free, unlimited chess game reviews for your Chess.com games. Stockfish 18 runs in your browser. No account, server or subscription needed.

- **Load your games by username** through Chess.com's official [published-data API](https://www.chess.com/news/view/published-data-api).
- **Watch for new games:** while watching is on, the app checks every 30 seconds. When a game finishes, its review opens automatically, usually within a minute or two (the API caches responses for about 60 seconds).
- **Full review:** every move gets a label (Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Miss, Blunder). You also get an accuracy score for each player, an eval bar and graph, an arrow for the better move, and the engine's choice in any position.
- **Paste any PGN**, from Lichess, an OTB scoresheet, or anywhere else.
- Reviews are cached in your browser, so reopening a game is instant.

## Fair play

This tool only ever analyzes **finished** games. The Chess.com API does not publish live games, and the app does not read your screen or the game page. Using an engine during a game you're playing breaks Chess.com's fair-play policy, so please don't modify this tool to do that.

## Run it

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:5173, enter a username and pick a game. Use ← → to step through moves, Home/End to jump, and F to flip the board.

To get a static site you can host anywhere (GitHub Pages, Netlify, any folder):

```bash
npm run build
```

The output goes to `dist/`. The build uses relative paths, so it works from a subfolder.

## How the review works

For every position, Stockfish (lite single-threaded WASM build) searches to the selected depth with two principal variations.

| Step | Method |
| --- | --- |
| Win chance | `50 + 50 · (2 / (1 + e^(−0.00368208 · cp)) − 1)`, the Lichess model. Mate scores count as 0% or 100%. |
| Move label | Loss in the mover's win chance: `<2` Excellent, `<5` Good, `<10` Inaccuracy, `<20` Mistake, otherwise Blunder. The engine's top move is Best. |
| Great | The top move, when the second-best move is at least 15 points worse (an "only move"). Plain recaptures don't count. |
| Brilliant | The top move, when it leaves a piece en prise (takeable by a cheaper piece, or undefended) and the position stays at least equal. |
| Miss | Right after the opponent's mistake or blunder, a move that gives back at least 10 points of the advantage. |
| Accuracy | Lichess's open formula: per-move accuracy from win-chance loss, combining a volatility-weighted mean and a harmonic mean. |

Accuracy uses the open Lichess formula, so its numbers won't exactly match Chess.com's proprietary score, although they land close. Higher depth gives a stronger, slower review. Depth 14 takes about 15–30 seconds for a typical blitz game.

## Project layout

```
src/lib/engine.ts      UCI wrapper around the Stockfish Web Worker
src/lib/review.ts      PGN parsing, win chance, move labels, accuracy
src/lib/chesscom.ts    Chess.com published-data API client
src/lib/useReview.ts   Runs and caches the analysis for a game
src/components/        Board, eval graph, move list, summary, game list
scripts/copy-engine.mjs  Copies the Stockfish build into public/engine
```

## License

GPL-3.0-or-later, because the bundled Stockfish.js is GPLv3. Stockfish © the Stockfish developers. Stockfish.js © Chess.com, LLC and contributors. Not affiliated with Chess.com.
