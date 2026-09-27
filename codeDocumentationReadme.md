# Code Documentation

Technical reference for how the bot is put together. For the casual overview see [README.md](README.md).

## Project layout

```
├── src/
│   ├── index.js          Entry point. Client setup, all daily-post features, command handlers, message listeners
│   └── wordle.js         Wordle result parsing, leaderboard formatting, wordle command handlers
├── data/
│   ├── questions.js      Icebreaker question pool (from ParabolInc/icebreakers)
│   ├── wordle-data.js    Wordle persistence layer + stats computation
│   ├── memory.json       Runtime config (channels, schedules, last QOTD message) — written at runtime
│   ├── wordle.json       Wordle store (results, name sync map, hidden users) — written at runtime
│   └── quote-cache.json  Quote candidate cache, 14 day TTL — written at runtime
└── .env                  Secrets and IDs (not committed)
```

Everything is CommonJS. No build step, no database — state lives in JSON files under `data/`.

## Startup flow (`src/index.js`)

1. `dotenv` loads `.env`. All env vars are destructured at the top of the file.
2. `loadMemory()` reads `data/memory.json`. If it's missing or broken, defaults are used (channels from env, hardcoded cron schedules).
3. A single `discord.js` `Client` is created with `Guilds`, `GuildMessages`, `MessageContent`, and `DirectMessages` intents, plus `Partials.Channel` (needed to receive DMs).
4. `setupWordle(client, memory, saveMemory)` registers the Wordle message listener.
5. On `ClientReady`:
   - **Security sweep** — any guild the bot is in that isn't listed in `SERVER_ID` gets left immediately. Same check runs on `GuildCreate` (new invites).
   - **Command registration** — main commands go to `serverIds[0]` as guild commands (instant), `/test` goes to `serverIds[1]` if set, `/privacy` is registered globally.
   - **Cron jobs start** — one `node-cron` job per feature that has a schedule configured. All jobs run in the `Europe/Bratislava` timezone.

## Configuration & persistence

`memory.json` shape:

```json
{
  "fox":   { "channelId": "...", "schedule": "0 8 * * *" },
  "cat":   { "channelId": "...", "schedule": "0 20 * * *" },
  "qotd":  { "channelId": "...", "schedule": "0 14 * * *", "lastChannelId": "...", "lastMessageId": "..." },
  "quote": { "channelId": "...", "schedule": "0 2 * * *" },
  "wordle": { "channelId": "..." }
}
```

`loadMemory()` / `saveMemory()` handle reads/writes. Every setup/schedule command mutates both the in-memory `config` object and `memory`, then calls `saveMemory(memory)` so settings survive restarts. `qotd.lastMessageId` is tracked so the QOTD message can be kept at the bottom of the channel (see below).

## Daily post features

All four features follow the same pattern:

- `fetchXData()` — pull content from an external source
- `triggerXPost()` — fetch the configured channel, build the message, send it
- `setScheduleX(expression)` — stop the old cron job, persist the new expression, start a new job

### Fox / Cat (`fetchFoxData`, `fetchCatData`, `triggerFoxPost`, `triggerCatPost`)

Both hit `https://api.unsplash.com/photos/random` with `query=fox|cat` and the `UNSPLASH_ACCESS_KEY`. The post includes the image as an attachment plus author/source/description. Fox posts are titled "GOAT OF THE MORNING", cats "GOAT OF THE EVENING".

### QOTD (`fetchQOTDData`, `triggerQOTDPost`)

Question source priority:

1. `PRIORITY_QOTDS` array (currently empty — a manual queue that takes precedence when non-empty)
2. 50/50 coin flip between:
   - local icebreaker pool (`getRandomIcebreaker()` from `data/questions.js`)
   - external API `https://api.harys.is-a.dev/v1/qotd` (auth via `QOTD_API_AUTH` header)

Posting sends two messages: a header that pings `QOTD_ROLE_ID`, then the question itself with mentions disabled. The previous day's question message is deleted before posting the new one.

**Keep-at-bottom behavior:** the `MessageCreate` handler watches the QOTD channel. Whenever anyone sends a message, the bot deletes the tracked question message and re-sends it, so the question always sits at the bottom of the channel. If the fetch fails with error 10008 (message already gone), the tracking is cleared.

### Quote (`triggerQuotePost`)

Posts an "ancient quote" — a real message from the server that's at least 6 months old.

- `collectQuoteCandidates(guild, cutoffDate)` walks every viewable text channel, fetches history in batches of 100 (up to 50 batches per channel), and keeps messages that are: older than the cutoff, not from a bot, and longer than 25 characters. `snowflakeFromDate()` converts the cutoff date into a Discord snowflake so fetching can start near the cutoff instead of from the latest message.
- Candidates are stored as `{ id, channelId, authorId }` only — **message text is never written to disk**. The cache lives in `data/quote-cache.json` with a 14-day TTL (`QUOTE_CACHE_TTL_MS`).
- `getValidQuote()` picks a random candidate and re-fetches it live from the API to verify it still exists. If the message/channel is gone (error 10008/10003) it's purged from the cache. If the author's account is deleted, **all** candidates from that author are purged (GDPR handling).
- The post quotes the message content with `>` prefixes, credits the author, and adds a "View original" link button.

## Wordle tracking (`src/wordle.js` + `data/wordle-data.js`)

### Ingestion

`setupWordle()` registers a `MessageCreate` listener that only processes messages from the hardcoded Wordle bot user ID (`WORDLE_USER_ID = '1211781489931452447'`) in the configured channel.

`parseWordleMessage(content, date)`:

- Requires the text to match `/Here are yesterday's results/i`
- Extracts the group streak via `/(\d+)\s+day streak/i`
- Each result line is parsed with `RESULT_LINE_PATTERN`, which tolerates leading emoji/markdown image tokens, then captures `N/6` or `X/6` (X → `guesses: 0`) plus the user list
- Users can be Discord mentions (`<@123>`) or plain-text names (`USER_TOKEN_PATTERN`)
- The date defaults to the previous day (UTC) since results are posted the morning after

Parsed days go through `applySyncToEntry()` (plain names → user IDs via the sync map) and `mergeDayEntry()` (insert or replace by date), then the store is saved.

### Storage (`data/wordle-data.js`)

Single file `data/wordle.json`:

```json
{
  "sync":   { "PlainName": "123456789" },
  "hidden": ["123456789", "AnotherPlainName"],
  "data":   [ { "date": "2026-09-26", "streak": 42, "entries": [ { "guesses": 3, "userIds": ["..."] } ] } ]
}
```

`loadWordleStore()` validates the shape on read and falls back to empty sections if anything is malformed. The `load*`/`save*` wrappers each touch one section. Note that every save rewrites the whole file — fine at this scale.

### Stats

- `getUserStats(entries, userId)` — days played, average guesses, per-guess distribution, best/worst/most common guess, fail count, current streak (with the group streak day it started on), best streak. Streaks are computed by walking consecutive calendar days (`shiftDate` does UTC date math); a player only has a current streak if they played the most recent recorded day.
- `getAllUserStats(entries)` — leaderboard scoring. Average is pulled toward 4.0 with a Bayesian prior (`m = 15` phantom days at `G = 4.0`) so one-game wonders don't top the board, then a small streak bonus is subtracted (`k = 0.01` per streak day). Lower score = better, sorted ascending.

### Leaderboard rendering

`formatAllStats()` / `formatUserStats()` build box-drawn tables colored with ANSI escape codes inside ` ```ansi ` code blocks. `displayWidth()` counts wide codepoints (CJK, emoji) as 2 columns so padding lines up. Leaderboard shows top 10, medals for top 3, and skips users in the hidden list.

### Commands

All handled in `handleWordleInteraction()`:

- `/setupwordle` — set the results channel (owner)
- `/wordlescan` — `backfillWordleData()` pages through channel history (batches of 100, filtered to the Wordle bot's messages) and re-parses old results
- `/wordlesync` — map a plain-text name to a user ID; retroactively rewrites stored entries via `applySyncToData()`
- `/wordlehide` — add/remove a user (mention or plain name) from the hidden list
- `/wordlestats` — public. Leaderboard, or a detailed per-user card when a user option is given

## Message listeners (`src/index.js`)

One `MessageCreate` handler, in order:

1. Ignore other bots.
2. QOTD keep-at-bottom logic (see above).
3. **DMs** — logged to console, replied to with a random line from `BOT_PING_RESPONSES` (or the sender's special array if they're in `SPECIAL_USER_IDS`), with a footer noting messages are logged.
4. **"snaw wee"** — replies with copypasta
5. **Pings** — same random-response logic as DMs, minus the logging footer.

`SPECIAL_USER_RESPONSES` is built at startup from the first two IDs in `SPECIAL_USER_IDS`, using the `EMOTE_BOY` / `EMOTE_GIRL` emotes.

## Command permissions

In the `InteractionCreate` handler: `privacy` and `wordlestats` are public (`PUBLIC_COMMANDS`). Everything else requires the user's ID to be in `OWNER_IDS`. Non-owners get a snarky refusal message instead of an error.

## Environment variables

| Variable | Used for |
|---|---|
| `DISCORD_TOKEN` | Bot login |
| `SERVER_ID` | Comma-separated allowed guild IDs; [0] gets main commands, [1] gets `/test` |
| `OWNER_IDS` | Comma-separated IDs allowed to run owner commands |
| `UNSPLASH_ACCESS_KEY` | Fox/cat image API |
| `QOTD_API_URL` auth: `QOTD_API_AUTH` | External question API |
| `QOTD_ROLE_ID` | Role pinged on daily questions |
| `QOTD_FEEDBACK_USER_ID` | User mentioned for question suggestions |
| `FOX_CHANNEL_ID` / `CAT_CHANNEL_ID` / `QOTD_CHANNEL_ID` / `QUOTE_CHANNEL_ID` | Default channels (overridden by `/setup*`) |
| `SPECIAL_USER_IDS` | Two user IDs that get custom ping/DM responses |
| `EMOTE_BOY` / `EMOTE_GIRL` | Emotes used in those special responses |
| `BOT_EMAIL` | Embedded in the axios `User-Agent` header |

## Dependencies

- `discord.js` v14 — client, slash commands, buttons
- `node-cron` — scheduled posts
- `axios` — HTTP for Unsplash and the QOTD API
- `dotenv` — env loading
- `eslint` — linting only

## Known sharp edges

- `WORDLE_USER_ID` and the results-message regex are hardcoded to one specific Wordle bot. Different bot → update both in `src/wordle.js`.
- Timezone is hardcoded to `Europe/Bratislava` in every `setSchedule*` call.
- `PRIORITY_QOTDS` is read but never shifted — if you put questions in it, the first one is used forever. It needs a `shift()` + persistence if you actually want a queue.
- Slash commands are re-registered on every startup (`rest.put`), which is fine for guild commands but the global `/privacy` registration can take up to an hour to propagate on first deploy.
- All JSON writes are synchronous and whole-file. Concurrent writes aren't a risk with one process, but don't run two instances against the same `data/` folder.
