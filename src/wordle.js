const { Events, SlashCommandBuilder } = require('discord.js');
const {
    loadWordleData,
    saveWordleData,
    loadWordleSync,
    saveWordleSync,
    loadWordleHidden,
    saveWordleHidden,
    printWordleData,
    getUserStats,
    getAllUserStats,
} = require('../data/wordle-data');

const WORDLE_USER_ID = '1211781489931452447';
const WORDLE_RESULTS_PATTERN = /Here are yesterday's results/i;
const RESULT_LINE_PATTERN = /^\s*(?:!\[[^\]]*\]\([^)]*\)\s*|[\p{Extended_Pictographic}\u200d\ufe0f]+\s*)*([\dXx])\/6\s*:\s*(.+)$/u;
const USER_TOKEN_PATTERN = /<@!?(\d+)>|@((?:(?!\s@|\s<@).)+)/g;

const setupWordleCommand = new SlashCommandBuilder()
    .setName('setupwordle')
    .setDescription('Set the channel where Wordle results are posted (owner only)')
    .addChannelOption((opt) =>
        opt.setName('channel')
           .setDescription('Channel where the Wordle bot posts results')
           .setRequired(true)
    );

const wordleStatsCommand = new SlashCommandBuilder()
    .setName('wordlestats')
    .setDescription('Show Wordle stats. Add a user for detailed stats.')
    .addUserOption((opt) =>
        opt.setName('user')
           .setDescription('User to show detailed stats for (optional)')
           .setRequired(false)
    );

const wordleScanCommand = new SlashCommandBuilder()
    .setName('wordlescan')
    .setDescription('Scan a channel\'s history for past Wordle results and backfill them (owner only)')
    .addChannelOption((opt) =>
        opt.setName('channel')
           .setDescription('Channel to scan (defaults to the configured Wordle channel)')
           .setRequired(false)
    );

const wordleSyncCommand = new SlashCommandBuilder()
    .setName('wordlesync')
    .setDescription('Map a plain-text Wordle name to a user ID (owner only)')
    .addStringOption((opt) =>
        opt.setName('name')
           .setDescription('The plain-text name as it appears in Wordle results (e.g. CeeZee)')
           .setRequired(true)
    )
    .addStringOption((opt) =>
        opt.setName('userid')
           .setDescription('The numeric Discord user ID to map this name to')
           .setRequired(true)
    );

const wordleHideCommand = new SlashCommandBuilder()
    .setName('wordlehide')
    .setDescription('Hide or unhide a user from the Wordle leaderboard (owner only)')
    .addStringOption((opt) =>
        opt.setName('action')
           .setDescription('Whether to hide or unhide the user')
           .setRequired(true)
           .addChoices(
               { name: 'Hide', value: 'hide' },
               { name: 'Unhide', value: 'unhide' }
           )
    )
    .addUserOption((opt) =>
        opt.setName('user')
           .setDescription('The user to hide or unhide (mention)')
           .setRequired(false)
    )
    .addStringOption((opt) =>
        opt.setName('name')
           .setDescription('The plain-text name to hide or unhide (e.g. "Kia - rn sleeping")')
           .setRequired(false)
    );

function extractStreak(content) {
    const match = content.match(/(\d+)\s+day streak/i);
    return match ? parseInt(match[1], 10) : null;
}

function extractUsers(text) {
    const users = [];
    let m;
    USER_TOKEN_PATTERN.lastIndex = 0;
    while ((m = USER_TOKEN_PATTERN.exec(text)) !== null) {
        users.push(m[1] || m[2].trim());
    }
    return users;
}

function parseResultLine(line) {
    const match = line.match(RESULT_LINE_PATTERN);
    if (!match) return null;

    const raw = match[1];
    const guesses = /^[Xx]$/.test(raw) ? 0 : parseInt(raw, 10);
    const users = extractUsers(match[2]);

    if (users.length === 0) return null;

    return { guesses, userIds: users };
}

function previousDayISO(date) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

function parseWordleMessage(content, date) {
    if (!WORDLE_RESULTS_PATTERN.test(content)) return null;

    const streak = extractStreak(content);
    const entries = [];

    const lines = content.split('\n');
    for (const line of lines) {
        const entry = parseResultLine(line);
        if (entry) {
            entries.push(entry);
        }
    }

    if (entries.length === 0) return null;

    return {
        date: date || previousDayISO(new Date()),
        streak,
        entries,
    };
}

function mergeDayEntry(data, dayEntry) {
    const existingIndex = data.findIndex((d) => d.date === dayEntry.date);
    if (existingIndex !== -1) {
        data[existingIndex] = dayEntry;
        console.log(`[wordle] Updated results for ${dayEntry.date}`);
    } else {
        data.push(dayEntry);
        console.log(`[wordle] Saved results for ${dayEntry.date} (${dayEntry.entries.length} entries)`);
    }
    return data;
}

function applySyncToEntry(dayEntry, syncMap) {
    for (const entry of dayEntry.entries) {
        entry.userIds = entry.userIds.map((u) => syncMap[u] || u);
    }
    return dayEntry;
}

function applySyncToData(data, syncMap) {
    let replaced = 0;
    for (const day of data) {
        for (const entry of day.entries) {
            const ids = entry.userIds || entry.users || [];
            const next = ids.map((u) => {
                if (syncMap[u] && syncMap[u] !== u) {
                    replaced += 1;
                    return syncMap[u];
                }
                return u;
            });
            entry.userIds = next;
            delete entry.users;
        }
    }
    return replaced;
}

async function backfillWordleData(channel, maxBatches = 100) {
    let found = 0;
    let before = undefined;
    const data = loadWordleData();
    const syncMap = loadWordleSync();

    for (let i = 0; i < maxBatches; i++) {
        const batch = await channel.messages.fetch({ limit: 100, before, user: WORDLE_USER_ID });
        if (batch.size === 0) break;

        for (const msg of batch.values()) {
            const date = previousDayISO(msg.createdAt);
            const dayEntry = parseWordleMessage(msg.content, date);
            if (!dayEntry) continue;

            applySyncToEntry(dayEntry, syncMap);
            mergeDayEntry(data, dayEntry);
            found += 1;
        }

        const oldest = batch.last();
        if (!oldest) break;
        before = oldest.id;
    }

    if (found > 0) {
        saveWordleData(data);
    }
    return found;
}

function setupWordle(client, memory, saveMemory) {
    client.on(Events.MessageCreate, async (message) => {
        if (message.author.id !== WORDLE_USER_ID) return;

        const channelId = memory.wordle && memory.wordle.channelId;
        if (channelId && message.channel.id !== channelId) return;

        const dayEntry = parseWordleMessage(message.content);
        if (!dayEntry) return;

        applySyncToEntry(dayEntry, loadWordleSync());

        const data = loadWordleData();
        mergeDayEntry(data, dayEntry);
        saveWordleData(data);
    });
}

async function handleWordleInteraction(interaction, memory, saveMemory) {
    const { commandName } = interaction;

    if (commandName === 'setupwordle') {
        const channel = interaction.options.getChannel('channel');
        if (!memory.wordle) memory.wordle = {};
        memory.wordle.channelId = channel.id;
        saveMemory(memory);

        console.log(`[wordle] Channel configured to: ${channel.name} (${channel.id})`);
        return interaction.reply({
            content: `Got it! Wordle results will now be tracked from ${channel}. Use \`/wordlescan\` to backfill past results from the channel history.`,
            flags: 64,
        });
    }

    if (commandName === 'wordlescan') {
        const channel = interaction.options.getChannel('channel')
            || (memory.wordle && memory.wordle.channelId
                ? await interaction.guild.channels.fetch(memory.wordle.channelId)
                : null);

        if (!channel) {
            return interaction.reply({
                content: 'No channel to scan. Provide a `channel` option or set one with `/setupwordle` first.',
                flags: 64,
            });
        }

        await interaction.reply({
            content: `Scanning ${channel} history for past Wordle results...`,
            flags: 64,
        });

        try {
            const found = await backfillWordleData(channel);
            await interaction.followUp({
                content: found > 0
                    ? `Found and saved **${found}** past Wordle result post${found === 1 ? '' : 's'} from the channel history.`
                    : 'No past Wordle result posts were found in the channel history.',
                flags: 64,
            });
        } catch (err) {
            console.error('[wordle] Failed to scan channel history:', err.message);
            await interaction.followUp({
                content: `Failed to scan history: ${err.message}`,
                flags: 64,
            });
        }
        return;
    }

    if (commandName === 'wordlesync') {
        const name = interaction.options.getString('name').trim();
        const userId = interaction.options.getString('userid').trim();

        if (!name) {
            return interaction.reply({
                content: 'Please provide a `name` to map.',
                flags: 64,
            });
        }
        if (!/^\d+$/.test(userId)) {
            return interaction.reply({
                content: '`userid` must be a numeric Discord user ID.',
                flags: 64,
            });
        }

        const syncMap = loadWordleSync();
        syncMap[name] = userId;
        saveWordleSync(syncMap);

        const data = loadWordleData();
        const replaced = applySyncToData(data, syncMap);
        if (replaced > 0) {
            saveWordleData(data);
        }

        console.log(`[wordle] Synced "${name}" -> ${userId} (${replaced} replacements)`);
        return interaction.reply({
            content: `Mapped **${name}** → <@${userId}>. Applied to **${replaced}** existing entr${replaced === 1 ? 'y' : 'ies'} and will apply to future results.`,
            flags: 64,
        });
    }
    if (commandName === 'wordlehide') {
        const target = interaction.options.getUser('user');
        const plainName = interaction.options.getString('name');
        const action = interaction.options.getString('action');

        const userId = target ? target.id : (plainName ? plainName.trim() : null);
        const display = target ? target.username : plainName;

        if (!userId) {
            return interaction.reply({
                content: 'Please provide a `user` mention or a `name` to hide/unhide.',
                flags: 64,
            });
        }

        const hidden = loadWordleHidden();
        const isHidden = hidden.includes(userId);

        if (action === 'hide') {
            if (!isHidden) {
                hidden.push(userId);
                saveWordleHidden(hidden);
            }
            return interaction.reply({
                content: `**${display}** is now hidden from the Wordle leaderboard.`,
                flags: 64,
            });
        }

        if (action === 'unhide') {
            if (isHidden) {
                saveWordleHidden(hidden.filter((id) => id !== userId));
            }
            return interaction.reply({
                content: `**${display}** is now visible on the Wordle leaderboard.`,
                flags: 64,
            });
        }

        return interaction.reply({
            content: 'Unknown action. Use `hide` or `unhide`.',
            flags: 64,
        });
    }
    if (commandName === 'wordlestats') {
        const data = loadWordleData();
        const targetUser = interaction.options.getUser('user');

        console.log(
            `[wordle] ${interaction.user.tag} (${interaction.user.id}) used /wordlestats` +
            (targetUser ? ` for ${targetUser.tag} (${targetUser.id})` : '')
        );

        await interaction.deferReply({ flags: 64 });

        const resolveName = (userId) => resolveUsername(interaction, userId);

        if (targetUser) {
            const stats = getUserStats(data, targetUser.id);
            if (!stats) {
                return interaction.editReply({
                    content: `No Wordle data found for **${targetUser.username}**.`,
                });
            }
            return interaction.editReply({
                content: await formatUserStats(stats, resolveName),
            });
        }

        const allStats = getAllUserStats(data);
        if (allStats.length === 0) {
            return interaction.editReply({
                content: 'No Wordle results recorded yet.',
            });
        }
        return interaction.editReply({
            content: await formatAllStats(allStats, resolveName),
        });
    }

    return null;
}

async function resolveUsername(interaction, userId) {
    try {
        if (interaction.guild) {
            const member = await interaction.guild.members.fetch(userId);
            return member.displayName || member.user.username;
        }
    } catch {}
    try {
        const user = await interaction.client.users.fetch(userId);
        return user.username;
    } catch {
        return userId;
    }
}

const ANSI = {
    reset: '\u001b[0m',
    bold: '\u001b[1m',
    red: '\u001b[31m',
    green: '\u001b[32m',
    yellow: '\u001b[33m',
    blue: '\u001b[34m',
    magenta: '\u001b[35m',
    cyan: '\u001b[36m',
    white: '\u001b[37m',
    brightRed: '\u001b[91m',
    brightGreen: '\u001b[92m',
    brightYellow: '\u001b[93m',
    brightBlue: '\u001b[94m',
    brightMagenta: '\u001b[95m',
    brightCyan: '\u001b[96m',
    brightWhite: '\u001b[97m',
    bgBlack: '\u001b[40m',
    bgRed: '\u001b[41m',
    bgGreen: '\u001b[42m',
    bgYellow: '\u001b[43m',
    bgBlue: '\u001b[44m',
    bgMagenta: '\u001b[45m',
    bgCyan: '\u001b[46m',
    bgWhite: '\u001b[47m',
};

function avgColor(avg) {
    if (avg <= 3.5) return ANSI.brightGreen;
    if (avg <= 4.5) return ANSI.brightYellow;
    if (avg <= 5.0) return ANSI.brightMagenta;
    return ANSI.brightRed;
}

function displayWidth(str) {
    let width = 0;
    for (const ch of String(str)) {
        const code = ch.codePointAt(0);
        if (
            (code >= 0x1100 && code <= 0x115f) ||
            (code >= 0x2e80 && code <= 0xa4cf) ||
            (code >= 0xac00 && code <= 0xd7a3) ||
            (code >= 0xf900 && code <= 0xfaff) ||
            (code >= 0xfe30 && code <= 0xfe4f) ||
            (code >= 0xff00 && code <= 0xff60) ||
            (code >= 0xffe0 && code <= 0xffe6) ||
            (code >= 0x1f300 && code <= 0x1faff) ||
            (code >= 0x20000 && code <= 0x3fffd)
        ) {
            width += 2;
        } else {
            width += 1;
        }
    }
    return width;
}

function padDisplay(str, width) {
    const pad = width - displayWidth(str);
    return pad > 0 ? str + ' '.repeat(pad) : str;
}

async function formatAllStats(allStats, resolveName) {
    const hidden = loadWordleHidden();
    const rows = [];
    for (const s of allStats) {
        if (hidden.includes(s.userId)) continue;
        rows.push({
            ...s,
            name: await resolveName(s.userId),
        });
    }

    const nameWidth = Math.max(8, ...rows.map((r) => displayWidth(r.name)));
    const lines = [];
    const INNER = 62;

    const top = `${ANSI.bold}${ANSI.brightCyan}┌${'─'.repeat(INNER)}┐${ANSI.reset}`;
    const mid = `${ANSI.bold}${ANSI.brightCyan}├${'─'.repeat(INNER)}┤${ANSI.reset}`;
    const bot = `${ANSI.bold}${ANSI.brightCyan}└${'─'.repeat(INNER)}┘${ANSI.reset}`;

    lines.push(top);
    const title = 'WORDLE LEADERBOARD';
    lines.push(`  ${ANSI.bold}${ANSI.brightYellow}${title}${ANSI.reset}`);
    lines.push(mid);

    const header = ` ${ANSI.bold}${ANSI.white}#${ANSI.reset}  ${ANSI.bold}${ANSI.white}${padDisplay('Player', nameWidth)}${ANSI.reset}  ${ANSI.bold}${ANSI.white}Streak${ANSI.reset}  ${ANSI.bold}${ANSI.white}Adj${ANSI.reset}  ${ANSI.bold}${ANSI.white}Days${ANSI.reset}`;
    lines.push(header);

    const medalColors = [ANSI.brightYellow, ANSI.brightWhite, ANSI.brightMagenta];
    const medalLabels = ['🥇', '🥈', '🥉'];

    const MAX_ROWS = 10;
    const shown = rows.slice(0, MAX_ROWS);

    shown.forEach((r, i) => {
        const rank = i + 1;
        const medal = i < 3 ? `${medalLabels[i]} ` : `${String(rank).padStart(2)} `;
        const nameColor = i < 3 ? medalColors[i] : ANSI.white;
        const name = `${medal}${nameColor}${padDisplay(r.name, nameWidth)}${ANSI.reset}`;
        const streak = `${ANSI.brightCyan}${String(r.streak).padStart(6)}${ANSI.reset}`;
        const adj = `${avgColor(r.finalScore)}${r.finalScore.toFixed(2).padStart(5)}${ANSI.reset}`;
        const days = `${ANSI.brightBlue}${String(r.daysPlayed).padStart(4)}${ANSI.reset}`;
        lines.push(` ${name}  ${streak}  ${adj}  ${days}`);
    });

    if (rows.length > MAX_ROWS) {
        const more = rows.length - MAX_ROWS;
        lines.push(`  ${ANSI.bold}${ANSI.brightYellow}... and ${more} more${ANSI.reset}`);
    }

    lines.push(`  ${ANSI.bold}${ANSI.brightBlue}ADJ = avg pulled toward 4.0, minus streak bonus${ANSI.reset}`);
    lines.push(bot);

    return '```ansi\n' + lines.join('\n') + '\n```';
}

async function formatUserStats(stats, resolveName) {
    const name = await resolveName(stats.userId);
    const lines = [];
    const INNER = 46;

    const top = `${ANSI.bold}${ANSI.brightCyan}┌${'─'.repeat(INNER)}┐${ANSI.reset}`;
    const mid = `${ANSI.bold}${ANSI.brightCyan}├${'─'.repeat(INNER)}┤${ANSI.reset}`;
    const bot = `${ANSI.bold}${ANSI.brightCyan}└${'─'.repeat(INNER)}┘${ANSI.reset}`;

    lines.push(top);
    const title = `WORDLE STATS - ${name}`;
    lines.push(`  ${ANSI.bold}${ANSI.brightYellow}${title}${ANSI.reset}`);
    lines.push(mid);

    const row = (label, value, color = ANSI.white) =>
        `  ${ANSI.bold}${ANSI.white}${label.padEnd(18)}${ANSI.reset} ${color}${value}${ANSI.reset}`;

    lines.push(row('Days played', String(stats.daysPlayed), ANSI.brightBlue));
    lines.push(row('Average guesses', stats.avgGuess.toFixed(2), avgColor(stats.avgGuess)));
    lines.push(row('Current streak', `${stats.currentStreak}  `, ANSI.brightGreen));
    if (stats.currentStreakStartDay) {
        lines.push(row('Streak started', `Day ${stats.currentStreakStartDay}`, ANSI.brightGreen));
    }
    lines.push(row('Best streak', String(stats.bestStreak), ANSI.brightCyan));
    lines.push(row('Best guess', `${stats.bestGuess}/6`, ANSI.brightGreen));
    lines.push(row('Worst guess', `${stats.worstGuess}/6`, ANSI.brightRed));
    lines.push(row('Most common', `${stats.mostCommonGuess}/6`, ANSI.brightYellow));
    lines.push(row('Failed (X/6)', String(stats.fails || 0), ANSI.brightRed));

    lines.push(mid);
    lines.push(`  ${ANSI.bold}${ANSI.white}Guess distribution${ANSI.reset}`);

    const maxCount = Math.max(1, ...Object.values(stats.guessCounts));
    for (let g = 1; g <= 6; g++) {
        const count = stats.guessCounts[g] || 0;
        const barLen = Math.round((count / maxCount) * 20);
        const bar = '█'.repeat(barLen);
        const barColor = g <= 2 ? ANSI.brightGreen : g <= 4 ? ANSI.brightYellow : ANSI.brightRed;
        const countStr = String(count).padStart(3);
        lines.push(
            `  ${ANSI.bold}${ANSI.white}${g}/6${ANSI.reset} ${barColor}${bar.padEnd(20)}${ANSI.reset} ${ANSI.brightBlue}${countStr}${ANSI.reset}`
        );
    }

    lines.push(bot);

    return '```ansi\n' + lines.join('\n') + '\n```';
}

module.exports = {
    setupWordle,
    handleWordleInteraction,
    setupWordleCommand,
    wordleStatsCommand,
    wordleScanCommand,
    wordleSyncCommand,
    wordleHideCommand,
    parseWordleMessage,
    backfillWordleData,
    mergeDayEntry,
    applySyncToEntry,
    applySyncToData,
    printWordleData,
    WORDLE_USER_ID,
};
