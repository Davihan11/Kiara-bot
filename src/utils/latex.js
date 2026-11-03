const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const mathjax = require('mathjax');
const sharp = require('sharp');

const jaxPromise = mathjax.init({
  loader: {
    load: ['input/tex', 'output/svg'],
  },
});

//words that are not allowed in rendered latex (set from .env via setFilter)
let blockedWords = [];

const setFilter = (filterEnv) => {
  blockedWords = (filterEnv || '')
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(Boolean);
};

//strip latex commands/spacing tricks so words can't be hidden"
const normalize = (code) =>
  code
    .toLowerCase()
    .replace(/\\[a-z]+\*?(\[[^\]]*\])?(\{([^{}]*)\})?/gi, '$3') //keep command args, drop the command
    .replace(/[^a-z0-9]/g, ''); //drop spaces, braces, symbols

const containsBlockedWord = (code) => {
  const normalized = normalize(code);
  return blockedWords.some(word => normalized.includes(word));
};

const command = new SlashCommandBuilder()
  .setName('latex')
  .setDescription('Render latex code to an image')
  .addStringOption(option => {
    return option
      .setName('code')
      .setDescription('The code to render')
      .setRequired(true);
  })
  .addNumberOption(option => {
    return option
      .setName('brightness')
      .setDescription(
        'The brightness of the image, where 1 is white and 0 is black',
      )
      .setMinValue(0)
      .setMaxValue(1);
  })
  .addNumberOption(option => {
    return option
      .setName('scale')
      .setDescription('Scale of the image, defaults to 2')
      .setMinValue(0.1)
      .setMaxValue(5);
  });

const run = async (c, interaction) => {
  const timeStart = new Date().getTime();
  const { value: code } = interaction.options.get('code', true);
  const { value: brightness = 0.8 } = interaction.options.get('brightness') || {};
  const { value: scale = 2 } = interaction.options.get('scale') || {};

  if (containsBlockedWord(code)) {
    await interaction.editReply({
      content: 'Input contains a blocked word.',
    });
    return;
  }

  const jax = await jaxPromise;
  const svg = jax.startup.adaptor.innerHTML(
    await jax.tex2svgPromise(
      `\\color{white} \\begin{aligned} ${code} \\end{aligned}`,
      {
        display: true,
      },
    ),
  );
  const obj = sharp(Buffer.from(svg));

  const png = await obj
    .resize({
      height: Math.ceil(((await obj.metadata()).height || 16) * scale),
    })
    .modulate({ brightness })
    .png({ effort: 1 })
    .toBuffer();

  await interaction.editReply({
    embeds: [new EmbedBuilder().setImage(`attachment://rendered.png`)],
    files: [
      {
        name: 'rendered.png',
        attachment: png,
      },
    ],
  });
  console.log(`Took ${new Date().getTime() - timeStart}ms`);
};

const run_notEmbed = async (code, brightness = 1, scale = 2) => {
  const timeStart = new Date().getTime();

  if (containsBlockedWord(code)) {
    throw new Error('Input contains a blocked word.');
  }

  const jax = await jaxPromise;
  const svg = jax.startup.adaptor.innerHTML(
    await jax.tex2svgPromise(
      `\\color{white} \\begin{aligned} ${code} \\end{aligned}`,
      {
        display: true,
      },
    ),
  );
  const obj = sharp(Buffer.from(svg));

  const png = await obj
    .resize({
      height: Math.ceil(((await obj.metadata()).height || 16) * scale),
    })
    .modulate({ brightness })
    .png({ effort: 1 })
    .toBuffer();

  console.log(`Took ${new Date().getTime() - timeStart}ms`);
  return png;
};

module.exports = { command, run, run_notEmbed, setFilter };