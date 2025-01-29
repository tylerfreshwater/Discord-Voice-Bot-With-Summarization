# Discord Voice Bot with Summarization

This is a **Discord Bot** that joins a voice channel, listens to conversations, transcribes the audio using OpenAI Whisper, and summarizes the transcription using OpenAI GPT. The bot continuously listens, summarizes every set interval, and posts the summaries into a Discord text channel.

## Table of Contents
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Adding the Bot to a Server](#adding-the-bot-to-a-server)
- [Usage](#usage)
- [Customizing the Bot](#customizing-the-bot)
- [Debugging](#debugging)
- [License](#license)

## Features
- **Audio Capture**: Captures audio from all speakers in the voice channel
- **Transcription**: Converts audio to text using OpenAI Whisper
- **Summarization**: Summarizes transcriptions using OpenAI GPT (customizable prompts and model)
- **Customizable Intervals**: Easily configure summarization frequency
- **Multispeaker Support**: Handles multiple speakers simultaneously
- **Real-time Summaries**: Posts summaries directly to a Discord text channel

## Requirements

### Node.js
1. Install Node.js (version 16 or higher recommended)
2. Confirm installation:
```bash
node -v
npm -v
```

---

### FFmpeg
Install FFmpeg, which is required for converting PCM audio to WAV format.  
Add FFmpeg to your system PATH:
- **Windows**: Follow [this guide](https://www.wikihow.com/Install-FFmpeg-on-Windows).
- **MacOS/Linux**: Install via Homebrew or your package manager:
  ```bash
  brew install ffmpeg
  ```

---

### Discord Bot Token

1. Create a Bot:
   - Go to the [Discord Developer Portal](https://discord.com/developers/applications).
   - Click New Application and give your bot a name.
   - Go to the Bot section and click Add Bot.

2. Enable the following Privileged Gateway Intents:
   - Message Content Intent
   - Server Members Intent
3. Click Reset Token and copy the new Token.

---

### Discord Text Channel ID

1. Open Discord and go to the text channel where you want the bot to post summaries.

2. Enable Developer Mode:
   - Go to Settings > Advanced > Developer Mode and toggle it on.

3. Right-click on the text channel and select Copy ID.

---

### OpenAI API Key

1. Create an Account:
   - Sign up or log in to [OpenAI](https://platform.openai.com).

2. Generate an API Key:
   - Go to the API settings and generate your API key.

## Adding the Bot to a Server
1. Go to the **OAuth2** section in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **OAuth2 > URL Generator**:
   - Select scopes: `bot`, `applications.commands`
   - Under **Bot Permissions**, enable:
     - Send Messages
     - Connect
     - Speak
     - Read Message History
     - Use Voice Activity
3. Copy the generated URL and paste it into your browser.
4. Invite the bot to your server.

## Installation

1. **Clone the repository:**

```bash
git clone https://github.com/tylerfreshwater/Discord-Voice-Bot-With-Summarization.git
cd Discord-Voice-Bot-With-Summarization
```

2. **If you're starting a fresh project:**
```bash
npm init -y
```

3. **Install dependencies:**

```bash
npm install
```

4. **Create a .env file in the project directory:**
```bash
touch .env
```

5. **Add the following environment variables to .env:**
```bash
DISCORD_TOKEN = your_discord_bot_token
OPENAI_API_KEY = your_openai_api_key
CHANNEL_ID = your_discord_text_channel_id
```

6. **Run the bot:**
```bash
node index.js
```

## Usage

### Commands

#### Join a Voice Channel
```bash
!join
```
The bot will join your current voice channel and start listening.

#### Leave the Voice Channel
```bash
!leave
```
The bot will stop listening and leave the voice channel

# Customizing the Bot

## Configuration Variables

All customizable settings are located at the top of the `index.js` file:

| Variable                  | Description                           | Default Value       |
|---------------------------|---------------------------------------|---------------------|
| `SUMMARY_INTERVAL_MINUTES` | Time interval for summarization in minutes      | `10`   |
| `OPENAI_MODEL`            | OpenAI model to use                   | `gpt-4o`             |
| `SYSTEM_PROMPT`           | System prompt for summarizer          | See below           |
| `USER_PROMPT`    | User prompt for summarizer              | See below           |



## Example Prompts

### `SYSTEM_PROMPT`:
```plaintext
You are a helpful assistant that summarizes a conversation between multiple speakers.
```

### `USER_PROMPT`:
```plaintext
Summarize the following text:
{TRANSCRIPTION}
```

## Debugging

### Common Issues:

#### Bot Doesn't Join Voice Channel:
- Ensure you are in a voice channel before using `!join`

#### Bot Doesn't Summarize:
- Check that your OpenAI API key is valid
- Ensure sufficient permissions for the bot

#### PCM/WAV Conversion Issues:
- Ensure FFmpeg is installed and in `PATH`

## License

This project is licensed under the **MIT License**. See the [`LICENSE`](LICENSE) file for details.
