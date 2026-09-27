# Kiara

A little Discord bot I made for my own server. It posts daily stuff, keeps track of our Wordle scores, and replies with nonsense when you ping it. Nothing fancy, but it makes the server feel a bit more alive.

**Looking for technical details?** Check out the [Code Documentation](codeDocumentationReadme.md).

## What it does

- **Daily fox pics** — posts a random fox photo every morning (Unsplash)
- **Daily cat pics** — same thing but cats, in the evening
- **Question of the day** — pulls an icebreaker question each day so people actually talk
- **Daily quote** — posts a quote once a day, cached so it's not hammering the API
- **Wordle scoreboard** — watches the Wordle bot's results messages, parses everyone's scores, and keeps a running leaderboard with streaks and per-user stats
- **Ping responses** — if you @ the bot it replies with one of ~50 random snarky/cute lines. Some of them are unhinged. That's on purpose.

## Commands

Most of these are owner-only because I don't want random people messing with the schedule.

| Command | What it does |
|---|---|
| `/setupfox` / `/schedulefox` | Pick the channel and cron time for daily foxes |
| `/setupcat` / `/schedulecat` | Same for cats |
| `/setupqotd` / `/scheduleqotd` | Same for the daily question |
| `/setupquote` / `/schedulequote` | Same for the daily quote |
| `/setupwordle` | Tell the bot which channel the Wordle results get posted in |
| `/wordlestats` | Show the leaderboard, or detailed stats for one person |
| `/wordlescan` | Backfill old results by scanning channel history |
| `/wordlesync` | Map a plain-text Wordle name to a Discord user ID |
| `/wordlehide` | Hide someone from the leaderboard |
| `/privacy` | Shows how data is handled |
| `/test` | Test command, does nothing useful |

Schedules use cron format (`MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK`). Defaults are 8am for foxes, 8pm for cats, 2pm for QOTD, 2am for quotes.

## Running it yourself

You probably shouldn't — it's hardcoded for my server in a few places and the ping responses are very inside-jokey. But if you want to anyway:

1. Clone the repo
2. `npm install`
3. Make a `.env` file with these:

```
DISCORD_TOKEN=your bot token
SERVER_ID=comma separated server ids
OWNER_IDS=comma separated owner ids
UNSPLASH_ACCESS_KEY=for the animal pics
QOTD_API_AUTH=auth for the qotd api
QOTD_ROLE_ID=role to ping for qotd
QOTD_CHANNEL_ID=
FOX_CHANNEL_ID=
CAT_CHANNEL_ID=
QUOTE_CHANNEL_ID=
QOTD_FEEDBACK_USER_ID=
SPECIAL_USER_IDS=two user ids, they get special ping responses
EMOTE_BOY=emote for the first special user
EMOTE_GIRL=emote for the second
BOT_EMAIL=your email (goes in the user agent)
```

4. `node src/index.js`

Settings get saved to `data/memory.json` so they survive restarts. Wordle data lives in `data/wordle-data.js`.

## Notes

- Built with discord.js v14
- Icebreaker questions are from [ParabolInc/icebreakers](https://github.com/ParabolInc/icebreakers)
- QOTD API is `api.harys.is-a.dev`
- The Wordle parsing is tuned to one specific Wordle bot's message format, so it'll probably break if you use a different one
