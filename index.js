require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { createWriteStream } = require('fs');
const prism = require('prism-media');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const OpenAI = require('openai');

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configuration variables
const SUMMARY_INTERVAL_MINUTES = 10; // Set the interval in minutes (e.g., 0.5 = 30 seconds)
const SUMMARY_INTERVAL_MS = SUMMARY_INTERVAL_MINUTES * 60 * 1000; // Convert minutes to milliseconds

// Summarization configuration
const OPENAI_MODEL = 'gpt-4o'; // Set the OpenAI model to use
const SYSTEM_PROMPT = 'You are a helpful assistant that summarizes a conversation between multiple speakers.'; // System prompt
const USER_PROMPT = 'Summarize the following text delimited by triple backticks:\n\n```{TRANSCRIPTION}```'; // User prompt template

// State to track continuous listening
let listening = false;

async function convertToWav(inputFile, outputFile) {
  console.log(`🔄 Converting ${inputFile} to ${outputFile}...`);

  if (!fs.existsSync(inputFile)) {
    console.error(`🚨 Input file does not exist: ${inputFile}`);
    throw new Error(`Input file ${inputFile} not found.`);
  }

  return new Promise((resolve, reject) => {
    ffmpeg(inputFile)
      .setFfmpegPath(ffmpegPath)
      .inputFormat('s16le') // Raw PCM format
      .audioChannels(1)     // Mono
      .audioFrequency(16000) // Down-sample to 16 kHz
      .outputOptions('-ar', '16000') // Set audio sample rate
      .outputOptions('-ac', '1')     // Set audio channels
      .output(outputFile)
      .on('start', (command) => {
        console.log(`🔧 FFmpeg command: ${command}`);
      })
      .on('end', () => {
        console.log(`✅ Successfully converted ${inputFile} to ${outputFile}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`🚨 Error converting ${inputFile}:`, err);
        reject(err);
      })
      .run();
  });
}

async function transcribeAudio(fileName) {
  console.log(`📤 Preparing ${fileName} for transcription...`);

  if (!fs.existsSync(fileName)) {
    console.error(`🚨 File does not exist: ${fileName}`);
    throw new Error(`File ${fileName} not found.`);
  }

  try {
    const fileStream = fs.createReadStream(fileName);
    console.log(`📤 Sending ${fileName} to OpenAI Whisper...`);

    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      response_format: 'text',
    });

    console.log(`✅ Transcription received.`);
    return response; // Returns the transcription text
  } catch (error) {
    console.error(`🚨 Error during transcription:`, error);
    throw error;
  }
}

async function summarizeTranscription(transcription) {
  console.log(`📖 Summarizing transcription...`);

  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: USER_PROMPT.replace('{TRANSCRIPTION}', transcription),
        },
      ],
      max_tokens: 4096,
    });

    const summary = response.choices[0].message.content.trim();
    console.log(`✅ Summary created.`);
    return summary;
  } catch (error) {
    console.error(`🚨 Error during summarization:`, error);
    throw error;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('ready', () => {
  console.log(`🤖 Bot is ready! Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.content === '!join') {
    if (!message.member.voice.channel) {
      return message.reply('❌ You need to be in a voice channel to use this command.');
    }

    const voiceChannel = message.member.voice.channel;

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      message.reply(`🎙️ Successfully joined **${voiceChannel.name}**!`);
      listening = true;

      const receiver = connection.receiver;
      receiver.subscriptions = new Map(); // Map to track active streams

      let audioBuffer = []; // Combined buffer for all speakers

      // Continuous summarization based on the customizable interval
      const summarizeInterval = setInterval(async () => {
        if (!listening) {
          clearInterval(summarizeInterval);
          return;
        }

        const pcmFileName = `raw-audio-combined.pcm`;
        const wavFileName = `audio-combined.wav`;

        // Combine all chunks into a single buffer
        const finalBuffer = Buffer.concat(audioBuffer || []);
        if (finalBuffer.length > 0) {
          console.log(`✅ Saving audio to ${pcmFileName}`);
          const writeStream = createWriteStream(pcmFileName);
          writeStream.write(finalBuffer);

          // Wait for the write stream to finish before proceeding
          writeStream.on('finish', async () => {
            console.log(`✅ Audio saved to ${pcmFileName}`);

            // Convert to WAV
            try {
              await convertToWav(pcmFileName, wavFileName);
              console.log(`🎉 Conversion complete! WAV file saved as ${wavFileName}`);

              // Transcribe the WAV file using Whisper
              const transcription = await transcribeAudio(wavFileName);

              // Summarize the transcription
              const summary = await summarizeTranscription(transcription);
              if (summary) {
                message.channel.send(
                  `Summary for the last ${SUMMARY_INTERVAL_MINUTES} minutes:\n${summary}`
                );
              } else {
                message.channel.send(`⚠️ Summarization failed.`);
              }
            } catch (err) {
              console.error(`❌ Failed to process ${pcmFileName}:`, err);
            }
          });

          writeStream.end();

          // Clear buffer for the next interval
          audioBuffer = [];
        }
      }, SUMMARY_INTERVAL_MS);

      receiver.speaking.on('start', (userId) => {
        console.log(`🎤 Starting audio capture for user ID: ${userId}`);

        // Avoid attaching multiple listeners for the same user
        if (receiver.subscriptions.has(userId)) {
          console.log(`ℹ️ Already capturing audio for user ID: ${userId}`);
          return;
        }

        // Subscribe to the user's audio stream
        const audioStream = receiver.subscribe(userId, { end: 'manual' });
        audioStream.setMaxListeners(20); // Avoid max listener warnings

        const decoder = new prism.opus.Decoder({
          rate: 48000, // Discord's default sample rate
          channels: 1,
          frameSize: 960,
        });

        audioStream.pipe(decoder).on('data', (chunk) => {
          audioBuffer.push(chunk); // Add audio chunks to the buffer
        });

        // When the audio stream ends, clean up
        audioStream.on('end', () => {
          console.log(`🛑 Audio stream for user ID: ${userId} ended.`);
          audioStream.removeAllListeners(); // Explicitly remove listeners
          audioStream.destroy(); // Clean up the stream
          receiver.subscriptions.delete(userId); // Remove the stream from tracking
        });

        receiver.subscriptions.set(userId, audioStream);
      });

      receiver.speaking.on('end', (userId) => {
        console.log(`🛑 Stopping audio capture for user ID: ${userId}`);
        const audioStream = receiver.subscriptions.get(userId);

        if (audioStream) {
          audioStream.removeAllListeners(); // Remove all listeners
          audioStream.destroy(); // Clean up the stream
          receiver.subscriptions.delete(userId); // Remove from tracking
        }
      });
    } catch (error) {
      console.error('❌ Failed to join voice channel:', error);
      message.reply('❌ Failed to join the voice channel.');
    }
  }

  if (message.content === '!leave') {
    listening = false;

    const connection = getVoiceConnection(message.guild.id);
    if (connection) {
      connection.destroy();
      console.log('🛑 Successfully left the voice channel');
      message.reply('🛑 Left the voice channel!');
    } else {
      console.log('❌ No active connection found.');
      message.reply('❌ I am not currently in a voice channel.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);