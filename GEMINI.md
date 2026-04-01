# obs-results-overlay

OBS browser source overlay that displays live pinball tournament results from [Matchplay](https://matchplay.events) as a ticker or card. Built for streamers running events with the Matchplay tournament management platform.

## Architecture

```
server.js      — Express server (port 8080). Serves static files and a /proxy endpoint
                 that bypasses CORS to reach the Matchplay API.
ticker.js      — All frontend logic. Polls Matchplay every 15s, parses CSV, queues and
                 animates results in the ticker/card.
index.html     — The OBS browser source page.
settings.html  — UI for building the overlay URL with params. Not shown in OBS.
style.css      — All visual styling.
```

## How it works

1. User opens `settings.html`, enters a Matchplay tournament ID, generates a URL
2. That URL is added as a Browser Source in OBS
3. `ticker.js` reads the `?tournament=` param, calls the Matchplay API via the local proxy
4. Results are deduped by game ID (`seenGameIds` Set), queued, and displayed one at a time

## Key files and concepts

### ticker.js

- **`PROXIES` array** — tries the local `/proxy` first, falls back to public CORS proxies. `currentProxyIndex` tracks the last working one across polls.
- **`fetchAndParseCSV()`** — fetches the games CSV, cycles proxies on failure. Uses `(currentProxyIndex + i) % PROXIES.length` to offset from last known-good proxy.
- **`processMatchplayResults()`** — dedupes, builds game objects, pushes to `resultQueue`
- **`displayNextResult()` / `startDisplayQueue()`** — sequential animation loop, `isDisplaying` flag prevents double-starts (safe — JS is single-threaded)
- **URL params**: `tournament`, `speed`, `title`, `bgColor`, `accentColor`, `gameNameColor`, `layout` (horizontal|vertical), `anchor`, `width`

### server.js

- `/proxy?url=` — CORS proxy. Restricted to `https:` protocol and `app.matchplay.events` hostname only (SSRF mitigation).
- Static file serving is restricted to an explicit allowlist (`allowedFiles`).

## Running locally

```bash
npm install
npm start
# → http://localhost:8080
# → http://localhost:8080/settings.html
```

## Automated testing

No test suite exists yet. When the user asks to "run tests", "test my changes", or "check if this works", follow this playbook:

### Setup (first time only)

Install the test runner:
```bash
npm install --save-dev jest supertest
```

Add to `package.json` scripts:
```json
"test": "jest --testPathPattern=tests/"
```

Create a `tests/` directory and add test files as needed.

### Server tests — `tests/server.test.js`

Use `supertest` to spin up the Express app without binding a real port. Test these behaviours:

| Scenario | Expected |
|---|---|
| `GET /proxy` with no `url` param | 400 |
| `GET /proxy?url=http://evil.com` | 403 (non-HTTPS blocked) |
| `GET /proxy?url=https://evil.com` | 403 (non-allowlisted host blocked) |
| `GET /proxy?url=https://app.matchplay.events/...` | 200 (passes through) |
| `GET /` | 200, returns index.html |
| `GET /some-unlisted-file.js` | 404 (not in allowedFiles) |

Template:
```js
const request = require('supertest');
const app = require('../server'); // server.js must export `app` for this to work

test('blocks non-HTTPS URLs', async () => {
  const res = await request(app).get('/proxy?url=http://example.com');
  expect(res.status).toBe(403);
});
```

> Note: `server.js` currently calls `app.listen()` at the bottom. To make it testable, wrap the listen call: `if (require.main === module) { app.listen(...) }` and add `module.exports = app;`

### ticker.js logic tests — `tests/ticker.test.js`

`ticker.js` is browser-only (uses `window`, `document`, `fetch`). Use [jsdom](https://github.com/jsdom/jsdom) via Jest's default environment to test pure logic functions. The functions worth unit testing:

| Function | What to test |
|---|---|
| `processMatchplayResults()` | Deduplication via `seenGameIds` — same game ID should not be queued twice |
| `fetchAndParseCSV()` proxy cycling | On fetch failure, `currentProxyIndex` should advance to the next proxy |
| `getFieldValue()` | Returns correct value across variant column names |

Mock `fetch` with `jest.fn()` to simulate proxy success/failure without network calls.

### Running tests

```bash
npm test
```

Or to watch for changes while developing:
```bash
npx jest --watch
```

### Manual smoke test checklist

For changes that are hard to unit test (CSS, animations, OBS rendering):

1. `npm start` — server boots on 8080
2. Open `http://localhost:8080/settings.html` — form renders, URL generates correctly
3. Open the generated URL — ticker container is hidden on load
4. Hit `/proxy?url=https://app.matchplay.events/api/tournaments/REAL_ID/games/csv` — returns CSV
5. Check browser DevTools console — no JS errors on load

## Known security considerations

- `showDebug()` in ticker.js uses `innerHTML` — msg strings come from internal code only, not external data, so risk is low but worth keeping in mind if that ever changes.
- `server.js` error handler sends `error.message` in the 500 response — internal errors may leak details. Low risk locally.

## Future: Matchplay API key integration

Matchplay supports personal API tokens at https://app.matchplay.events/account/tokens. The current implementation hits public unauthenticated endpoints. Adding auth would unlock private tournament data and avoid rate limiting.

**Where to wire it in:**

`server.js` — load the token from an env var and forward it as a header on every proxied request:

```js
// .env
MATCHPLAY_API_TOKEN=your_token_here

// server.js — inside the /proxy handler, add to axios headers:
'Authorization': `Bearer ${process.env.MATCHPLAY_API_TOKEN}`
```

Use the `dotenv` package to load `.env` locally:
```bash
npm install dotenv
```
```js
// top of server.js
require('dotenv').config();
```

Add `.env` to `.gitignore` so the token is never committed.

`settings.html` — optionally add a token input field that appends `?token=` to the generated URL, so the overlay page can pass it through to the proxy. The proxy would prefer the env var but fall back to the query param.

**Do not** store the token in `ticker.js` or any client-side file — it would be visible in the browser.

## What to avoid

- Don't expose port 8080 publicly without adding auth — the proxy would become an open relay even with the hostname restriction.
- Don't remove the `allowedHosts` check in server.js without replacing it with something equivalent.
- The `seenGameIds` Set is in-memory — it resets on page reload, so results already shown won't re-display after a refresh. This is intentional.
