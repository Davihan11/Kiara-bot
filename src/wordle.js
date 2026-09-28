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

const WORDLE_USER_ID = '1211781489931452447'; //the Discord user ID of the Wordle bot
const WORDLE_RESULTS_PATTERN = /Here are yesterday's results/i; //what a Wordle results post starts with
const RESULT_LINE_PATTERN = /^\s*(?:!\[[^\]]*\]\([^)]*\)\s*|[\p{Extended_Pictographic}\u200d\ufe0f]+\s*)*([\dXx])\/6\s*:\s*(.+)$/u; //matches lines like "4/6: @user1 @user2"
const USER_TOKEN_PATTERN = /<@!?(\d+)>|@((?:(?!\s@|\s<@).)+)/g; //matches both real mentions (<@123>) and plain names (@Bob)

// /setupwordle - pick the channel where the Wordle bot posts results
const setupWordleCommand = new SlashCommandBuilder()
    .setName('setupwordle')
    .setDescription('Set the channel where Wordle results are posted (owner only)')
    .addChannelOption((opt) =>
        opt.setName('channel')
           .setDescription('Channel where the Wordle bot posts results')
           .setRequired(true)
    );

// /wordlestats - show the leaderboard, or one player's stats if you tag them
const wordleStatsCommand = new SlashCommandBuilder()
    .setName('wordlestats')
    .setDescription('Show Wordle stats. Add a user for detailed stats.')
    .addUserOption((opt) =>
        opt.setName('user')
           .setDescription('User to show detailed stats for (optional)')
           .setRequired(false)
    );

// /wordlescan - dig through a channel's history for old Wordle results
const wordleScanCommand = new SlashCommandBuilder()
    .setName('wordlescan')
    .setDescription('Scan a channel\'s history for past Wordle results and backfill them (owner only)')
    .addChannelOption((opt) =>
        opt.setName('channel')
           .setDescription('Channel to scan (defaults to the configured Wordle channel)')
           .setRequired(false)
    );

// /wordlesync - map a plain-text name to a real user ID
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

// /wordlehide - hide (or unhide) someone from the leaderboard
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

//grabs the "12 day streak" number out of the bot's message (returns null if there isn't one)
function extractStreak(content) {
    const match = content.match(/(\d+)\s+day streak/i);
    return match ? parseInt(match[1], 10) : null;
}

//gets all player names from a result line
//can be a real mention (<@123>) or a plain name (@Bob) if the player isn't in the server
function extractUsers(text) {
    const users = [];
    let m;
    USER_TOKEN_PATTERN.lastIndex = 0; //regex is global, so reset it before reusing
    while ((m = USER_TOKEN_PATTERN.exec(text)) !== null) {
        users.push(m[1] || m[2].trim()); //m[1] = the ID from a real mention, m[2] = the plain name
    }
    return users;
}

//parses one result line, like "4/6: @user1 @user2"
//"X/6" means they failed, we store that as 0 guesses
function parseResultLine(line) {
    const match = line.match(RESULT_LINE_PATTERN); //does it even look like a result line?
    if (!match) return null;

    const raw = match[1]; //the guess part, either a number or "X"
    const guesses = /^[Xx]$/.test(raw) ? 0 : parseInt(raw, 10); //"X" -> 0 (failed)
    const users = extractUsers(match[2]); //everyone who got this score

    if (users.length === 0) return null; //a score with no players is useless
    return { guesses, userIds: users };
}

//gets yesterday's date - because results are posted TODAY, but they belong to YESTERDAY's game
function previousDayISO(date) {
    const d = new Date(date); //work on a copy so we don't touch the original
    d.setUTCDate(d.getUTCDate() - 1); //go back one day
    return d.toISOString().slice(0, 10); //grab just the "YYYY-MM-DD" part
}

//turns a Wordle bot message into a day entry: { date, streak, entries }
//returns null if it's not a results post, or has no usable result lines
function parseWordleMessage(content, date) {
    if (!WORDLE_RESULTS_PATTERN.test(content)) { //not a results post
        console.log('[wordle][debug] Content does not match results pattern — not a results message');
        return null;
    }

    const streak = extractStreak(content); //the group streak number
    console.log(`[wordle][debug] Results pattern matched. Extracted streak: ${streak}`);
    const entries = [];

    //split into individual lines and try to parse each one
    const lines = content.split('\n');
    console.log(`[wordle][debug] Scanning ${lines.length} line(s) for result entries`);
    for (const line of lines) {
        const entry = parseResultLine(line);
        if (entry) { //the line parsed fine -> keep it
            console.log(`[wordle][debug]   line matched: "${line.trim()}" -> guesses=${entry.guesses}, users=[${entry.userIds.join(', ')}]`);
            entries.push(entry);
        }
    }

    //it said "results" but we found nothing usable inside
    if (entries.length === 0) {
        console.log('[wordle][debug] Results message contained no parseable result lines — skipping');
        return null;
    }

    //use the date passed in, otherwise default to "yesterday" (live messages)
    const resolvedDate = date || previousDayISO(new Date());
    console.log(`[wordle][debug] Resolved date: ${resolvedDate} (${date ? `explicitly provided: ${date}` : `computed from now: ${new Date().toISOString()}`})`);

    return {
        date: resolvedDate,
        streak,
        entries,
    };
}

//saves a day entry into the data
//if the same date is already there, the new one overwrites the old one
function mergeDayEntry(data, dayEntry) {
    const existingIndex = data.findIndex((d) => d.date === dayEntry.date); //do we already have this day?
    if (existingIndex !== -1) {
        console.log(`[wordle][debug] Date ${dayEntry.date} already exists at index ${existingIndex} — overwriting (${data[existingIndex].entries.length} old entries -> ${dayEntry.entries.length} new entries)`);
        data[existingIndex] = dayEntry; //same day again -> replace it
        console.log(`[wordle] Updated results for ${dayEntry.date}`);
    } else {
        console.log(`[wordle][debug] Date ${dayEntry.date} is new — appending to store`);
        data.push(dayEntry); //brand new day -> just add it
        console.log(`[wordle] Saved results for ${dayEntry.date} (${dayEntry.entries.length} entries)`);
    }
    return data;
}

//swaps plain names for real user IDs in one day entry, using the sync map
function applySyncToEntry(dayEntry, syncMap) {
    for (const entry of dayEntry.entries) { //go over every result of this day
        entry.userIds = entry.userIds.map((u) => { //and every player in it
            if (syncMap[u]) { //we have a mapping for this name -> swap it for the real ID
                console.log(`[wordle][debug] Sync applied: "${u}" -> ${syncMap[u]}`);
                return syncMap[u];
            }
            return u; //no mapping -> keep it as is
        });
    }
    return dayEntry;
}

//same idea as applySyncToEntry, but for the WHOLE saved history
//used when /wordlesync adds a new name mapping, so old entries get fixed too
//returns how many names got replaced
function applySyncToData(data, syncMap) {
    let replaced = 0;
    for (const day of data) { //every day...
        for (const entry of day.entries) { //...every result...
            const ids = entry.userIds || entry.users || []; //old entries may still use the "users" field
            const next = ids.map((u) => {
                if (syncMap[u] && syncMap[u] !== u) { //there's a mapping AND it's actually different
                    replaced += 1;
                    return syncMap[u]; //swap the name for the real ID
                }
                return u; //no mapping -> keep it
            });
            entry.userIds = next;
            delete entry.users; //clean up the old field name, we use userIds now
        }
    }
    return replaced;
}

//scans a channel's history for old Wordle posts and saves them
//used by /wordlescan to recover results from before the bot was tracking them
//returns how many results posts were found
async function backfillWordleData(channel, maxBatches = 100) {
    let found = 0; //how many results posts we found
    let before = undefined; //fetch messages "before this ID" on the next batch (walking backwards)
    const data = loadWordleData(); //what we already have saved
    const syncMap = loadWordleSync(); //existing name -> ID mappings

    console.log(`[wordle][debug] Backfill starting in channel ${channel.id}. Existing days: ${data.length}, sync mappings: ${Object.keys(syncMap).length}`);

    for (let i = 0; i < maxBatches; i++) { //fetch in batches of 100, maxBatches is a safety cap
        const batch = await channel.messages.fetch({ limit: 100, before, user: WORDLE_USER_ID }); //only messages from the Wordle bot
        console.log(`[wordle][debug] Batch ${i + 1}: fetched ${batch.size} message(s)${before ? ` before ${before}` : ''}`);
        if (batch.size === 0) break; //reached the beginning of the channel -> stop

        for (const msg of batch.values()) { //go over every message in this batch
            const date = previousDayISO(msg.createdAt); //posted today = yesterday's game
            console.log(`[wordle][debug] Scanning message ${msg.id} from ${msg.createdAt.toISOString()} -> assigned date ${date}`);
            const dayEntry = parseWordleMessage(msg.content, date);
            if (!dayEntry) continue; //not a results post -> skip

            applySyncToEntry(dayEntry, syncMap); //apply name mappings
            mergeDayEntry(data, dayEntry); //and save it
            found += 1;
        }

        const oldest = batch.last(); //the oldest message in this batch
        if (!oldest) break; //nothing in the batch -> nothing more to fetch
        before = oldest.id; //the next batch fetches messages older than this one
    }

    console.log(`[wordle][debug] Backfill finished. ${found} result post(s) found`);
    if (found > 0) { //only write to disk if we actually found something
        saveWordleData(data);
        console.log(`[wordle][debug] Backfill save complete. Store now has ${data.length} day(s)`);
    }
    return found;
}

//starts listening for the Wordle bot's result posts
//when one shows up in the configured channel, parse it and save it
function setupWordle(client, memory, saveMemory) {
    client.on(Events.MessageCreate, async (message) => {
        if (message.author.id !== WORDLE_USER_ID) return; //only care about the Wordle bot's messages

        console.log(`[wordle][debug] Message from Wordle bot in channel ${message.channel.id} at ${message.createdAt.toISOString()}`);

        const channelId = memory.wordle && memory.wordle.channelId; //the configured channel (saved by /setupwordle)
        if (channelId && message.channel.id !== channelId) { //wrong channel -> ignore it
            console.log(`[wordle][debug] Ignored: channel ${message.channel.id} does not match configured channel ${channelId}`);
            return;
        }

        console.log(`[wordle][debug] Raw content (${message.content.length} chars):\n${message.content}`);

        const dayEntry = parseWordleMessage(message.content);
        if (!dayEntry) {
            console.log('[wordle][debug] Message did not parse as Wordle results — skipping');
            return;
        }

        console.log(`[wordle][debug] Parsed: date=${dayEntry.date}, streak=${dayEntry.streak}, entries=${dayEntry.entries.length}`);
        for (const entry of dayEntry.entries) {
            console.log(`[wordle][debug]   entry: guesses=${entry.guesses}, users=[${entry.userIds.join(', ')}]`);
        }

        const syncMap = loadWordleSync(); //existing name -> ID mappings
        console.log(`[wordle][debug] Sync map (${Object.keys(syncMap).length} mappings): ${JSON.stringify(syncMap)}`);
        applySyncToEntry(dayEntry, syncMap); //apply them

        const data = loadWordleData(); //what we have so far
        console.log(`[wordle][debug] Loaded ${data.length} existing day(s). Dates: ${data.map((d) => d.date).join(', ') || '(none)'}`);
        mergeDayEntry(data, dayEntry); //add or update the day
        saveWordleData(data); //write to disk
        console.log(`[wordle][debug] Save complete. Store now has ${data.length} day(s)`);
    });
}

//handles all the /wordle slash commands (setupwordle, wordlescan, wordlesync, wordlehide, wordlestats)
//returns null if the command isn't one of ours
async function handleWordleInteraction(interaction, memory, saveMemory) {
    const { commandName } = interaction;

    if (commandName === 'setupwordle') { //save which channel to watch
        const channel = interaction.options.getChannel('channel');
        if (!memory.wordle) memory.wordle = {}; //create the wordle section if it doesn't exist yet
        memory.wordle.channelId = channel.id;
        saveMemory(memory);

        console.log(`[wordle] Channel configured to: ${channel.name} (${channel.id})`);
        return interaction.reply({
            content: `Got it! Wordle results will now be tracked from ${channel}. Use \`/wordlescan\` to backfill past results from the channel history.`,
            flags: 64, //ephemeral reply, only the user sees it (message flags are the modern way, "ephemeral: true" is the outdated way)
        });
    }

    if (commandName === 'wordlescan') { //scan channel history for old results
        const channel = interaction.options.getChannel('channel') //channel given in the command...
            || (memory.wordle && memory.wordle.channelId  //...or fall back to the saved one
                ? await interaction.guild.channels.fetch(memory.wordle.channelId)
                : null);

        if (!channel) { //neither the command nor memory gave us a channel to scan
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
            const found = await backfillWordleData(channel); //do the actual scan
            await interaction.followUp({
                content: found > 0 //tell them what we found
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

    if (commandName === 'wordlesync') { //map a plain name to a real user ID
        const name = interaction.options.getString('name').trim(); //the name like "CeeZee"
        const userId = interaction.options.getString('userid').trim(); //their real Discord ID

        if (!name) {
            return interaction.reply({
                content: 'Please provide a `name` to map.',
                flags: 64,
            });
        }
        if (!/^\d+$/.test(userId)) { //Discord IDs are just numbers
            return interaction.reply({
                content: '`userid` must be a numeric Discord user ID.',
                flags: 64,
            });
        }

        const syncMap = loadWordleSync();
        syncMap[name] = userId; //add the new mapping
        saveWordleSync(syncMap);

        const data = loadWordleData();
        const replaced = applySyncToData(data, syncMap); //also fix all the old entries that used this name
        if (replaced > 0) {
            saveWordleData(data); //only write if we actually changed something
        }

        console.log(`[wordle] Synced "${name}" -> ${userId} (${replaced} replacements)`);
        return interaction.reply({
            content: `Mapped **${name}** → <@${userId}>. Applied to **${replaced}** existing entr${replaced === 1 ? 'y' : 'ies'} and will apply to future results.`,
            flags: 64,
        });
    }
    if (commandName === 'wordlehide') { //hide/unhide someone from the leaderboard
        const target = interaction.options.getUser('user'); //either a mention...
        const plainName = interaction.options.getString('name'); //...or a plain name
        const action = interaction.options.getString('action');

        const userId = target ? target.id : (plainName ? plainName.trim() : null); //one of the two must exist
        const display = target ? target.username : plainName; //what to call them in the reply

        if (!userId) {
            return interaction.reply({
                content: 'Please provide a `user` mention or a `name` to hide/unhide.',
                flags: 64,
            });
        }

        const hidden = loadWordleHidden(); //current hidden list
        const isHidden = hidden.includes(userId);

        if (action === 'hide') {
            if (!isHidden) { //only add if they're not already hidden
                hidden.push(userId);
                saveWordleHidden(hidden);
            }
            return interaction.reply({
                content: `**${display}** is now hidden from the Wordle leaderboard.`,
                flags: 64,
            });
        }

        if (action === 'unhide') { //remove them from the hidden list
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
    if (commandName === 'wordlestats') { //show the leaderboard or one player's stats
        const data = loadWordleData();
        const targetUser = interaction.options.getUser('user'); //tagged user, if any

        console.log(
            `[wordle] ${interaction.user.tag} (${interaction.user.id}) used /wordlestats` +
            (targetUser ? ` for ${targetUser.tag} (${targetUser.id})` : '')
        );

        await interaction.deferReply({ flags: 64 }); //thinking... this buys time so the reply doesn't time out

        const resolveName = (userId) => resolveUsername(interaction, userId); //short helper to turn an ID into a name

        if (targetUser) { //a specific player's stats card
            const stats = getUserStats(data, targetUser.id);
            if (!stats) { //they never played
                return interaction.editReply({
                    content: `No Wordle data found for **${targetUser.username}**.`,
                });
            }
            return interaction.editReply({
                content: await formatUserStats(stats, resolveName),
            });
        }

        const allStats = getAllUserStats(data); //no user given -> the full leaderboard
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

//turns a user ID into a readable name (server nickname first, then username)
//falls back to the raw ID if we can't find them (left the server, etc)
async function resolveUsername(interaction, userId) {
    try {
        if (interaction.guild) { //try the server member first (nickname beats username)
            const member = await interaction.guild.members.fetch(userId);
            return member.displayName || member.user.username;
        }
    } catch {}
    try {
        const user = await interaction.client.users.fetch(userId); //no server context -> just fetch the user
        return user.username;
    } catch {
        return userId; //couldn't find them at all -> show the raw ID
    }
}

const ANSI = { //ANSI escape codes - the stuff that makes terminal text colored (used inside "ansi" code blocks on Discord)
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

//picks a color for an average score: green = good, red = bad
function avgColor(avg) {
    if (avg <= 3.5) return ANSI.brightGreen; //good
    if (avg <= 4.5) return ANSI.brightYellow; //okay
    if (avg <= 5.0) return ANSI.brightMagenta; //meh
    return ANSI.brightRed;
}

//counts how many columns a string takes up in a terminal
//emojis and CJK characters are 2 columns wide, everything else is 1
//we need this so the leaderboard columns line up nicely
function displayWidth(str) {
    let width = 0;
    for (const ch of String(str)) { //go over every character
        const code = ch.codePointAt(0); //its position in the Unicode table
        if ( ( //these ranges are the "wide" characters (CJK + emoji)
            (code >= 0x1100 && code <= 0x115f) ||
            (code >= 0x2e80 && code <= 0xa4cf) ||
            (code >= 0xac00 && code <= 0xd7a3) ||
            (code >= 0xf900 && code <= 0xfaff) ||
            (code >= 0xfe30 && code <= 0xfe4f) ||
            (code >= 0xff00 && code <= 0xff60) ||
            (code >= 0xffe0 && code <= 0xffe6) ||
            (code >= 0x1f300 && code <= 0x1faff) ||
            (code >= 0x20000 && code <= 0x3fffd)
        )) {
            width += 2;
        } else {
            width += 1;
        }
    }
    return width;
}

//adds spaces to the end of a string until it reaches the wanted width
//uses displayWidth so emojis don't break the alignment
function padDisplay(str, width) {
    const pad = width - displayWidth(str); //how many spaces we still need
    return pad > 0 ? str + ' '.repeat(pad) : str;
}

//builds the /wordlestats leaderboard: a boxed, colored table of the top 10 players
//(rank, name, streak, adjusted score, days played)
//hidden users are skipped - wrapped in an "ansi" code block so Discord shows the colors
async function formatAllStats(allStats, resolveName) {
    const hidden = loadWordleHidden();
    const rows = [];
    for (const s of allStats) {
        if (hidden.includes(s.userId)) continue; //skip hidden users
        rows.push({
            ...s, //keep all the stats...
            name: await resolveName(s.userId), //...plus the player's name
        });
    }

    const nameWidth = Math.max(8, ...rows.map((r) => displayWidth(r.name))); //name column: wide enough for the longest name, min 8
    const lines = [];
    const INNER = 62; //inner width of the box

    const top = `${ANSI.bold}${ANSI.brightCyan}┌${'─'.repeat(INNER)}┐${ANSI.reset}`; //top border
    const mid = `${ANSI.bold}${ANSI.brightCyan}├${'─'.repeat(INNER)}┤${ANSI.reset}`; //middle separator
    const bot = `${ANSI.bold}${ANSI.brightCyan}└${'─'.repeat(INNER)}┘${ANSI.reset}`; //bottom border

    lines.push(top);
    const title = 'WORDLE LEADERBOARD';
    lines.push(`  ${ANSI.bold}${ANSI.brightYellow}${title}${ANSI.reset}`);
    lines.push(mid);

    const header = ` ${ANSI.bold}${ANSI.white}#${ANSI.reset}  ${ANSI.bold}${ANSI.white}${padDisplay('Player', nameWidth)}${ANSI.reset}  ${ANSI.bold}${ANSI.white}Streak${ANSI.reset}  ${ANSI.bold}${ANSI.white}Adj${ANSI.reset}  ${ANSI.bold}${ANSI.white}Days${ANSI.reset}`; //column titles
    lines.push(header);

    const medalColors = [ANSI.brightYellow, ANSI.brightWhite, ANSI.brightMagenta]; //gold, silver, bronze
    const medalLabels = ['🥇', '🥈', '🥉'];

    const MAX_ROWS = 10; //only show the top 10
    const shown = rows.slice(0, MAX_ROWS);

    shown.forEach((r, i) => { //build one line per player
        const rank = i + 1; //1-based rank
        const medal = i < 3 ? `${medalLabels[i]} ` : `${String(rank).padStart(2)} `; //top 3 get medals, the rest get numbers
        const nameColor = i < 3 ? medalColors[i] : ANSI.white; //top 3 names get medal colors
        const name = `${medal}${nameColor}${padDisplay(r.name, nameWidth)}${ANSI.reset}`;
        const streak = `${ANSI.brightCyan}${String(r.streak).padStart(6)}${ANSI.reset}`;
        const adj = `${avgColor(r.finalScore)}${r.finalScore.toFixed(2).padStart(5)}${ANSI.reset}`;
        const days = `${ANSI.brightBlue}${String(r.daysPlayed).padStart(4)}${ANSI.reset}`;
        lines.push(` ${name}  ${streak}  ${adj}  ${days}`);
    });

    if (rows.length > MAX_ROWS) { //more players than we can show -> mention it
        const more = rows.length - MAX_ROWS;
        lines.push(`  ${ANSI.bold}${ANSI.brightYellow}... and ${more} more${ANSI.reset}`);
    }

    lines.push(`  ${ANSI.bold}${ANSI.brightBlue}ADJ = avg pulled toward 4.0, minus streak bonus${ANSI.reset}`); //explain the ADJ column
    lines.push(bot);

    return '```ansi\n' + lines.join('\n') + '\n```'; //wrap in an ansi code block so Discord renders the colors
}

//builds the /wordlestats @user card: a boxed, colored summary of one player
//(days played, averages, streaks, best/worst, guess distribution bars)
//wrapped in an "ansi" code block so Discord shows the colors
async function formatUserStats(stats, resolveName) {
    const name = await resolveName(stats.userId);
    const lines = [];
    const INNER = 46; //inner width of the box (narrower than the leaderboard)

    const top = `${ANSI.bold}${ANSI.brightCyan}┌${'─'.repeat(INNER)}┐${ANSI.reset}`; //top border
    const mid = `${ANSI.bold}${ANSI.brightCyan}├${'─'.repeat(INNER)}┤${ANSI.reset}`; //middle separator
    const bot = `${ANSI.bold}${ANSI.brightCyan}└${'─'.repeat(INNER)}┘${ANSI.reset}`; //bottom border

    lines.push(top);
    const title = `WORDLE STATS - ${name}`;
    lines.push(`  ${ANSI.bold}${ANSI.brightYellow}${title}${ANSI.reset}`);
    lines.push(mid);

    const row = (label, value, color = ANSI.white) => //one "label: value" line, nicely aligned
        `  ${ANSI.bold}${ANSI.white}${label.padEnd(18)}${ANSI.reset} ${color}${value}${ANSI.reset}`;

    lines.push(row('Days played', String(stats.daysPlayed), ANSI.brightBlue));
    lines.push(row('Average guesses', stats.avgGuess.toFixed(2), avgColor(stats.avgGuess)));
    lines.push(row('Current streak', `${stats.currentStreak}  `, ANSI.brightGreen));
    if (stats.currentStreakStartDay) { //only if we know when their streak started
        lines.push(row('Streak started', `Day ${stats.currentStreakStartDay}`, ANSI.brightGreen));
    }
    lines.push(row('Best streak', String(stats.bestStreak), ANSI.brightCyan));
    lines.push(row('Best guess', `${stats.bestGuess}/6`, ANSI.brightGreen));
    lines.push(row('Worst guess', `${stats.worstGuess}/6`, ANSI.brightRed));
    lines.push(row('Most common', `${stats.mostCommonGuess}/6`, ANSI.brightYellow));
    lines.push(row('Failed (X/6)', String(stats.fails || 0), ANSI.brightRed));

    lines.push(mid); //separator before the chart
    lines.push(`  ${ANSI.bold}${ANSI.white}Guess distribution${ANSI.reset}`);

    const maxCount = Math.max(1, ...Object.values(stats.guessCounts)); //the tallest bar (min 1 so we never divide by 0)
    for (let g = 1; g <= 6; g++) { //one bar per guess number, 1 to 6
        const count = stats.guessCounts[g] || 0;
        const barLen = Math.round((count / maxCount) * 20); //scale the bar relative to the tallest one (max 20 chars)
        const bar = '█'.repeat(barLen);
        const barColor = g <= 2 ? ANSI.brightGreen : g <= 4 ? ANSI.brightYellow : ANSI.brightRed; //green = few guesses, red = many
        const countStr = String(count).padStart(3);
        lines.push(
            `  ${ANSI.bold}${ANSI.white}${g}/6${ANSI.reset} ${barColor}${bar.padEnd(20)}${ANSI.reset} ${ANSI.brightBlue}${countStr}${ANSI.reset}`
        );
    }

    lines.push(bot);

    return '```ansi\n' + lines.join('\n') + '\n```'; //wrap in an ansi code block so Discord renders the colors
}

//export everything so index.js can use it
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
