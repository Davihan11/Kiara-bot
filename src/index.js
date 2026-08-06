require('dotenv').config({ path: './.env' });
const { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Partials, ChannelType } = require('discord.js');
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
    EMOTE_BOY,
    EMOTE_GIRL
} = process.env;

const MEMORY_FILE_PATH = path.join(__dirname, '..', 'data', 'memory.json');

const QOTD_API_URL = 'https://api.harys.is-a.dev/v1/qotd';

const PRIORITY_QOTDS = [
    'What is your biggest addiction?'
];

axios.defaults.headers.common['User-Agent'] = `DiscordBot/Kiara-bot 1.0 (by ${BOT_EMAIL})`;
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
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
    'Kraaa ARAAAA KRAAA BARK!'
];

async function fetchPastDMs(userId) {
    try {
        const user = await client.users.fetch(userId);
        const dmChannel = await user.createDM();
        const messages = await dmChannel.messages.fetch({ limit: 50 });
        console.log(`--- Message history with the user: ${user.tag} ---`);
        messages.reverse().forEach(msg => {
            if (msg.author.bot) return;
            console.log(`[${msg.createdAt.toLocaleString()}] ${msg.author.tag}: ${msg.content}`);
        });
    } catch (error) {
        console.error(`Failed to load past DMs for user ${userId}:`, error);
    }
}

const specialUserIds = SPECIAL_USER_IDS ? SPECIAL_USER_IDS.split(',').map(id => id.trim()) : [];
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
        qotd: { channelId: QOTD_CHANNEL_ID, schedule: '0 14 * * *', lastChannelId: null, lastMessageId: null }
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

const memory = loadMemory();

const config = {
    channelIdFox: memory.fox.channelId || null,
    scheduleFox: memory.fox.schedule || null,
	channelIdCat: memory.cat.channelId || null,
	scheduleCat: memory.cat.schedule || null,
    channelIdQOTD: memory.qotd.channelId || null,
    scheduleQOTD: memory.qotd.schedule || null,
    qotdLastChannelId: memory.qotd.lastChannelId || null,
    qotdLastMessageId: memory.qotd.lastMessageId || null
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




let currentCronJobFox = null;
let currentCronJobCat = null;
let currentCronJobQOTD = null;

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

        const content = `GOAT OF THE MORNING\nAuthor: ${data.author}\nSource: ${data.source}\nDescription: ${data.description}`;

        await channel.send({
            content,
            files: [{ attachment: data.imageUrl, name: 'fox.jpg' }]
        });
        console.log(`Fox posted successfully to ${channel.id}`);
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

        const content = `GOAT OF THE EVENING\nAuthor: ${data.author}\nSource: ${data.source}\nDescription: ${data.description}`;

        await channel.send({
            content,
            files: [{ attachment: data.imageUrl, name: 'cat.jpg' }]
        });
        console.log(`Cat posted successfully to ${channel.id}`);
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
            const question = PRIORITY_QOTDS.shift();
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

        const headerContent = `<@&${QOTD_ROLE_ID}>\n\nQUESTION OF THE DAY\n\n${data.question}\n\n-# Have any suggestions for future questions? DM <@${QOTD_FEEDBACK_USER_ID}>!`;
        
        await channel.send({
            content: headerContent,
        });

        const newMessage = await channel.send({
            content: `--------------------------\n\n${data.question}`,
            allowedMentions: { parse: [] }
        });
        
        config.qotdLastChannelId = config.channelIdQOTD;
        config.qotdLastMessageId = newMessage.id;
        memory.qotd.lastChannelId = config.channelIdQOTD;
        memory.qotd.lastMessageId = newMessage.id;
        saveMemory(memory);
        
        console.log(`QOTD posted successfully to ${channel.id} (question message ID: ${newMessage.id})`);
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

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    
    console.log(`Bot je online jako ${readyClient.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        await rest.put(
            Routes.applicationGuildCommands(readyClient.user.id, SERVER_ID),
            { body: [setupCommandFox.toJSON(), scheduleCommandFox.toJSON(), setupCommandCat.toJSON(), scheduleCommandCat.toJSON(), setupCommandQOTD.toJSON(), scheduleCommandQOTD.toJSON()] }
        );
        console.log('Slash commands registered to guild instantly!');
    } catch (err) {
        console.error('Failed to register commands:', err);
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
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const isOwner = ownerIds && ownerIds.split(', ').map(id => id.trim()).includes(String(interaction.user.id));

    if (!isOwner) {
        console.warn(`Unauthorized access attempt to /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id})`);
        return interaction.reply({
            content: 'You are such a **baaaad** *girl/boy/paw*~. Go fetch me some water to splash you with.',
            ephemeral: false
        });
    }

    const { commandName } = interaction;

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


});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    if (config.qotdLastMessageId && config.qotdLastChannelId === message.channel.id) {
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
        }
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

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    
    if (message.channel.type === ChannelType.DM) {
        console.log(`[DM Received] From: ${message.author.tag} (${message.author.id}) at ${new Date().toLocaleString()}: ${message.content}`);
        
        let responseArray = BOT_PING_RESPONSES;
        
        if (SPECIAL_USER_RESPONSES[message.author.id]) {
            responseArray = SPECIAL_USER_RESPONSES[message.author.id];
        }
        
        const randomResponse = responseArray[Math.floor(Math.random() * responseArray.length)];
        await message.reply(randomResponse);
        
        console.log(`[DM Response] To: ${message.author.tag} (${message.author.id}): ${randomResponse}`);
    }
});

client.login(token);