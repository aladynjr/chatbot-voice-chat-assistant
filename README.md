# Voice Chat Assistant for ChatGPT

A Chrome extension that adds voice chat capabilities to ChatGPT, allowing users to speak their messages and hear AI responses in near real-time using ElevenLabs' text-to-speech technology.

🌐 **Visit [voicechatassistant.web.app](https://voicechatassistant.web.app) for more information.**

## Features

- 🎙️ Voice input for messages
- 🔊 Natural text-to-speech responses
- 💬 Real-time streaming of responses
- 🎵 Audio queue management
- 🔄 "Over" command to send messages
- ⏯️ Play/pause/stop controls
- 🔑 Easy API key management

## Installation

### Option 1: Chrome Web Store
1. Visit the [Chrome Web Store](https://chrome.google.com/webstore/detail/voice-chat-assistant-for-c/YOUR_ID)
2. Click "Add to Chrome"
3. Follow the prompts to install

### Option 2: Local Installation
1. Clone this repository:
   ```bash
   git clone https://github.com/aladynjr/chatbot-voice-chat-assistant.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Setup

1. Get an ElevenLabs API key:
   - Visit [elevenlabs.io](https://elevenlabs.io)
   - Create an account (includes free tier with 10,000 characters/month)
   - Go to your profile settings
   - Copy your API key

2. Configure the extension:
   - Click the extension icon in Chrome
   - Paste your ElevenLabs API key
   - Click "Save Key"

## Usage

1. Visit [chat.openai.com](https://chat.openai.com)
2. Click "Activate Voice Chat" button in the bottom right
3. Start speaking your message
4. Say "over" to send the message
5. Listen to ChatGPT's voice response
6. Use the microphone icon to toggle voice input
7. Use the control button to stop audio playback

## Technical Stack

The extension consists of several key components:

- `manifest.json`: Extension configuration and permissions
- `content.js`: Main extension logic and UI
- `interceptor.js`: Response stream handling
- `popup.html/js`: API key configuration interface
- `background.js`: Background service worker

## Permissions

The extension requires the following permissions:
- `storage`: For saving API key

## Browser Support

Currently supports:
- Google Chrome
- Chromium-based browsers (Edge, Brave, etc.)

## Contributing

Feel free to submit issues, fork the repository, and create pull requests for any improvements.

## Support

For issues or questions, reach out on Twitter: [@aladdinnjr](https://x.com/aladdinnjr)

## License

MIT License

Copyright (c) 2024

