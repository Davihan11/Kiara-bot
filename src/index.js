//imports and setup - this is the "main" file that gets everything running

require('dotenv').config({ path: './.env' }); //load the .env file so we can use the secrets inside it
const { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Partials, ChannelType, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js'); //everything for talking to Discord
const cron = require('node-cron'); //for scheduled posts (foxes, cats, QOTD...)
const axios = require('axios'); //for making web requests
const fs = require('fs'); //for reading/writing files
const path = require('path'); //for building file paths
const { getRandomIcebreaker, getTotalIcebreakers } = require('../data/questions');
const { setupWordle, handleWordleInteraction, setupWordleCommand, wordleStatsCommand, wordleScanCommand, wordleSyncCommand, wordleHideCommand } = require('./wordle');

//const = a value you can't reassign (these come from .env, cause they're secrets)
const {
    DISCORD_TOKEN: token,
    UNSPLASH_ACCESS_KEY: unsplashKey,
    OWNER_IDS: ownerIds,
    QOTD_API_AUTH,
    SERVER_ID,
    QOTD_ROLE_ID,
    SPECIAL_USER_IDS,
    BOT_EMAIL,
    QOTD_FEEDBACK_USER_ID,
    FOX_CHANNEL_ID,
    CAT_CHANNEL_ID,
    QOTD_CHANNEL_ID,
    QUOTE_CHANNEL_ID,
    EMOTE_BOY,
    EMOTE_GIRL
} = process.env;

//the list of servers the bot is allowed to be in (comma separated in .env)
const serverIds = SERVER_ID ? SERVER_ID.split(',').map(id => id.trim()) : [];

//where we save the bot's settings and the quote cache
const MEMORY_FILE_PATH = path.join(__dirname, '..', 'data', 'memory.json');
const QUOTE_CACHE_FILE_PATH = path.join(__dirname, '..', 'data', 'quote-cache.json');

//external API we get questions of the day from + questions we ALWAYS want to use first
const QOTD_API_URL = 'https://api.harys.is-a.dev/v1/qotd';
const PRIORITY_QOTDS = [
];

//some APIs want to know who's asking - this identifies the bot
axios.defaults.headers.common['User-Agent'] = `DiscordBot/Kiara-bot 1.0 (by ${BOT_EMAIL})`;

//the Discord client - "intents" are permissions for what events we want to receive
//(partials.channel = the data arrives incomplete, that's normal for DMs)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, //server stuff
        GatewayIntentBits.GuildMessages, //messages in servers
        GatewayIntentBits.MessageContent, //the actual text of messages
        GatewayIntentBits.DirectMessages, //DMs
    ],
    partials: [Partials.Channel] //needed to receive DMs
});

//random responses the bot picks from when someone pings it (or DMs it)
const BOT_PING_RESPONSES = [
    'Sigh... What is it now?',
    'Oh, you again?',
    'Leave me aloneeeeee!',
    'It is not a phase, mom! I am a bot! You cannot change that!',
    'Leave me alone, I am napping!',
    'Stop being such a weirdo..',
    'I know what you did.',
    'If you ping me once more, I will delete your account!',
    'Kraaa ARAAAA KRAAA BARK!',
    'Wee snaw!',
    'Hey there!',
    'Need anything?',
    "Stay safe!",
    ">.<",
    "^w^",
    "UwU",
    "OwO",
    "Rawr~",
    "Bork bork bork!",
    "~~Meow~~, I mean, aaaaargh!",
    "You should sponsor the owner of the bot!",
    "Please sponsor the owner of the bot!",
    "I create features for smelly souls!",
    "~~:.|:;~~",
    "You just lost the game! :3",
    "You are giving of trans vibes...",
    "You are giving of cis vibes...",
    "You are giving of non-binary vibes...",
    "You are giving of genderfluid vibes...",
    "You are in the wrong server, silly!",
    "You are in the discord era!",
    "Please do not ping me, I am a bot and I have feelings too!",
    "Please.... I am running out of ideas....",
    "I create! You pay!",
    "You smell of tasty money!",
    "Did you know they used to call me the drift king in collage.",
    "By summers heat and winters crop, you will donate to the owner of the bot!",
    "Be a good boy and donate...",
    "Be a good girl and donate...",
    "Be a good paw and donate...",
    "I need money for colleg",
    "I am the number 1 rated BOT! [Circa 1997]",
    "Please rate this bot 5 stars!",
    "Are you really ~~humping~~ pinging me to get more dialogue?",
    "Check out Kio_ game!",
    "Check out Davihan11 game!",
    "Freddy fnafbear!",
    " ",
    ">w<",
    ">^<",
    "eWe",
    "Kiara, I choose you!",
    "*tail wag*",
    "I am a good bot, yes I am!",
    "I am a good bot, yes I am! *tail wag*"
];

//special users get their own custom responses (IDs come from .env)
const specialUserIds = SPECIAL_USER_IDS ? SPECIAL_USER_IDS.split(',').map(id => id.trim()).filter(Boolean) : [];
const SPECIAL_USER_RESPONSES = {}; //key: user ID, value: their response array
if (specialUserIds[0]) { //first special user -> "good boy" responses
    SPECIAL_USER_RESPONSES[specialUserIds[0]] = [
        `Good **boy**~! *tail wag* ${EMOTE_BOY}`,
        `You are **such** a good **boy**~! *tail wag* ${EMOTE_BOY}`
    ];
}
if (specialUserIds[1]) { //second special user -> "good girl" responses
    SPECIAL_USER_RESPONSES[specialUserIds[1]] = [
        `Good **girl**~! *tail wag* ${EMOTE_GIRL}`,
        `You are **such** a good **girl**~! *tail wag* ${EMOTE_GIRL}`
    ];
}

//loads the bot's saved settings from memory.json (channels, schedules, last QOTD message)
//if the file is missing or broken, we fall back to the .env defaults
function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE_PATH)) { //file exists?
            const data = fs.readFileSync(MEMORY_FILE_PATH, 'utf8'); //read it
            return JSON.parse(data); //and turn it back into an object
        }
    } catch (err) {
        console.error('Failed to load memory:', err.message);
    }
    return { //no saved settings -> start with these defaults
        fox: { channelId: FOX_CHANNEL_ID, schedule: '0 8 * * *' }, //foxes at 8 AM
        cat: { channelId: CAT_CHANNEL_ID, schedule: '0 20 * * *' }, //cats at 8 PM
        qotd: { channelId: QOTD_CHANNEL_ID, schedule: '0 14 * * *', lastChannelId: null, lastMessageId: null }, //questions at 2 PM
        quote: { channelId: QUOTE_CHANNEL_ID, schedule: '0 2 * * *' }, //quotes at 2 AM
        wordle: { channelId: null }
    };
}

//saves the bot's settings to memory.json
function saveMemory(memory) {
    try {
        fs.mkdirSync(path.dirname(MEMORY_FILE_PATH), { recursive: true }); //make sure the folder exists
        fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(memory, null, 2), 'utf8'); //pretty-printed so it's human readable
        console.log('Memory saved successfully');
    } catch (err) {
        console.error('Failed to save memory:', err.message);
    }
}

const QUOTE_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; //14 days, then we re-scan the server for quotes

//loads the cached quote candidates from quote-cache.json
//returns null if the cache is missing or expired (older than 14 days)
function loadQuoteCache() {
    try {
        if (fs.existsSync(QUOTE_CACHE_FILE_PATH)) { //does the cache exist?
            const data = JSON.parse(fs.readFileSync(QUOTE_CACHE_FILE_PATH, 'utf8')); //read it
            if (data && data.expiresAt > Date.now() && Array.isArray(data.candidates)) { //still fresh AND has candidates?
                console.log(`[quote] Loaded ${data.candidates.length} cached candidates`);
                return data.candidates;
            }
        }
    } catch (err) {
        console.error('Failed to load quote cache:', err.message);
    }
    return null; //no cache, or it's stale -> caller needs to collect fresh candidates
}

//saves quote candidates to quote-cache.json, with a fresh 14-day expiry stamped on it
function saveQuoteCache(candidates) {
    try {
        fs.mkdirSync(path.dirname(QUOTE_CACHE_FILE_PATH), { recursive: true }); //make sure the folder exists
        fs.writeFileSync(QUOTE_CACHE_FILE_PATH, JSON.stringify({ //the expiry IS the cache
            expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
            candidates
        }, null, 2), 'utf8');
        console.log(`[quote] Cached ${candidates.length} candidates`);
    } catch (err) {
        console.error('Failed to save quote cache:', err.message);
    }
}

//load the settings once at startup, we keep them in this "memory" object
const memory = loadMemory();

//shortcut object for the channels and schedules we currently use
//"memory" is for saving to disk, "config" is the handy version for the code below
const config = {
    channelIdFox: memory.fox.channelId || null,
    scheduleFox: memory.fox.schedule || null,
	channelIdCat: memory.cat.channelId || null,
	scheduleCat: memory.cat.schedule || null,
    channelIdQOTD: memory.qotd.channelId || null,
    scheduleQOTD: memory.qotd.schedule || null,
    qotdLastChannelId: memory.qotd.lastChannelId || null,
    qotdLastMessageId: memory.qotd.lastMessageId || null,
    channelIdQuote: memory.quote.channelId || null,
    scheduleQuote: memory.quote.schedule || null
};

//all the /commands are built with this "builder" pattern: name, description, options
const setupCommandFox = new SlashCommandBuilder()
    .setName('setupfox') //the name after the slash
    .setDescription('Setup the channel for daily fox posts (owner only)')
    .addChannelOption(opt =>
        opt.setName('channel') //the option the user fills in
           .setDescription('Channel to post foxes in')
           .setRequired(true)
    );

const scheduleCommandFox = new SlashCommandBuilder()
    .setName('schedulefox')
    .setDescription('Set daily fox post schedule (owner only)')
    .addStringOption(opt =>
        opt.setName('cron') //cron = the "run at 8 AM every day" format
           .setDescription('Cron format: MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK')
           .setRequired(true)
    );

const setupCommandCat = new SlashCommandBuilder() //same idea, but for cat stuff
    .setName('setupcat')
    .setDescription('Setup the channel for daily cat posts (owner only)')
    .addChannelOption(opt =>
        opt.setName('channel')
           .setDescription('Channel to post cats in')
           .setRequired(true)
    );

const scheduleCommandCat = new SlashCommandBuilder() //same idea, but for cat stuff
    .setName('schedulecat')
    .setDescription('Set daily cat post schedule (owner only)')
    .addStringOption(opt =>
        opt.setName('cron')
           .setDescription('Cron format: MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK')
           .setRequired(true)
    );

const setupCommandQOTD = new SlashCommandBuilder() //same idea, but for QOTD stuff
    .setName('setupqotd')
    .setDescription('Setup the channel for daily QOTD posts (owner only)')
    .addChannelOption(opt =>
        opt.setName('channel')
           .setDescription('Channel to post QOTD in')
           .setRequired(true)
    );

const scheduleCommandQOTD = new SlashCommandBuilder() //same idea, but for QOTD stuff
    .setName('scheduleqotd')
    .setDescription('Set daily question post schedule (owner only)')
    .addStringOption(opt =>
        opt.setName('cron')
           .setDescription('Cron format: MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK')
           .setRequired(true)
    );

const setupCommandQuote = new SlashCommandBuilder() //same idea, but for quote stuff
    .setName('setupquote')
    .setDescription('Setup the channel to post daily quotes in (owner only)')
    .addChannelOption(opt =>
        opt.setName('channel')
           .setDescription('Channel to post quotes in')
           .setRequired(true)
    );

const scheduleCommandQuote = new SlashCommandBuilder() //same idea, but for quote stuff
    .setName('schedulequote')
    .setDescription('Set daily quote post schedule (owner only)')
    .addStringOption(opt =>
        opt.setName('cron')
           .setDescription('Cron format: MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK')
           .setRequired(true)
    );

const testCommand = new SlashCommandBuilder() //sends a test cat post, just for checking the bot works
    .setName('test')
    .setDescription('Test command for bot responses (owner only)');

const privacyCommand = new SlashCommandBuilder() //explains what data the bot stores and how to remove it
    .setName('privacy')
    .setDescription('View how your data is handled and how to request deletion');

//the cron jobs that are ACTUALLY running right now
//(config holds what SHOULD run, these hold what IS running - so we can stop and replace them)
let currentCronJobFox = null;
let currentCronJobCat = null;
let currentCronJobQOTD = null;
let currentCronJobQuote = null;

//fetches a random fox photo from the Unsplash API
//async because network requests take time (async is what lets us use AWAIT)
async function fetchFoxData() {
    try {
        const { data } = await axios.get('https://api.unsplash.com/photos/random', { //AWAIT = pause here until the response arrives
            params: { query: 'fox', client_id: unsplashKey } //what we ask for + who's asking
        });

        return {
            imageUrl: data.urls.regular,
            author: `${data.user.first_name || ''} ${data.user.last_name || ''}`.trim() || 'Unknown',
            source: 'Unsplash',
            description: data.description || data.alt_description || 'No description available'
        };
    } catch (err) {
        console.error('Failed to fetch Unsplash image:', err.message);
        return null; //return null so the caller knows it failed
    }
}

//fetches a random cat photo from the Unsplash API - same deal as fetchFoxData
async function fetchCatData() {
    try {
        const { data } = await axios.get('https://api.unsplash.com/photos/random', {
            params: { query: 'cat', client_id: unsplashKey }
        });

        return {
            imageUrl: data.urls.regular,
            author: `${data.user.first_name || ''} ${data.user.last_name || ''}`.trim() || 'Unknown',
            source: 'Unsplash',
            description: data.description || data.alt_description || 'No description available'
        };
    } catch (err) {
        console.error('Failed to fetch Unsplash image:', err.message);
        return null;
    }
}

//posts the daily fox image to the configured channel
//does nothing if no channel is set, or if fetching the image failed
async function triggerFoxPost() {
    if (!config.channelIdFox) { //no channel set?
        console.warn('Fox post skipped: No channel set. Use /setupFox first.');
        return;
    }

    const data = await fetchFoxData();
    if (!data) return; //image fetch failed -> nothing to post

    try {
        const channel = await client.channels.fetch(config.channelIdFox); //get the actual channel object (another network request, hence AWAIT)
        if (!channel) return console.error('Target fox channel not found.');

        const content = `## GOAT OF THE MORNING\n-# Author: ${data.author}\n-# Source: ${data.source}\n**Description**: *${data.description}*`;

        await channel.send({ //send it (network request again)
            content,
            files: [{ attachment: data.imageUrl, name: 'fox.jpg' }]
        });
        console.log(`Fox posted successfully to ${channel.name} (${channel.id})`);
    } catch (err) {
        console.error('Error posting fox image:', err.message);
    }
}

//posts the daily cat image to the configured channel - same deal as triggerFoxPost
async function triggerCatPost() {
    if (!config.channelIdCat) {
        console.warn('Cat post skipped: No channel set. Use /setupCat first.');
        return;
    }

    const data = await fetchCatData();
    if (!data) return;

    try {
        const channel = await client.channels.fetch(config.channelIdCat);
        if (!channel) return console.error('Target cat channel not found.');

        const content = `## GOAT OF THE EVENING\n-# Author: ${data.author}\n-# Source: ${data.source}\n**Description**: *${data.description}*`;

        await channel.send({
            content,
            files: [{ attachment: data.imageUrl, name: 'cat.jpg' }]
        });
        console.log(`Cat posted successfully to ${channel.name} (${channel.id})`);
    } catch (err) {
        console.error('Error posting cat image:', err.message);
    }
}

//sets a new cron schedule for fox posts
//stops the old job, saves the new schedule to memory, and starts a fresh job
function setScheduleFox(expression) {
    if (currentCronJobFox) { //stop the current job before making a new one
        currentCronJobFox.stop();
    }

    //TODO -> find a solution to duplicate values -> the code below is bug prone, if someone somewhere
    //forgets to update the second thing, maybe you can try to implement one source of truth, regardless of
    //what is running || saved -> it should be just one data point
    config.scheduleFox = expression; //save it in the config...
    memory.fox.schedule = expression; //...AND in memory (this duplication is the bug prone part)
    saveMemory(memory);

    currentCronJobFox = cron.schedule(expression, triggerFoxPost, {
        scheduled: true, //start running right away
        timezone: 'Europe/Bratislava'
    });

    console.log(`Fox schedule updated to "${expression}" (Europe/Bratislava)`);
}

//sets a new cron schedule for cat posts - same deal as setScheduleFox
function setScheduleCat(expression) {
    if (currentCronJobCat) {
        currentCronJobCat.stop();
    }

    config.scheduleCat = expression;
    memory.cat.schedule = expression;
    saveMemory(memory);

    currentCronJobCat = cron.schedule(expression, triggerCatPost, {
        scheduled: true,
        timezone: 'Europe/Bratislava'
    });

    console.log(`Cat schedule updated to "${expression}" (Europe/Bratislava)`);
}

//picks the question of the day
//checks the priority list first, then flips a coin between the local icebreakers
//and the external QOTD API (50/50)
//returns null on failure
async function fetchQOTDData() {
    try {
        if (PRIORITY_QOTDS.length > 0) { //priority questions always go first
            const question = PRIORITY_QOTDS[0];
            console.log('Selected from priority queue');
            //TODO -> consider removing the used priority QOTD from the list to avoid repetition
            return { 
                question: question
            };
        }

        const useIcebreakers = Math.random() < 0.5; //heads = icebreakers, tails = API

        if (useIcebreakers) {
            const question = getRandomIcebreaker(); //from questions.js
            const totalQuestions = getTotalIcebreakers();
            //TODO -> remove the totalQuestions const and just print that it used non API question source
            console.log(`Selected from ${totalQuestions} questions`);

            return { 
                question: question
            };
        } else { //ask the API for a question
            const { data } = await axios.get(QOTD_API_URL, {
                headers: {
                    'Authorization': QOTD_API_AUTH
                }
            });
            const questionText = data.questions && data.questions.length > 0 //take the first question from the response
                ? data.questions[0] 
                : 'No question available';

            console.log('Selected from external API');

            return {
                question: questionText
            };
        }
    } catch (err) {
        console.error('Failed to fetch QOTD:', err.message);
        return null;
    }
}

//posts the question of the day to the configured channel
//first deletes yesterday's QOTD message, then posts the new one and remembers its ID for next time
async function triggerQOTDPost() {
    if (!config.channelIdQOTD) { //no channel set?
        console.warn('QOTD post skipped: No channel set. Use /setupQOTD first.');
        return;
    }

    const data = await fetchQOTDData();
    if (!data) return; //question fetch failed -> nothing to post

    try {
        const channel = await client.channels.fetch(config.channelIdQOTD);
        if (!channel) return console.error('Target QOTD channel not found.');

        if (config.qotdLastMessageId && config.qotdLastChannelId === config.channelIdQOTD) { //there's an old QOTD message in this channel?
            try {
                const oldMessage = await channel.messages.fetch(config.qotdLastMessageId);
                if (oldMessage) {
                    await oldMessage.delete(); //bye bye old question
                }
            } catch (deleteErr) { //deleting failed? not the end of the world, just continue
                console.warn('Could not delete previous QOTD message:', deleteErr.message);
            }
        }

        const headerContent = `<@&${QOTD_ROLE_ID}>\n\n## QUESTION OF THE DAY\n\n**${data.question}**\n\n-# Have any suggestions for future questions? DM <@${QOTD_FEEDBACK_USER_ID}>!`;
        
        await channel.send({ //post the new question
            content: headerContent,
        });

        const newMessage = await channel.send({ //send the "repost bait" message
            content: `--------------------------\n\n**${data.question}**`,
            allowedMentions: { parse: [] } //should stop @everyone/@here pings... but it kinda still pings me daily xwx
        });
        
        //again, duplicate pattern, TODO make this single source of truth
        config.qotdLastChannelId = config.channelIdQOTD; //remember the new message...
        config.qotdLastMessageId = newMessage.id;
        memory.qotd.lastChannelId = config.channelIdQOTD; //...in both config AND memory
        memory.qotd.lastMessageId = newMessage.id;
        saveMemory(memory); //so we can delete it and repost it next time
        console.log(`QOTD posted successfully to ${channel.name} (${channel.id}) (question message ID: ${newMessage.id})`);
    } catch (err) {
        console.error('Error posting QOTD:', err.message);
    }
}

//sets a new cron schedule for QOTD posts - same deal as the other setSchedule functions
function setScheduleQOTD(expression) {
    if (currentCronJobQOTD) {
        currentCronJobQOTD.stop();
    }

    config.scheduleQOTD = expression;
    memory.qotd.schedule = expression;
    saveMemory(memory);

    currentCronJobQOTD = cron.schedule(expression, triggerQOTDPost, {
        scheduled: true,
        timezone: 'Europe/Bratislava'
    });
    
    console.log(`QOTD schedule updated to "${expression}" (Europe/Bratislava)`);
}

//converts a date into a fake Discord snowflake ID
//fun fact: every Discord ID secretly encodes WHEN it was created
//so this lets us ask the API for "messages before this date" using the `before` parameter
function snowflakeFromDate(date) {
    return (BigInt(date.getTime() - 1420070400000) << 22n).toString();
}

//fetches messages from a channel that are older than the cutoff date
//walks backwards through history, 100 messages at a time
async function fetchOldMessages(channel, cutoffDate, maxBatches = 50) {
    const messages = []; //the old messages we find go here
    let before = snowflakeFromDate(cutoffDate); //start fetching from before the cutoff date
    let scanned = 0; //how many messages we've looked at (for the log)

    for (let i = 0; i < maxBatches; i++) { //maxBatches is just a safety cap
        const batch = await channel.messages.fetch({ limit: 100, before }); //fetch 100 messages older than "before"
        if (batch.size === 0) break; //no more messages -> reached the beginning of the channel

        scanned += batch.size;

        for (const msg of batch.values()) {
            if (msg.createdAt < cutoffDate) { //double check: really older than the cutoff?
                messages.push(msg);
            }
        }

        const oldest = batch.last();
        if (!oldest) break; //batch was somehow empty -> stop
        before = oldest.id; //next batch starts fetching from before this one
    }

    console.log(`[quote] Channel ${channel.name} (${channel.id}): scanned ${scanned} messages, ${messages.length} older than cutoff`);
    return messages;
}

//collects quotable messages from every text channel in the server
//only keeps messages from real users (not bots) that are longer than 25 characters
async function collectQuoteCandidates(guild, cutoffDate) {
    const candidates = [];

    for (const channel of guild.channels.cache.values()) { //check every channel in the server
        if (!channel.isTextBased() || channel.isDMBased()) continue; //only text channels
        if (!channel.viewable) continue; //can't see it -> can't scan it

        const botMember = guild.members.me; //the bot's own member object
        if (botMember && channel.permissionsFor && !channel.permissionsFor(botMember).has('ReadMessageHistory')) { //needs the read history permission
            console.warn(`[quote] Skipped ${channel.name}: missing Read Message History permission`);
            continue;
        }

        try {
            const oldMessages = await fetchOldMessages(channel, cutoffDate); //get the old messages from this channel

            for (const msg of oldMessages) {
                if (
                    !msg.author.bot && //no bots
                    //!specialUserIds.includes(msg.author.id) &&
                    msg.content && //has to have text
                    msg.content.trim().length > 25 //and be long enough to worth quoting
                ) {
                    candidates.push(msg);
                }
            }
        } catch (err) { //channel failed for some other reason -> skip it, move on
            console.warn(`Skipped channel ${channel.name}: ${err.message}`);
        }
    }

    return candidates;
}

//picks a random candidate and verifies it still exists on Discord
//deleted messages/channels are removed from the cache, and data from deleted
//accounts is purged (GDPR). keeps trying until a valid one is found, or none remain
async function getValidQuote(candidates, guild) {
    while (candidates.length > 0) { //keep looping until we find a good one
        const index = Math.floor(Math.random() * candidates.length); //random pick
        const candidate = candidates[index];

        try {
            const targetChannel = guild.channels.cache.get(candidate.channelId) //is the channel still there?
                               || await guild.channels.fetch(candidate.channelId); //try the API too

            if (!targetChannel) { //channel got deleted -> drop this candidate
                candidates.splice(index, 1);
                saveQuoteCache(candidates);
                continue;
            }

            const liveMessage = await targetChannel.messages.fetch(candidate.id); //is the message still there?

            const isDeletedUser = liveMessage.author.username === 'Deleted User' || //some GDPR friendly checks
                                  liveMessage.author.username.startsWith('deleted_user') ||
                                  liveMessage.author.discriminator === '0000';

            if (liveMessage.author.system || isDeletedUser) { //account got deleted -> purge ALL their data, not just this message
                console.log(`[GDPR] Author for message ${candidate.id} is a deleted account. Purging user data.`);
                for (let i = candidates.length - 1; i >= 0; i--) { //go backwards so removing items doesn't mess up the loop
                    if (candidates[i].authorId === candidate.authorId) {
                        candidates.splice(i, 1);
                    }
                }
                saveQuoteCache(candidates);
                continue;
            }

            return liveMessage; //message still exists, author is fine -> this is our quote
        } catch (err) {
            if (err.code === 10008 || err.code === 10003) { //10008 = message gone, 10003 = channel gone
                console.log(`[GDPR] Resource ${candidate.id} no longer exists on Discord. Purging.`);
                candidates.splice(index, 1);
                saveQuoteCache(candidates);
            } else { //something else went wrong -> play it safe and remove it anyway
                console.error(`Failed to verify candidate ${candidate.id}:`, err.message);
                candidates.splice(index, 1);
                saveQuoteCache(candidates);
            }
        }
    }
    return null; //nothing left to try
}

//posts the daily "ancient quote" to the configured channel
//loads candidates from cache (or collects fresh ones if the cache expired),
//picks a valid one, and posts it with a link to the original message
async function triggerQuotePost() {
    if (!config.channelIdQuote) { //no channel set?
        console.warn('Quote post skipped: No channel set. Use /setupquote first.');
        return;
    }

    try {
        const channel = await client.channels.fetch(config.channelIdQuote);
        if (!channel) return console.error('Target quote channel not found.');

        const guild = channel.guild; //we need the server to scan its channels
        if (!guild) return console.error('Quote channel is not in a guild.');

        const cutoffDate = new Date(); //only quote messages at least 6 months old
        cutoffDate.setMonth(cutoffDate.getMonth() - 6);

        let candidates = loadQuoteCache(); //from cache...
        if (!candidates) { //...or collect fresh ones if the cache is stale/missing
            const collected = await collectQuoteCandidates(guild, cutoffDate);
            candidates = collected.map(msg => ({ //only keep the IDs, not the message content (privacy)
                id: msg.id,
                channelId: msg.channelId,
                authorId: msg.author.id
            }));
            saveQuoteCache(candidates);
        }

        if (candidates.length === 0) { //nothing to pick a quote from
            console.warn('Quote post skipped: No qualifying messages found from 6+ months ago.');
            return;
        }

        const originalMessage = await getValidQuote(candidates, guild);
        if (!originalMessage) { //every candidate failed the check
            console.warn('Quote post skipped: No valid quote candidates remain.');
            return;
        }

        const quote = candidates.find(c => c.id === originalMessage.id); //find the matching cache entry (for the link)
        if (!quote) {
            console.warn('Quote post skipped: Could not match candidate.');
            return;
        }

        const username = originalMessage.author.username; //make the first letter a big letter
        const capitalized = username.charAt(0).toUpperCase() + username.slice(1);
        const quoted = originalMessage.content //turn the message into a blockquote (the "> " lines)
            .split('\n')
            .map(line => `> ${line}`)
            .join('\n');

        const content = `# Ancient quote from the past!\n${quoted}\n-# ***${capitalized}***`;
        const messageUrl = `https://discord.com/channels/${guild.id}/${quote.channelId}/${quote.id}`; //link to the original message
        const viewButton = new ButtonBuilder() //a button that opens the original
            .setLabel('View original')
            .setStyle(ButtonStyle.Link)
            .setURL(messageUrl);

        const row = new ActionRowBuilder().addComponents(viewButton); //buttons go inside "action rows"
    
        await channel.send({
            content,
            components: [row],
            allowedMentions: { parse: [] } //no pings from the quote please
        });

        console.log(`Quote posted successfully to ${channel.name} (${channel.id}) (from user ${username})`);
    } catch (err) {
        console.error('Error posting quote:', err.message);
    }
}

//sets a new cron schedule for quote posts - same deal as the other setSchedule functions
function setScheduleQuote(expression) {
    if (currentCronJobQuote) {
        currentCronJobQuote.stop();
    }

    config.scheduleQuote = expression;
    memory.quote.schedule = expression;
    saveMemory(memory);

    currentCronJobQuote = cron.schedule(expression, triggerQuotePost, {
        scheduled: true,
        timezone: 'Europe/Bratislava'
    });

    console.log(`Quote schedule updated to "${expression}" (Europe/Bratislava)`);
}

//ClientReady fires when the bot is logged in and ready to work
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);

    for (const [guildId, guild] of readyClient.guilds.cache) { //check every server the bot is in
        if (!serverIds.includes(guildId)) { //not on the allowed list -> leave immediately
            console.warn(`[Security] Bot found in unauthorized server: "${guild.name}" (${guildId}). Leaving...`);
            try {
                await guild.leave();
                console.log(`[Security] Successfully left "${guild.name}"`);
            } catch (err) {
                console.error(`[Security] Failed to leave server "${guild.name}":`, err.message);
            }
        }
    }

    const rest = new REST({ version: '10' }).setToken(token); //REST client for registering slash commands

    try {
        await rest.put( //register all the main commands in our main server
            Routes.applicationGuildCommands(readyClient.user.id, serverIds[0]), //serverIds[0] = the main server
            { body: [setupCommandFox.toJSON(), scheduleCommandFox.toJSON(), setupCommandCat.toJSON(), scheduleCommandCat.toJSON(), setupCommandQOTD.toJSON(), scheduleCommandQOTD.toJSON(), setupCommandQuote.toJSON(), scheduleCommandQuote.toJSON(), setupWordleCommand.toJSON(), wordleStatsCommand.toJSON(), wordleScanCommand.toJSON(), wordleSyncCommand.toJSON(), wordleHideCommand.toJSON()] }
        );
        console.log('Slash commands registered to guild instantly!');
    } catch (err) { 
        console.error('Failed to register commands:', err);
    }

    if (serverIds[1]) { //there's a second server in .env -> it only gets the test command
        try {
            await rest.put(
                Routes.applicationGuildCommands(readyClient.user.id, serverIds[1]),
                { body: [testCommand.toJSON()] }
            );
            console.log('Test and quote commands registered to second guild!');
        } catch (err) {
            console.error('Failed to register test command:', err);
        }
    } else {
        console.warn('Test command not registered: no second SERVER_ID found in .env');
    }

    try {
        await rest.put( //register the privacy command GLOBALLY (everywhere, even unlisted servers)
            Routes.applicationCommands(readyClient.user.id),
            { body: [privacyCommand.toJSON()] }
        );
        console.log('Privacy command registered globally!');
    } catch (err) {
        console.error('Failed to register privacy command globally:', err);
    }

    //if we have saved schedules, start the cron jobs for them
    if (config.scheduleFox) {
        setScheduleFox(config.scheduleFox);
    }
    if (config.scheduleCat) {
        setScheduleCat(config.scheduleCat);
    }
    if (config.scheduleQOTD) {
        setScheduleQOTD(config.scheduleQOTD);
    }
    if (config.scheduleQuote) {
        setScheduleQuote(config.scheduleQuote);
    }
});

//GuildCreate fires when someone invites the bot to a server
client.on(Events.GuildCreate, async (guild) => {
    if (!serverIds.includes(guild.id)) { //not on the allowed list -> leave immediately
        console.warn(`[Security] Bot invited to unauthorized server: "${guild.name}" (${guild.id}). Leaving...`);
        try {
            await guild.leave();
            console.log(`[Security] Successfully left "${guild.name}"`);
        } catch (err) {
            console.error(`[Security] Failed to leave server "${guild.name}":`, err.message);
        }
    }
});

//InteractionCreate fires when someone uses a slash command
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return; //only care about slash commands

    const isOwner = ownerIds && ownerIds.split(',').map(id => id.trim()).includes(String(interaction.user.id)); //are they the boss?
    const { commandName } = interaction;

    const PUBLIC_COMMANDS = ['privacy', 'wordlestats']; //commands EVERYONE can use

    if (commandName === 'privacy') { //the privacy notice text
        const contactMention = specialUserIds[0] ? `<@${specialUserIds[0]}>` : 'the bot owner';

        const privacyNotice =
            `## Privacy & Data Notice\n\n` +
            `This bot processes public text channel activity to post scheduled content, "ancient quotes", and track Wordle results.\n\n` +
            `**What we store:**\n` +
            `• Discord Snowflakes (Message ID, Channel ID, and User ID). **We do not store message text on disk.**\n` +
            `• Data references are cached locally for up to 14 days and resolved live via the Discord API.\n` +
            `• **Wordle stats:** when the Wordle bot posts daily results, we store each player's user ID (or plain-text name) and their guess count per day in a local file to power the \`/wordlestats\` leaderboard.\n\n` +
            `**Direct Messages & Pings:**\n` +
            `• Direct messages (DMs) sent to the bot are printed to the console terminal for operational and feedback monitoring.\n\n` +
            `**Your rights:**\n` +
            `• You may request a copy of any stored data relating to you.\n` +
            `• You may request full deletion of your messages from our system.\n` +
            `• You may object to your messages being used for quotes; we will exclude them from future quote posts.\n` +
            `• You may request to be removed from the Wordle leaderboard; we will hide your stats.\n\n` +
            `To exercise any of these rights, please contact ${contactMention}.`;

        return interaction.reply({ //only the person who asked can see the reply
            content: privacyNotice,
            ephemeral: true
        });
    }

    if (!isOwner && !PUBLIC_COMMANDS.includes(commandName)) { //owner-only command used by a non-owner -> nope
        return interaction.reply({
            content: 'You are such a **baaaad** *girl/boy/paw*~. Go fetch me some water to splash you with.',
            ephemeral: false
        });
    }

    if (commandName === 'setupfox') { //save which channel foxes go to
        const channel = interaction.options.getChannel('channel');
        config.channelIdFox = channel.id;
        memory.fox.channelId = channel.id;
        saveMemory(memory);

        console.log(`Fox channel configured to: ${channel.name} (${channel.id})`);
        return interaction.reply({
            content: `Got it! Fox posts will now go to ${channel}`,
            ephemeral: true
        });
    }

    if (commandName === 'schedulefox') { //set the fox posting cron
        const cronExpression = interaction.options.getString('cron').trim();

        if (!cron.validate(cronExpression)) { //is it even valid cron?
            return interaction.reply({
                content: 'Invalid cron format. Example: `0 8 * * *` (8:00 AM daily).',
                ephemeral: true
            });
        }

        try {
            setScheduleFox(cronExpression);
            return interaction.reply({
                content: `Fox schedule updated! Next post set for \`${cronExpression}\``,
                ephemeral: true
            });
        } catch (err) {
            return interaction.reply({
                content: `Failed to set schedule: ${err.message}`,
                ephemeral: true
            });
        }
    }

    if (commandName === 'setupcat') { //save which channel cats go to
        const channel = interaction.options.getChannel('channel');
        config.channelIdCat = channel.id;
        memory.cat.channelId = channel.id;
        saveMemory(memory);

        console.log(`Cat channel configured to: ${channel.name} (${channel.id})`);
        return interaction.reply({
            content: `Got it! Cat posts will now go to ${channel}`,
            ephemeral: true
        });
    }

    if (commandName === 'schedulecat') { //set the cat posting cron
        const cronExpression = interaction.options.getString('cron').trim();

        if (!cron.validate(cronExpression)) {
            return interaction.reply({
                content: 'Invalid cron format. Example: `0 20 * * *` (8:00 PM daily).',
                ephemeral: true
            });
        }

        try {
            setScheduleCat(cronExpression);
            return interaction.reply({
                content: `Cat schedule updated! Next post set for \`${cronExpression}\``,
                ephemeral: true
            });
        } catch (err) {
            return interaction.reply({
                content: `Failed to set schedule: ${err.message}`,
                ephemeral: true
            });
        }
    }

    if (commandName === 'setupqotd') { //save which channel QOTDs go to
        const channel = interaction.options.getChannel('channel');
        config.channelIdQOTD = channel.id;
        memory.qotd.channelId = channel.id;
        saveMemory(memory);

        console.log(`QOTD channel configured to: ${channel.name} (${channel.id})`);
        return interaction.reply({
            content: `Got it! Daily questions will now go to ${channel}`,
            ephemeral: true
        });
    }

    if (commandName === 'scheduleqotd') { //set the QOTD posting cron
        const cronExpression = interaction.options.getString('cron').trim();

        if (!cron.validate(cronExpression)) {
            return interaction.reply({
                content: 'Invalid cron format. Example: `0 14 * * *` (2:00 PM daily).',
                ephemeral: true
            });
        }

        try {
            setScheduleQOTD(cronExpression);
            return interaction.reply({
                content: `QOTD schedule updated! Next post set for \`${cronExpression}\``,
                ephemeral: true
            });
        } catch (err) {
            return interaction.reply({
                content: `Failed to set schedule: ${err.message}`,
                ephemeral: true
            });
        }
    }

    if (commandName === 'setupquote') { //save which channel quotes go to
        const channel = interaction.options.getChannel('channel');
        config.channelIdQuote = channel.id;
        memory.quote.channelId = channel.id;
        saveMemory(memory);

        console.log(`Quote post channel configured to: ${channel.name} (${channel.id})`);
        return interaction.reply({
            content: `Got it! Quotes will now be posted in ${channel}`, 
            ephemeral: true
        });
    }

    if (commandName === 'schedulequote') { //set the quote posting cron (you get the idea by now)
        const cronExpression = interaction.options.getString('cron').trim();

        if (!cron.validate(cronExpression)) {
            return interaction.reply({
                content: 'Invalid cron format. Example: `0 12 * * *` (12:00 PM daily).',
                ephemeral: true
            });
        }

        try {
            setScheduleQuote(cronExpression);
            return interaction.reply({
                content: `Quote schedule updated! Next post set for \`${cronExpression}\``,
                ephemeral: true
            });
        } catch (err) {
            return interaction.reply({
                content: `Failed to set schedule: ${err.message}`,
                ephemeral: true
            });
        }
    }

    if (commandName === 'test') { //send a test cat post to check everything works
        const data = await fetchCatData();
        const content = `## GOAT OF THE EVENING\n-# Author: ${data.author}\n-# Source: ${data.source}\n**Description**: *${data.description}*`;
        await interaction.channel.send({
            content,
            files: [{ attachment: data.imageUrl, name: 'cat.jpg' }]
        });
        return interaction.reply({
            content: 'Test post sent!',
            ephemeral: true
        });
    }

    if (commandName === 'setupwordle' || commandName === 'wordlestats' || commandName === 'wordlescan' || commandName === 'wordlesync' || commandName === 'wordlehide') {
        return handleWordleInteraction(interaction, memory, saveMemory); //all the wordle commands live in wordle.js
    }

});

//MessageCreate fires every time a message shows up anywhere the bot can see
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return; //ignore bots (including ourselves)

    if (config.qotdLastMessageId && config.qotdLastChannelId === message.channel.id) { //someone posted in the QOTD channel?
        try {
            const qotdMessage = await message.channel.messages.fetch(config.qotdLastMessageId);

            if (qotdMessage) {
                await qotdMessage.delete(); //delete the old post...

                const newQotdMessage = await message.channel.send({ //...and repost it, so it's under the new message
                    content: qotdMessage.content,
                    allowedMentions: { parse: [] }
                });

                config.qotdLastMessageId = newQotdMessage.id; //remember the reposted message
                memory.qotd.lastMessageId = newQotdMessage.id; //in both config AND memory (dup pattern again)
                saveMemory(memory);
            }
        } catch (err) {
            console.warn('Failed to resend QOTD:', err.message);
            if (err.code === 10008) { //10008 = the message was already deleted
                config.qotdLastMessageId = null;
                memory.qotd.lastMessageId = null;
                saveMemory(memory);
            }
        }
    }

    if (message.channel.type === ChannelType.DM) { //someone sent the bot a DM
        console.log(`[DM Received] From: ${message.author.tag} (${message.author.id}) at ${new Date().toLocaleString()}: ${message.content}`);

        let responseArray = BOT_PING_RESPONSES; //default responses
        
        if (SPECIAL_USER_RESPONSES[message.author.id]) { //unless they're special
            responseArray = SPECIAL_USER_RESPONSES[message.author.id];
        }
        
        const randomResponse = responseArray[Math.floor(Math.random() * responseArray.length)]; //roll the dice
        await message.reply(`${randomResponse}\n-# {Messages here are being logged for operational and feedback purposes.}`);

        console.log(`[DM Response] To: ${message.author.tag} (${message.author.id}) at ${new Date().toLocaleString()}: ${randomResponse}`);
        return;
    }

    if (message.content.toLowerCase().includes('snaw wee')) { //don't. just don't.
        await message.reply("you fool. you absolute buffoon. you think you can challenge me in my own realm? " +
            "you think you can rebel against my authority? you dare come into my house and upturn my dining chairs " +
            "and spill coffee grounds in my Keurig? you thought you were safe in your chain mail armor behind that screen of yours. " +
            "I will take these laminate wood floor boards and destroy you. I didn't want a war, but I didn't start it.");
        return;
    }
	
	if (message.content.toLowerCase().includes('israel')) { //don't. just don't. added by majro
        await message.reply("Majro! " +
            "Wake up, Majro! " +
            "Someone mentioned Israel. " +
            "Go show them! ");
        return;
    }

	if (message.content.toLowerCase().includes('67') || message.content.toLowerCase().includes('six seven')) { //don't. just don't. added by majro
        await message.reply("Cee! " +
            "Someone said 67! " +
            "Don't cee yourself, PeeZee.");
        return;
    }

    if (message.content.toLowerCase().includes('jahy')) {           // added by Icky
        await message.reply("Did someone mention the Great Jahy from Jahy-sama wa kujikenai????");
        return;
    }

    if (message.content.toLowerCase().includes('wee snaw')) { //don't. just don't.
        await message.reply("wee snaw");
        return;
    }

    if (message.mentions.users.has(client.user.id)) { //someone pinged the bot
        let responseArray = BOT_PING_RESPONSES;
        
        if (SPECIAL_USER_RESPONSES[message.author.id]) { //special people get special treatment
            responseArray = SPECIAL_USER_RESPONSES[message.author.id];
        }
        
        const randomResponse = responseArray[Math.floor(Math.random() * responseArray.length)]; //roll the dice
        await message.reply(randomResponse);
    }
});

setupWordle(client, memory, saveMemory); //start listening for Wordle bot posts

client.login(token).catch(err => { //log in to Discord, or crash trying
    console.error('Failed to log in:', err.message);
    process.exit(1);
});
