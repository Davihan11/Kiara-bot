//"BACKEND" file for the Wordle feature - handles saving/loading data and calculating all the stats

const fs = require('fs'); //for reading and writing the JSON file
const path = require('path'); //for building file paths

const WORDLE_FILE_PATH = path.join(__dirname, 'wordle.json'); //where all the Wordle data lives on disk

//loads the whole wordle.json file (results, name mappings, hidden users)
//if the file is missing or broken, we just start with an empty store
function loadWordleStore() {
    // quick cheat sheet for what wordle.json looks like on disk:
    // {
    //   "sync":   { "Someone": "123456789012345678" },      // plain name -> Discord user ID
    //   "hidden": [ "123456789012345678", "SomeName" ],    // users hidden from the leaderboard
    //   "data": [
    //     {
    //       "date": "2026-09-27",                          // the Wordle day (YYYY-MM-DD)
    //       "streak": 12,                                  // group streak from the bot's post
    //       "entries": [
    //         { "guesses": 4, "userIds": ["123456789012345678"] },
    //         { "guesses": 0, "userIds": ["Someone"] }     // 0 = failed (X/6)
    //       ]
    //     }
    //   ]
    // }
    const empty = { sync: {}, hidden: [], data: [] }; //what we fall back to when there's no usable data
    try {
        if (fs.existsSync(WORDLE_FILE_PATH)) { //does the file exist?
            const parsed = JSON.parse(fs.readFileSync(WORDLE_FILE_PATH, 'utf8')); //read it and parse the JSON
            if (parsed && typeof parsed === 'object') { //make sure it parsed into something usable
                //rebuild each part separately with fallbacks, so one broken part can't take the whole store down
                const store = {
                    sync: parsed.sync && typeof parsed.sync === 'object' && !Array.isArray(parsed.sync) ? parsed.sync : {},
                    hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
                    data: Array.isArray(parsed.data) ? parsed.data : [],
                };
                console.log(`[wordle][debug] Store loaded: ${store.data.length} day(s), ${Object.keys(store.sync).length} sync mapping(s), ${store.hidden.length} hidden`);
                return store;
            }
            console.warn('[wordle][debug] Store file exists but is not a valid object — using empty store');
        } else {
            console.log(`[wordle][debug] No store file at ${WORDLE_FILE_PATH} — starting empty`);
        }
    } catch (err) {
        console.error('[wordle] Failed to load wordle store:', err.message);
    }
    return empty;
}

//writes the whole store back to wordle.json
function saveWordleStore(store) {
    try {
        fs.mkdirSync(path.dirname(WORDLE_FILE_PATH), { recursive: true }); //make sure the folder exists (just in case)
        const json = JSON.stringify(store, null, 2); //pretty-print so the file stays human readable
        fs.writeFileSync(WORDLE_FILE_PATH, json, 'utf8'); //write it to disk
        console.log('[wordle] Wordle store saved successfully');
        console.log(`[wordle][debug] Wrote ${json.length} bytes to ${WORDLE_FILE_PATH} — days: ${store.data.length}, sync: ${Object.keys(store.sync).length}, hidden: ${store.hidden.length}`);
        if (store.data.length > 0) { //quick overview of what date range we have saved
            const dates = store.data.map((d) => d.date).sort(); //sort so first = oldest, last = newest
            console.log(`[wordle][debug] Stored date range: ${dates[0]} -> ${dates[dates.length - 1]}`);
        }
    } catch (err) {
        console.error('[wordle] Failed to save wordle store:', err.message);
    }
}

//gets just the saved day entries (the actual Wordle results)
function loadWordleData() {
    return loadWordleStore().data;
}

//saves the day entries, but leaves the sync map and hidden list alone
function saveWordleData(entries) {
    console.log(`[wordle][debug] saveWordleData called with ${entries.length} day(s): ${entries.map((d) => `${d.date} (${d.entries.length} entries)`).join(', ') || '(none)'}`);
    const store = loadWordleStore(); //load the full store first, so we don't wipe the sync/hidden parts
    store.data = entries;
    saveWordleStore(store);
}

//gets the name -> user ID mappings (for players that only show up as plain text names)
function loadWordleSync() {
    return loadWordleStore().sync;
}

//saves the name -> user ID mappings
function saveWordleSync(syncMap) {
    const store = loadWordleStore(); //load the full store first, so we don't wipe the other parts
    store.sync = syncMap;
    saveWordleStore(store);
}

//gets the list of users hidden from the leaderboard
function loadWordleHidden() {
    return loadWordleStore().hidden;
}

//saves the list of hidden users
function saveWordleHidden(hidden) {
    const store = loadWordleStore(); //load the full store first, so we don't wipe the other parts
    store.hidden = hidden;
    saveWordleStore(store);
}

//dumps all saved results as a readable markdown list (mostly for debugging)
//the output looks like this:
//   # Wordle Results
//
//   ## 2026-09-27 — 12 day streak
//   - **4/6**: 123456789012345678
//   - **0/6**: CeeZee
//
//   ## 2026-09-26 — 11 day streak
//   - **3/6**: 123456789012345678, CeeZee
function printWordleData(entries) {
    if (!entries || entries.length === 0) { //nothing to show
        return 'No Wordle results recorded yet.';
    }

    const lines = []; //we build the text one line at a time
    lines.push('# Wordle Results'); //big header
    lines.push(''); //blank line after the header

    for (const day of entries) { //one section per day
        lines.push(`## ${day.date} — ${day.streak} day streak`); //day header with the streak
        for (const entry of day.entries) { //one row per result
            const users = (entry.userIds || entry.users || []).join(', '); //all players on this line
            lines.push(`- **${entry.guesses}/6**: ${users}`);
        }
        lines.push(''); //blank line after each day
    }

    return lines.join('\n'); //glue all the lines together
}

//cleans up an ID/name before comparing it (trims spaces, forces it to be a string)
function normalizeId(id) {
    return String(id || '').trim();
}

//gets a player's current day streak (just the number, nothing else)
function computeCurrentStreak(entries, userId) {
    return computeCurrentStreakInfo(entries, userId).streak; //reuse the full function, keep only the streak count
}

//gets a player's current streak + the date it started
//a streak only counts if they played the most recent day AND every day before it with no gaps
function computeCurrentStreakInfo(entries, userId) {
    const target = normalizeId(userId); //clean the ID so comparisons always work
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)); //copy the array, sort newest day first

    const mostRecent = sorted[0]; //the newest day we have
    if (!mostRecent) return { streak: 0, startDate: null }; //no data at all -> no streak

    //did they play the most recent day? if not, the streak is already broken
    const playedMostRecent = mostRecent.entries.some((e) =>
        (e.userIds || e.users || []).some((u) => normalizeId(u) === target)
    );
    if (!playedMostRecent) return { streak: 0, startDate: null };

    let streak = 0; //how many days in a row so far
    let expectedDate = null; //the date the NEXT day in the streak must have
    let startDate = null; //when the current streak started

    for (const day of sorted) { //walk backwards in time, one day at a time
        const played = day.entries.some((e) => //did they play this day?
            (e.userIds || e.users || []).some((u) => normalizeId(u) === target)
        );

        if (!played) { //missed a day -> streak is over
            break;
        }

        if (expectedDate === null) { //first day we look at = the newest day of the streak
            streak = 1;
            startDate = day.date;
            expectedDate = shiftDate(day.date, -1); //next we want the day right before this one
        } else if (day.date === expectedDate) { //exactly the day we expected -> streak continues
            streak += 1;
            startDate = day.date;
            expectedDate = shiftDate(day.date, -1); //expect one more day earlier
        } else { //there's a gap in the dates -> streak is broken
            break;
        }
    }

    return { streak, startDate };
}

//moves a date forward or backward by N days (negative = go back in time)
function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z'); //the T00:00:00Z pins it to midnight UTC, so timezones can't surprise us
    d.setUTCDate(d.getUTCDate() + days); //do the actual shift
    return d.toISOString().slice(0, 10); //back to "YYYY-MM-DD"
}

//gets a player's longest streak EVER (not just the current one)
function computeBestStreak(entries, userId) {
    const target = normalizeId(userId); //clean the ID so comparisons always work
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1)); //oldest day first this time

    let best = 0; //longest streak found so far
    let current = 0; //the streak we're currently counting
    let prevDate = null; //date of the previous day we counted

    for (const day of sorted) { //walk forward in time, one day at a time
        const played = day.entries.some((e) => //did they play this day?
            (e.userIds || e.users || []).some((u) => normalizeId(u) === target)
        );
        if (!played) { //missed a day -> reset the counter and keep looking
            current = 0;
            prevDate = null;
            continue;
        }

        if (prevDate !== null && day.date === shiftDate(prevDate, 1)) { //next calendar day -> streak continues
            current += 1;
        } else {
            current = 1; //start a fresh streak
        }
        prevDate = day.date;
        if (current > best) best = current; //remember the longest one we've seen
    }

    return best;
}

//calculates all the stats for one player:
//days played, averages, streaks, best/worst/most common guesses, fails, and the guess distribution
//returns null if they never played
function getUserStats(entries, userId) {
    const target = normalizeId(userId); //clean the ID so comparisons always work
    const guessCounts = {}; //how often each guess number happened, like { 3: 5, 4: 2 }
    let daysPlayed = 0;
    let totalGuesses = 0;
    let fails = 0;

    for (const day of entries) { //go over every day...
        for (const entry of day.entries) { //...and every result on that day
            if ((entry.userIds || entry.users || []).some((u) => normalizeId(u) === target)) { //is this result theirs?
                daysPlayed += 1;
                if (entry.guesses === 0) { //0 = failed (X/6)
                    fails += 1;
                } else {
                    totalGuesses += entry.guesses;
                    guessCounts[entry.guesses] = (guessCounts[entry.guesses] || 0) + 1; //count this guess number (+1 each time, starts at 0)
                }
            }
        }
    }

    if (daysPlayed === 0) return null; //they never played -> nothing to report

    const avgGuess = totalGuesses / daysPlayed; //average guesses per day
    const guessNumbers = Object.keys(guessCounts).map(Number).sort((a, b) => a - b); //all guess numbers they ever had, sorted
    const bestGuess = guessNumbers[0] || null; //fewest guesses = their best result
    const worstGuess = guessNumbers[guessNumbers.length - 1] || null; //most guesses = their worst result
    const mostCommonGuess = guessNumbers.length //which guess number shows up most often
        ? guessNumbers.reduce((a, b) => (guessCounts[b] > guessCounts[a] ? b : a), guessNumbers[0])
        : null;

    const currentStreakInfo = computeCurrentStreakInfo(entries, userId); //for the stats card

    let currentStreakStartDay = null; //the "group streak" number from the day their streak started
    if (currentStreakInfo.startDate) {
        const startDay = entries.find((d) => d.date === currentStreakInfo.startDate); //find that day's entry
        if (startDay && typeof startDay.streak === 'number') {
            currentStreakStartDay = startDay.streak;
        }
    }

    return {
        userId,
        daysPlayed,
        avgGuess,
        guessCounts,
        bestGuess,
        worstGuess,
        mostCommonGuess,
        fails,
        currentStreak: currentStreakInfo.streak,
        currentStreakStart: currentStreakInfo.startDate,
        currentStreakStartDay,
        bestStreak: computeBestStreak(entries, userId),
    };
}

//builds the leaderboard stats for every player, sorted best first
//the score works like this: we pull each player's average toward 4.0 (a "Bayesian average" - so
//someone who played once and got lucky doesn't top the board), then we subtract a tiny
//streak bonus from it
function getAllUserStats(entries) {
    const map = new Map(); //one record per player: userId, totalGuesses, daysPlayed

    for (const day of entries) { //go over every day...
        for (const entry of day.entries) { //...every result...
            for (const user of (entry.userIds || entry.users || [])) { //...and every player on that result
                const key = normalizeId(user); //clean the ID so the same player always maps to the same key
                if (!map.has(key)) { //first time we see this player -> create their record
                    map.set(key, { userId: user, totalGuesses: 0, daysPlayed: 0 });
                }
                const rec = map.get(key); //grab their record
                rec.totalGuesses += entry.guesses; //add this day's guesses to their total
                rec.daysPlayed += 1; //one more day played
            }
        }
    }

    const G = 4.0; //the "average player" guess count we pull everyone toward
    const m = 15;  //how strongly we pull toward G (think of it as 15 fake games of 4.0)

    const k = 0.01; //streak bonus - every streak day shaves a tiny bit off the final score

    const stats = [];
    for (const rec of map.values()) { //turn each player's record into a leaderboard entry
        const avgGuess = rec.totalGuesses / rec.daysPlayed;
        const streak = computeCurrentStreak(entries, rec.userId);
        const adjustedScore = ((rec.daysPlayed * avgGuess) + (m * G)) / (rec.daysPlayed + m); //the Bayesian average
        const finalScore = adjustedScore - (streak * k); //apply the streak bonus
        stats.push({
            userId: rec.userId,
            streak,
            avgGuess,
            adjustedScore,
            finalScore,
            daysPlayed: rec.daysPlayed,
        });
    }

    stats.sort((a, b) => a.finalScore - b.finalScore); //lower score = better player, so best comes first
    return stats;
}

//export everything so wordle.js can use it
module.exports = {
    loadWordleData,
    saveWordleData,
    loadWordleSync,
    saveWordleSync,
    loadWordleHidden,
    saveWordleHidden,
    printWordleData,
    getUserStats,
    getAllUserStats,
    WORDLE_FILE_PATH,
};
