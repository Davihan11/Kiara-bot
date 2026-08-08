require('dotenv').config({ path: './.env' });
const { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Partials, ChannelType, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getRandomIcebreaker, getTotalIcebreakers } = require('../data/questions');

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

const serverIds = SERVER_ID ? SERVER_ID.split(',').map(id => id.trim()) : [];

const MEMORY_FILE_PATH = path.join(__dirname, '..', 'data', 'memory.json');
const QUOTE_CACHE_FILE_PATH = path.join(__dirname, '..', 'data', 'quote-cache.json');

const QOTD_API_URL = 'https://api.harys.is-a.dev/v1/qotd';

const PRIORITY_QOTDS = [
];

axios.defaults.headers.common['User-Agent'] = `DiscordBot/Kiara-bot 1.0 (by ${BOT_EMAIL})`;
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel]
});

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

const specialUserIds = SPECIAL_USER_IDS ? SPECIAL_USER_IDS.split(',').map(id => id.trim()).filter(Boolean) : [];
const SPECIAL_USER_RESPONSES = {};
if (specialUserIds[0]) {
    SPECIAL_USER_RESPONSES[specialUserIds[0]] = [
        `Good **boy**~! *tail wag* ${EMOTE_BOY}`,
        `You are **such** a good **boy**~! *tail wag* ${EMOTE_BOY}`
    ];
}
if (specialUserIds[1]) {
    SPECIAL_USER_RESPONSES[specialUserIds[1]] = [
        `Good **girl**~! *tail wag* ${EMOTE_GIRL}`,
        `You are **such** a good **girl**~! *tail wag* ${EMOTE_GIRL}`
    ];
}

function loadMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE_PATH)) {
            const data = fs.readFileSync(MEMORY_FILE_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Failed to load memory:', err.message);
    }
    return {
        fox: { channelId: FOX_CHANNEL_ID, schedule: '0 8 * * *' },
        cat: { channelId: CAT_CHANNEL_ID, schedule: '0 20 * * *' },
        qotd: { channelId: QOTD_CHANNEL_ID, schedule: '0 14 * * *', lastChannelId: null, lastMessageId: null },
        quote: { channelId: QUOTE_CHANNEL_ID, schedule: '0 2 * * *' }
    };
}

function saveMemory(memory) {
    try {
        fs.mkdirSync(path.dirname(MEMORY_FILE_PATH), { recursive: true });
        fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(memory, null, 2), 'utf8');
        console.log('Memory saved successfully');
    } catch (err) {
        console.error('Failed to save memory:', err.message);
    }
}

const QUOTE_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function loadQuoteCache() {
    try {
        if (fs.existsSync(QUOTE_CACHE_FILE_PATH)) {
            const data = JSON.parse(fs.readFileSync(QUOTE_CACHE_FILE_PATH, 'utf8'));
            if (data && data.expiresAt > Date.now() && Array.isArray(data.candidates)) {
                console.log(`[quote] Loaded ${data.candidates.length} cached candidates`);
                return data.candidates;
            }
        }
    } catch (err) {
        console.error('Failed to load quote cache:', err.message);
    }
    return null;
}

function saveQuoteCache(candidates) {
    try {
        fs.mkdirSync(path.dirname(QUOTE_CACHE_FILE_PATH), { recursive: true });
        fs.writeFileSync(QUOTE_CACHE_FILE_PATH, JSON.stringify({
            expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
            candidates
        }, null, 2), 'utf8');
        console.log(`[quote] Cached ${candidates.length} candidates`);
    } catch (err) {
        console.error('Failed to save quote cache:', err.message);
    }
}

const memory = loadMemory();

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

const setupCommandFox = new SlashCommandBuilder()
    .setName('setupfox')
    .setDescription('Setup the channel for daily fox posts (owner only)')
    .addChannelOption(opt => 
        opt.setName('channel')
           .setDescription('Channel to post foxes in')
           .setRequired(true)
    );

const scheduleCommandFox = new SlashCommandBuilder()
    .setName('schedulefox')
    .setDescription('Set daily fox post schedule (owner only)')
    .addStringOption(opt => 
        opt.setName('cron')
           .setDescription('Cron format: MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK')
           .setRequired(true)
    );

const setupCommandCat = new SlashCommandBuilder()
    .setName('setupcat')
    .setDescription('Setup the channel for daily cat posts (owner only)')
    .addChannelOption(opt => 
        opt.setName('channel')
           .setDescription('Channel to post cats in')
           .setRequired(true)
    );

const scheduleCommandCat = new SlashCommandBuilder()
    .setName('schedulecat')
    .setDescription('Set daily cat post schedule (owner only)')
    .addStringOption(opt => 
        opt.setName('cron')
           .setDescription('Cron format: MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK')
           .setRequired(true)
    );

const setupCommandQOTD = new SlashCommandBuilder()
    .setName('setupqotd')
    .setDescription('Setup the channel for daily QOTD posts (owner only)')
    .addChannelOption(opt => 
        opt.setName('channel')
           .setDescription('Channel to post QOTD in')
           .setRequired(true)
    );

const scheduleCommandQOTD = new SlashCommandBuilder()
    .setName('scheduleqotd')
    .setDescription('Set daily question post schedule (owner only)')
    .addStringOption(opt => 
        opt.setName('cron')
           .setDescription('Cron format: MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK')
           .setRequired(true)
    );

const setupCommandQuote = new SlashCommandBuilder()
    .setName('setupquote')
    .setDescription('Setup the channel to post daily quotes in (owner only)')
    .addChannelOption(opt => 
        opt.setName('channel')
           .setDescription('Channel to post quotes in')
           .setRequired(true)
    );

const scheduleCommandQuote = new SlashCommandBuilder()
    .setName('schedulequote')
    .setDescription('Set daily quote post schedule (owner only)')
    .addStringOption(opt => 
        opt.setName('cron')
           .setDescription('Cron format: MIN HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK')
           .setRequired(true)
    );

const testCommand = new SlashCommandBuilder()
    .setName('test')
    .setDescription('Test command for bot responses (owner only)');

const privacyCommand = new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('View how your data is handled and how to request deletion');


let currentCronJobFox = null;
let currentCronJobCat = null;
let currentCronJobQOTD = null;
let currentCronJobQuote = null;
let qotdResendTimer = null;

async function fetchFoxData() {
    try {
        const { data } = await axios.get('https://api.unsplash.com/photos/random', {
            params: { query: 'fox', client_id: unsplashKey }
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

async function triggerFoxPost() {
    if (!config.channelIdFox) {
        console.warn('Fox post skipped: No channel set. Use /setupFox first.');
        return;
    }

    const data = await fetchFoxData();
    if (!data) return;

    try {
        const channel = await client.channels.fetch(config.channelIdFox);
        if (!channel) return console.error('Target fox channel not found.');

        const content = `## GOAT OF THE MORNING\n-# Author: ${data.author}\n-# Source: ${data.source}\n**Description**: *${data.description}*`;

        await channel.send({
            content,
            files: [{ attachment: data.imageUrl, name: 'fox.jpg' }]
        });
        console.log(`Fox posted successfully to ${channel.name} (${channel.id})`);
    } catch (err) {
        console.error('Error posting fox image:', err.message);
    }
}

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

function setScheduleFox(expression) {
    if (currentCronJobFox) {
        currentCronJobFox.stop();
    }

    config.scheduleFox = expression;
    memory.fox.schedule = expression;
    saveMemory(memory);
    
    currentCronJobFox = cron.schedule(expression, triggerFoxPost, {
        scheduled: true,
        timezone: 'Europe/Bratislava'
    });

    console.log(`Fox schedule updated to "${expression}" (Europe/Bratislava)`);
}

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

async function fetchQOTDData() {
    try {
        if (PRIORITY_QOTDS.length > 0) {
            const question = PRIORITY_QOTDS[0];
            console.log('Selected from priority queue');
            return {
                question: question
            };
        }

        const useIcebreakers = Math.random() < 0.5;

        if (useIcebreakers) {
            const question = getRandomIcebreaker();
            const totalQuestions = getTotalIcebreakers();

            console.log(`Selected from ${totalQuestions} questions`);

            return {
                question: question
            };
        } else {
            const { data } = await axios.get(QOTD_API_URL, {
                headers: {
                    'Authorization': QOTD_API_AUTH
                }
            });

            const questionText = data.questions && data.questions.length > 0 
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

async function triggerQOTDPost() {
    if (!config.channelIdQOTD) {
        console.warn('QOTD post skipped: No channel set. Use /setupQOTD first.');
        return;
    }

    const data = await fetchQOTDData();
    if (!data) return;

    try {
        const channel = await client.channels.fetch(config.channelIdQOTD);
        if (!channel) return console.error('Target QOTD channel not found.');

        if (config.qotdLastMessageId && config.qotdLastChannelId === config.channelIdQOTD) {
            try {
                const oldMessage = await channel.messages.fetch(config.qotdLastMessageId);
                if (oldMessage) {
                    await oldMessage.delete();
                }
            } catch (deleteErr) {
                console.warn('Could not delete previous QOTD message:', deleteErr.message);
            }
        }

        const headerContent = `<@&${QOTD_ROLE_ID}>\n\n## QUESTION OF THE DAY\n\n**${data.question}**\n\n-# Have any suggestions for future questions? DM <@${QOTD_FEEDBACK_USER_ID}>!`;
        
        await channel.send({
            content: headerContent,
        });

        const newMessage = await channel.send({
            content: `--------------------------\n\n**${data.question}**`,
            allowedMentions: { parse: [] }
        });
        
        config.qotdLastChannelId = config.channelIdQOTD;
        config.qotdLastMessageId = newMessage.id;
        memory.qotd.lastChannelId = config.channelIdQOTD;
        memory.qotd.lastMessageId = newMessage.id;
        saveMemory(memory);
        
        console.log(`QOTD posted successfully to ${channel.name} (${channel.id}) (question message ID: ${newMessage.id})`);
    } catch (err) {
        console.error('Error posting QOTD:', err.message);
    }
}



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

function snowflakeFromDate(date) {
    return (BigInt(date.getTime() - 1420070400000) << 22n).toString();
}

async function fetchOldMessages(channel, cutoffDate, maxBatches = 50) {
    const messages = [];
    let before = snowflakeFromDate(cutoffDate);
    let scanned = 0;

    for (let i = 0; i < maxBatches; i++) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        if (batch.size === 0) break;

        scanned += batch.size;

        for (const msg of batch.values()) {
            if (msg.createdAt < cutoffDate) {
                messages.push(msg);
            }
        }

        const oldest = batch.last();
        if (!oldest) break;
        before = oldest.id;
    }

    console.log(`[quote] Channel ${channel.name} (${channel.id}): scanned ${scanned} messages, ${messages.length} older than cutoff`);
    return messages;
}

async function collectQuoteCandidates(guild, cutoffDate) {
    const candidates = [];

    for (const channel of guild.channels.cache.values()) {
        if (!channel.isTextBased() || channel.isDMBased()) continue;
        if (!channel.viewable) continue;

        const botMember = guild.members.me;
        if (botMember && channel.permissionsFor && !channel.permissionsFor(botMember).has('ReadMessageHistory')) {
            console.warn(`[quote] Skipped ${channel.name}: missing Read Message History permission`);
            continue;
        }

        try {
            const oldMessages = await fetchOldMessages(channel, cutoffDate);

            for (const msg of oldMessages) {
                if (
                    !msg.author.bot &&
                    //!specialUserIds.includes(msg.author.id) &&
                    msg.content &&
                    msg.content.trim().length > 25
                ) {
                    candidates.push(msg);
                }
            }
        } catch (err) {
            console.warn(`Skipped channel ${channel.name}: ${err.message}`);
        }
    }

    return candidates;
}

async function getValidQuote(candidates, guild) {
    while (candidates.length > 0) {
        const index = Math.floor(Math.random() * candidates.length);
        const candidate = candidates[index];

        try {
            const targetChannel = guild.channels.cache.get(candidate.channelId)
                               || await guild.channels.fetch(candidate.channelId);

            if (!targetChannel) {
                candidates.splice(index, 1);
                saveQuoteCache(candidates);
                continue;
            }

            const liveMessage = await targetChannel.messages.fetch(candidate.id);

            const isDeletedUser = liveMessage.author.username === 'Deleted User' ||
                                  liveMessage.author.username.startsWith('deleted_user') ||
                                  liveMessage.author.discriminator === '0000';

            if (liveMessage.author.system || isDeletedUser) {
                console.log(`[GDPR] Author for message ${candidate.id} is a deleted account. Purging user data.`);
                for (let i = candidates.length - 1; i >= 0; i--) {
                    if (candidates[i].authorId === candidate.authorId) {
                        candidates.splice(i, 1);
                    }
                }
                saveQuoteCache(candidates);
                continue;
            }

            return liveMessage;
        } catch (err) {
            if (err.code === 10008 || err.code === 10003) {
                console.log(`[GDPR] Resource ${candidate.id} no longer exists on Discord. Purging.`);
                candidates.splice(index, 1);
                saveQuoteCache(candidates);
            } else {
                console.error(`Failed to verify candidate ${candidate.id}:`, err.message);
                candidates.splice(index, 1);
                saveQuoteCache(candidates);
            }
        }
    }
    return null;
}

async function triggerQuotePost() {
    if (!config.channelIdQuote) {
        console.warn('Quote post skipped: No channel set. Use /setupquote first.');
        return;
    }

    try {
        const channel = await client.channels.fetch(config.channelIdQuote);
        if (!channel) return console.error('Target quote channel not found.');

        const guild = channel.guild;
        if (!guild) return console.error('Quote channel is not in a guild.');

        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 6);

        let candidates = loadQuoteCache();
        if (!candidates) {
            const collected = await collectQuoteCandidates(guild, cutoffDate);
            candidates = collected.map(msg => ({
                id: msg.id,
                channelId: msg.channelId,
                authorId: msg.author.id
            }));
            saveQuoteCache(candidates);
        }

        if (candidates.length === 0) {
            console.warn('Quote post skipped: No qualifying messages found from 6+ months ago.');
            return;
        }

        const originalMessage = await getValidQuote(candidates, guild);
        if (!originalMessage) {
            console.warn('Quote post skipped: No valid quote candidates remain.');
            return;
        }

        const quote = candidates.find(c => c.id === originalMessage.id);
        if (!quote) {
            console.warn('Quote post skipped: Could not match candidate.');
            return;
        }

        const username = originalMessage.author.username;
        const capitalized = username.charAt(0).toUpperCase() + username.slice(1);

        const quoted = originalMessage.content
            .split('\n')
            .map(line => `> ${line}`)
            .join('\n');

        const content = `# Ancient quote from the past!\n${quoted}\n-# ***${capitalized}***`;

        const messageUrl = `https://discord.com/channels/${guild.id}/${quote.channelId}/${quote.id}`;
        const viewButton = new ButtonBuilder()
            .setLabel('View original')
            .setStyle(ButtonStyle.Link)
            .setURL(messageUrl);

        const row = new ActionRowBuilder().addComponents(viewButton);

        await channel.send({
            content,
            components: [row],
            allowedMentions: { parse: [] }
        });

        console.log(`Quote posted successfully to ${channel.name} (${channel.id}) (from user ${username})`);
    } catch (err) {
        console.error('Error posting quote:', err.message);
    }
}

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

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);

    for (const [guildId, guild] of readyClient.guilds.cache) {
        if (!serverIds.includes(guildId)) {
            console.warn(`[Security] Bot found in unauthorized server: "${guild.name}" (${guildId}). Leaving...`);
            try {
                await guild.leave();
                console.log(`[Security] Successfully left "${guild.name}"`);
            } catch (err) {
                console.error(`[Security] Failed to leave server "${guild.name}":`, err.message);
            }
        }
    }

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        await rest.put(
            Routes.applicationGuildCommands(readyClient.user.id, serverIds[0]),
            { body: [setupCommandFox.toJSON(), scheduleCommandFox.toJSON(), setupCommandCat.toJSON(), scheduleCommandCat.toJSON(), setupCommandQOTD.toJSON(), scheduleCommandQOTD.toJSON(), setupCommandQuote.toJSON(), scheduleCommandQuote.toJSON()] }
        );
        console.log('Slash commands registered to guild instantly!');
    } catch (err) {
        console.error('Failed to register commands:', err);
    }

    if (serverIds[1]) {
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
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: [privacyCommand.toJSON()] }
        );
        console.log('Privacy command registered globally!');
    } catch (err) {
        console.error('Failed to register privacy command globally:', err);
    }

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

client.on(Events.GuildCreate, async (guild) => {
    if (!serverIds.includes(guild.id)) {
        console.warn(`[Security] Bot invited to unauthorized server: "${guild.name}" (${guild.id}). Leaving...`);
        try {
            await guild.leave();
            console.log(`[Security] Successfully left "${guild.name}"`);
        } catch (err) {
            console.error(`[Security] Failed to leave server "${guild.name}":`, err.message);
        }
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const isOwner = ownerIds && ownerIds.split(',').map(id => id.trim()).includes(String(interaction.user.id));
    const { commandName } = interaction;

    if (commandName === 'privacy') {
        const contactMention = specialUserIds[0] ? `<@${specialUserIds[0]}>` : 'the bot owner';

        const privacyNotice =
            `## Privacy & Data Notice\n\n` +
            `This bot processes public text channel activity to post scheduled content and "ancient quotes".\n\n` +
            `**What we store:**\n` +
            `• Discord Snowflakes (Message ID, Channel ID, and User ID). **We do not store message text on disk.**\n` +
            `• Data references are cached locally for up to 14 days and resolved live via the Discord API.\n\n` +
            `**Direct Messages & Pings:**\n` +
            `• Direct messages (DMs) sent to the bot are printed to the console terminal for operational and feedback monitoring.\n\n` +
            `**Your rights:**\n` +
            `• You may request a copy of any stored data relating to you.\n` +
            `• You may request full deletion of your messages from our system.\n` +
            `• You may object to your messages being used for quotes; we will exclude them from future quote posts.\n\n` +
            `To exercise any of these rights, please contact ${contactMention}.`;

        return interaction.reply({
            content: privacyNotice,
            ephemeral: true
        });
    }

    if (!isOwner) {
        return interaction.reply({
            content: 'You are such a **baaaad** *girl/boy/paw*~. Go fetch me some water to splash you with.',
            ephemeral: false
        });
    }

    if (commandName === 'setupfox') {
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

    if (commandName === 'schedulefox') {
        const cronExpression = interaction.options.getString('cron').trim();

        if (!cron.validate(cronExpression)) {
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

    if (commandName === 'setupcat') {
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

    if (commandName === 'schedulecat') {
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

    if (commandName === 'setupqotd') {
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

    if (commandName === 'scheduleqotd') {
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

    if (commandName === 'setupquote') {
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

    if (commandName === 'schedulequote') {
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

    if (commandName === 'test') {
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

});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    if (config.qotdLastMessageId && config.qotdLastChannelId === message.channel.id) {
        if (!qotdResendTimer) {
            qotdResendTimer = setTimeout(async () => {
                qotdResendTimer = null;
                try {
                    const qotdMessage = await message.channel.messages.fetch(config.qotdLastMessageId);

                    if (qotdMessage) {
                        await qotdMessage.delete();

                        const newQotdMessage = await message.channel.send({
                            content: qotdMessage.content,
                            allowedMentions: { parse: [] }
                        });

                        config.qotdLastMessageId = newQotdMessage.id;
                        memory.qotd.lastMessageId = newQotdMessage.id;
                        saveMemory(memory);
                    }
                } catch (err) {
                    console.warn('Failed to resend QOTD:', err.message);
                    if (err.code === 10008) {
                        config.qotdLastMessageId = null;
                        memory.qotd.lastMessageId = null;
                        saveMemory(memory);
                    }
                }
            }, 10000);
        }
    }

    if (message.channel.type === ChannelType.DM) {
        console.log(`[DM Received] From: ${message.author.tag} (${message.author.id}) at ${new Date().toLocaleString()}: ${message.content}`);

        let responseArray = BOT_PING_RESPONSES;
        
        if (SPECIAL_USER_RESPONSES[message.author.id]) {
            responseArray = SPECIAL_USER_RESPONSES[message.author.id];
        }
        
        const randomResponse = responseArray[Math.floor(Math.random() * responseArray.length)];
        await message.reply(`${randomResponse}\n-# {Messages here are being logged for operational and feedback purposes.}`);

        console.log(`[DM Response] To: ${message.author.tag} (${message.author.id}) at ${new Date().toLocaleString()}: ${randomResponse}`);
        return;
    }

    if (message.content.toLowerCase().includes('snaw wee')) {
        await message.reply("you fool. you absolute buffoon. you think you can challenge me in my own realm? " +
            "you think you can rebel against my authority? you dare come into my house and upturn my dining chairs " +
            "and spill coffee grounds in my Keurig? you thought you were safe in your chain mail armor behind that screen of yours. " +
            "I will take these laminate wood floor boards and destroy you. I didn't want a war, but I didn't start it.");
        return;
    }

    if (message.mentions.users.has(client.user.id)) {
        let responseArray = BOT_PING_RESPONSES;
        
        if (SPECIAL_USER_RESPONSES[message.author.id]) {
            responseArray = SPECIAL_USER_RESPONSES[message.author.id];
        }
        
        const randomResponse = responseArray[Math.floor(Math.random() * responseArray.length)];
        await message.reply(randomResponse);
    }
});

client.login(token).catch(err => {
    console.error('Failed to log in:', err.message);
    process.exit(1);
});