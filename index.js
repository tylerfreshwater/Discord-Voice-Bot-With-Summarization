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

const TOKEN = process.env.DISCORD_TOKEN;

// Configuration variables
const SUMMARY_INTERVAL_MINUTES = 10; // Set the interval in minutes (e.g., 0.5 = 30 seconds)
const SUMMARY_INTERVAL_MS = SUMMARY_INTERVAL_MINUTES * 60 * 1000; // Convert minutes to milliseconds

// Summarization configuration
const OPENAI_MODEL = 'gpt-4o'; // Set the OpenAI model to use
const SYSTEM_PROMPT = 'You are a helpful assistant that summarizes a conversation between multiple speakers.'; // System prompt template
const USER_PROMPT = 'Please summarize the following text:\n\n{TRANSCRIPTION}'; // User prompt template

// State to track continuous listening
let listening = false;

async function convertToMp3(inputFile, outputFile) {
  console.log(`🔄 Converting ${inputFile} to MP3...`);

  if (!fs.existsSync(inputFile)) {
    console.error(`🚨 Input file does not exist: ${inputFile}`);
    throw new Error(`Input file ${inputFile} not found.`);
  }

  return new Promise((resolve, reject) => {
    ffmpeg(inputFile)
      .setFfmpegPath(ffmpegPath)
      .inputFormat('s16le') // Raw PCM format
      .audioChannels(1)     // Mono
      .audioFrequency(16000) // 16 kHz
      .outputOptions('-ar', '16000') // Set audio sample rate
      .outputOptions('-ac', '1')     // Set audio channels
      .outputOptions('-b:a', '16k')  // Set very low bitrate for maximum compression
      .outputOptions('-acodec', 'libmp3lame') // Use MP3 LAME codec
      .outputOptions('-compression_level', '9') // Maximum compression
      .toFormat('mp3')
      .output(outputFile)
      .on('start', (command) => {
        console.log(`🔧 FFmpeg command: ${command}`);
      })
      .on('end', () => {
        console.log(`✅ Successfully converted ${inputFile} to ${outputFile}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`🚨 Error converting to MP3:`, err);
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
    // Read the entire file into a buffer first
    const fileBuffer = await fs.promises.readFile(fileName);
    console.log(`📊 File size being sent to OpenAI: ${fileBuffer.length} bytes`);

    try {
      // First try with Blob and File APIs
      const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });
      const file = new File([blob], fileName.split('/').pop(), { type: 'audio/mpeg' });
      
      const response = await openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
        response_format: 'text',
      });
      
      console.log(`✅ Transcription received.`);
      return response;
    } catch (fileError) {
      // If File/Blob APIs fail, try with buffer directly
      console.log(`ℹ️ File API not available, trying with buffer...`);
      const response = await openai.audio.transcriptions.create({
        file: fileBuffer,
        model: 'whisper-1',
        response_format: 'text',
      });
      
      console.log(`✅ Transcription received.`);
      return response;
    }
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
      store: true,
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

async function getFileSize(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.size;
  } catch (error) {
    console.error(`Error getting file size for ${filePath}:`, error);
    return 0;
  }
}

async function cleanupFiles(...files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        await fs.promises.unlink(file);
        console.log(`🧹 Cleaned up ${file}`);
      }
    } catch (error) {
      console.error(`Error cleaning up ${file}:`, error);
    }
  }
}

async function sendLongMessage(channel, content) {
  const DISCORD_MAX_LENGTH = 1900; // Leave some room for formatting
  
  // Split the content into chunks while preserving paragraphs
  const paragraphs = content.split('\n\n');
  let currentChunk = '';
  let partNumber = 1;
  const totalParts = Math.ceil(content.length / DISCORD_MAX_LENGTH);

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed the limit, send the current chunk
    if ((currentChunk + paragraph).length > DISCORD_MAX_LENGTH) {
      if (currentChunk) {
        await channel.send(`Part ${partNumber}/${totalParts}:\n${currentChunk.trim()}`);
        partNumber++;
        currentChunk = '';
      }
      
      // If the paragraph itself is too long, split it
      if (paragraph.length > DISCORD_MAX_LENGTH) {
        const words = paragraph.split(' ');
        let tempChunk = '';
        
        for (const word of words) {
          if ((tempChunk + word).length > DISCORD_MAX_LENGTH) {
            await channel.send(`Part ${partNumber}/${totalParts}:\n${tempChunk.trim()}`);
            partNumber++;
            tempChunk = word + ' ';
          } else {
            tempChunk += word + ' ';
          }
        }
        currentChunk = tempChunk;
      } else {
        currentChunk = paragraph + '\n\n';
      }
    } else {
      currentChunk += paragraph + '\n\n';
    }
  }

  // Send any remaining content
  if (currentChunk.trim()) {
    await channel.send(`Part ${partNumber}/${totalParts}:\n${currentChunk.trim()}`);
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
        const mp3FileName = `audio-combined.mp3`;

        // Combine all chunks into a single buffer
        const finalBuffer = Buffer.concat(audioBuffer || []);
        if (finalBuffer.length > 0) {
          console.log(`✅ Saving audio to ${pcmFileName}`);
          const writeStream = createWriteStream(pcmFileName);
          writeStream.write(finalBuffer);

          // Wait for the write stream to finish before proceeding
          writeStream.on('finish', async () => {
            console.log(`✅ Audio saved to ${pcmFileName}`);

            try {
              const pcmSize = await getFileSize(pcmFileName);
              console.log(`📊 PCM file size: ${pcmSize} bytes`);

              // Convert PCM to MP3 with maximum compression
              await convertToMp3(pcmFileName, mp3FileName);
              const mp3Size = await getFileSize(mp3FileName);
              console.log(`📊 MP3 file size: ${mp3Size} bytes`);

              // Clean up PCM file immediately
              await cleanupFiles(pcmFileName);

              if (mp3Size > 25 * 1024 * 1024) {
                throw new Error(`MP3 file size (${mp3Size} bytes) exceeds OpenAI's 25MB limit`);
              }

              // Transcribe the MP3 file using Whisper
              const transcription = await transcribeAudio(mp3FileName);

              // Clean up MP3 file after transcription
              await cleanupFiles(mp3FileName);

              // Summarize the transcription
              const summary = await summarizeTranscription(transcription);
              if (summary) {
                const fullMessage = `Summary for the last ${SUMMARY_INTERVAL_MINUTES} minutes:\n${summary}`;
                await sendLongMessage(message.channel, fullMessage);
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

client.login(TOKEN);
