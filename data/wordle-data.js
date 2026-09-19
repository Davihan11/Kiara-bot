const fs = require('fs');
const path = require('path');

const WORDLE_FILE_PATH = path.join(__dirname, 'wordle.json');

function loadWordleStore() {
    const empty = { sync: {}, hidden: [], data: [] };
    try {
        if (fs.existsSync(WORDLE_FILE_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(WORDLE_FILE_PATH, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                return {
                    sync: parsed.sync && typeof parsed.sync === 'object' && !Array.isArray(parsed.sync) ? parsed.sync : {},
                    hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
                    data: Array.isArray(parsed.data) ? parsed.data : [],
                };
            }
        }
    } catch (err) {
        console.error('[wordle] Failed to load wordle store:', err.message);
    }
    return empty;
}

function saveWordleStore(store) {
    try {
        fs.mkdirSync(path.dirname(WORDLE_FILE_PATH), { recursive: true });
        fs.writeFileSync(WORDLE_FILE_PATH, JSON.stringify(store, null, 2), 'utf8');
        console.log('[wordle] Wordle store saved successfully');
    } catch (err) {
        console.error('[wordle] Failed to save wordle store:', err.message);
    }
}

function loadWordleData() {
    return loadWordleStore().data;
}

function saveWordleData(entries) {
    const store = loadWordleStore();
    store.data = entries;
    saveWordleStore(store);
}

function loadWordleSync() {
    return loadWordleStore().sync;
}

function saveWordleSync(syncMap) {
    const store = loadWordleStore();
    store.sync = syncMap;
    saveWordleStore(store);
}

function loadWordleHidden() {
    return loadWordleStore().hidden;
}

function saveWordleHidden(hidden) {
    const store = loadWordleStore();
    store.hidden = hidden;
    saveWordleStore(store);
}

function printWordleData(entries) {
    if (!entries || entries.length === 0) {
        return 'No Wordle results recorded yet.';
    }

    const lines = [];
    lines.push('# 📊 Wordle Results');
    lines.push('');

    for (const day of entries) {
        lines.push(`## ${day.date} — ${day.streak} day streak 🔥`);
        for (const entry of day.entries) {
            const users = (entry.userIds || entry.users || []).join(', ');
            lines.push(`- **${entry.guesses}/6**: ${users}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function normalizeId(id) {
    return String(id || '').trim();
}

function computeCurrentStreak(entries, userId) {
    return computeCurrentStreakInfo(entries, userId).streak;
}

function computeCurrentStreakInfo(entries, userId) {
    const target = normalizeId(userId);
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));

    const mostRecent = sorted[0];
    if (!mostRecent) return { streak: 0, startDate: null };

    const playedMostRecent = mostRecent.entries.some((e) =>
        (e.userIds || e.users || []).some((u) => normalizeId(u) === target)
    );
    if (!playedMostRecent) return { streak: 0, startDate: null };

    let streak = 0;
    let expectedDate = null;
    let startDate = null;

    for (const day of sorted) {
        const played = day.entries.some((e) =>
            (e.userIds || e.users || []).some((u) => normalizeId(u) === target)
        );

        if (!played) {
            break;
        }

        if (expectedDate === null) {
            streak = 1;
            startDate = day.date;
            expectedDate = shiftDate(day.date, -1);
        } else if (day.date === expectedDate) {
            streak += 1;
            startDate = day.date;
            expectedDate = shiftDate(day.date, -1);
        } else {
            break;
        }
    }

    return { streak, startDate };
}

function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function computeBestStreak(entries, userId) {
    const target = normalizeId(userId);
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));

    let best = 0;
    let current = 0;
    let prevDate = null;

    for (const day of sorted) {
        const played = day.entries.some((e) =>
            (e.userIds || e.users || []).some((u) => normalizeId(u) === target)
        );
        if (!played) {
            current = 0;
            prevDate = null;
            continue;
        }

        if (prevDate !== null && day.date === shiftDate(prevDate, 1)) {
            current += 1;
        } else {
            current = 1;
        }
        prevDate = day.date;
        if (current > best) best = current;
    }

    return best;
}

function getUserStats(entries, userId) {
    const target = normalizeId(userId);
    const guessCounts = {};
    let daysPlayed = 0;
    let totalGuesses = 0;
    let fails = 0;

    for (const day of entries) {
        for (const entry of day.entries) {
            if ((entry.userIds || entry.users || []).some((u) => normalizeId(u) === target)) {
                daysPlayed += 1;
                if (entry.guesses === 0) {
                    fails += 1;
                } else {
                    totalGuesses += entry.guesses;
                    guessCounts[entry.guesses] = (guessCounts[entry.guesses] || 0) + 1;
                }
            }
        }
    }

    if (daysPlayed === 0) return null;

    const avgGuess = totalGuesses / daysPlayed;
    const guessNumbers = Object.keys(guessCounts).map(Number).sort((a, b) => a - b);
    const bestGuess = guessNumbers[0] || null;
    const worstGuess = guessNumbers[guessNumbers.length - 1] || null;
    const mostCommonGuess = guessNumbers.length
        ? guessNumbers.reduce((a, b) => (guessCounts[b] > guessCounts[a] ? b : a), guessNumbers[0])
        : null;

    const currentStreakInfo = computeCurrentStreakInfo(entries, userId);

    let currentStreakStartDay = null;
    if (currentStreakInfo.startDate) {
        const startDay = entries.find((d) => d.date === currentStreakInfo.startDate);
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

function getAllUserStats(entries) {
    const map = new Map();

    for (const day of entries) {
        for (const entry of day.entries) {
            for (const user of (entry.userIds || entry.users || [])) {
                const key = normalizeId(user);
                if (!map.has(key)) {
                    map.set(key, { userId: user, totalGuesses: 0, daysPlayed: 0 });
                }
                const rec = map.get(key);
                rec.totalGuesses += entry.guesses;
                rec.daysPlayed += 1;
            }
        }
    }

    const G = 4.0;
    const m = 15;

    const k = 0.01;

    const stats = [];
    for (const rec of map.values()) {
        const avgGuess = rec.totalGuesses / rec.daysPlayed;
        const streak = computeCurrentStreak(entries, rec.userId);
        const adjustedScore = ((rec.daysPlayed * avgGuess) + (m * G)) / (rec.daysPlayed + m);
        const finalScore = adjustedScore - (streak * k);
        stats.push({
            userId: rec.userId,
            streak,
            avgGuess,
            adjustedScore,
            finalScore,
            daysPlayed: rec.daysPlayed,
        });
    }

    stats.sort((a, b) => a.finalScore - b.finalScore);
    return stats;
}

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
