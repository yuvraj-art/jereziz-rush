# Jereziz rush

The web edition of the three-lane runner takes Jereziz through the six night districts of Railway World. The playable ZIP includes a local launcher. This source project builds the same game.

## Run from source

From `apps/web`, run `npm ci` followed by `npm run dev`. Open the URL printed by Vite. Use Node.js 22.12 or newer.

## Build and play

Run `npm test` and `npm run build` in `apps/web`. Serve `apps/web/dist` with any static HTTP server, or run `python3 play.py` inside that folder. The Windows and macOS launchers in the same folder use Python 3.

## Controls

Use the arrow keys or WASD for lanes, jump and roll. Space also jumps. B activates a hoverboard. Swipe on the game surface for movement and double-tap for a board. P or Escape pauses.

The scene is assembled in `apps/web/src/recovered-world.ts`. The six environment sections are in `apps/web/public/railway`. Replacement character and train loading and sizing are in `reskin.ts`. The route and physics settings are in `shared/config`. The playable browser assets live in `apps/web/public`.

The route repeats every 1,200 metres. The six districts each run for 200 metres, in this order: Venom Sanctum, Venom Abyssal Dock, Jester Court, Jester After Dark, Dentist Enamel Ward and Dentist Ortho Lab. Each district has one entrance gate.
