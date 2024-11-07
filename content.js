const script = document.createElement('script');
script.src = chrome.runtime.getURL('interceptor.js');
(document.head || document.documentElement).appendChild(script);

const state = {
    isEnabled: false,
    isRecording: false,
    recognition: null,
    isRecognitionActive: false,
    currentSequence: 0,
};

const BUTTONS = {
    CONTROL: {
        states: {
            PLAYING: {
                text: 'Pause Voice Chat',
                icon: `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                `,
                style: 'background-color: #ffcc00; color: #ffffff;'
            },
            ENABLED: {
                text: 'Voice Chat Active',
                icon: `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" />
                    </svg>
                `,
                style: 'background-color: #0066ff; color: #ffffff;'
            },
            DISABLED: {
                text: 'Start Voice Chat',
                icon: `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" />
                    </svg>
                `,
                style: 'background-color: #f0f0f0; color: #666666;'
            }
        },
        baseStyle: `
            padding: 12px 20px;
            border: 1px solid #cccccc;
            border-radius: 28px;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            letter-spacing: -0.01em;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        `
    },
    MIC: {
        states: {
            ACTIVE: {
                icon: `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor">
                            <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite"/>
                        </path>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
                    </svg>
                `,
                style: 'background-color: rgba(255, 68, 68, 0.1); color: #ff4444;'
            },
            INACTIVE: {
                icon: `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
                    </svg>
                `,
                style: 'background-color: transparent; color: #8e8ea0;'
            }
        },
        baseStyle: `
            background: transparent;
            border: none;
            padding: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 8px;
            border-radius: 6px;
            transition: all 0.2s ease;
        `
    }
};

class AudioQueue {
    constructor() {
        this.queue = [];
        this.isPlaying = false;
        this.currentAudio = null;
        this.audioWrapper = null;
    }

    initialize() {
        this.createAudioWrapper();
    }

    createAudioWrapper() {
        if (!this.audioWrapper) {
            this.audioWrapper = document.createElement('div');
            this.audioWrapper.className = 'tts-audio-wrapper';
            this.audioWrapper.style.cssText = `
                position: fixed;
                bottom: 80px;
                right: 20px;
                z-index: 10000;
                max-height: 300px;
                overflow-y: auto;
                background: #f9f9f9;
                padding: 10px;
                border-radius: 5px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                display: none;
            `;
            document.body.appendChild(this.audioWrapper);
        }
    }

    async enqueue(audioElement) {
        this.queue.push(audioElement);
        await this.playNext();
    }

    async playNext() {
        if (this.isPlaying || this.queue.length === 0) return;

        this.isPlaying = true;
        this.currentAudio = this.queue.shift();
        
        this.currentAudio.onended = () => {
            console.log('Audio ended, playing next');
            this.isPlaying = false;
            this.currentAudio = null;
            this.playNext();
            
            const controlButton = document.getElementById('voice-chat-control-button');
            if (controlButton && this.queue.length === 0) {
                updateButtonAppearance(controlButton, false, state.isEnabled);
            }
        };

        this.currentAudio.onerror = () => {
            console.error('Error playing audio');
            this.isPlaying = false;
            this.currentAudio = null;
            this.playNext();
        };
        
        try {
            await this.currentAudio.play();
            const controlButton = document.getElementById('voice-chat-control-button');
            if (controlButton) {
                updateButtonAppearance(controlButton, true, state.isEnabled);
            }
        } catch (error) {
            console.error('Error playing audio:', error);
            this.isPlaying = false;
            this.currentAudio = null;
            this.playNext();
        }
    }

    handleAudioEnd(audioContainer, blobUrl, sequence) {
        audioContainer.style.backgroundColor = '#e6ffe6';
        setTimeout(() => {
            audioContainer.remove();
            URL.revokeObjectURL(blobUrl);
            console.log(`Audio sequence ${sequence} container removed.`);
        }, 1000);
    }

    stopAll() {
        this.queue = [];
        this.isPlaying = false;
        
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        
        if (this.audioWrapper) {
            const audioElements = this.audioWrapper.querySelectorAll('audio');
            audioElements.forEach(audio => {
                audio.pause();
                if (audio.src) {
                    URL.revokeObjectURL(audio.src);
                }
                audio.parentElement?.remove();
            });
        }

        const controlButton = document.getElementById('voice-chat-control-button');
        if (controlButton) {
            updateButtonAppearance(controlButton, false, state.isEnabled);
        }
    }

    clear() {
        this.stopAll();
        if (this.audioWrapper) {
            this.audioWrapper.remove();
            this.audioWrapper = null;
        }
    }
}

const audioQueue = new AudioQueue();

class TTSQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.isAwaitingNext = false;
        this.currentRequest = null;
    }

    async enqueue(text) {
        this.queue.push(text);
        await this.process();
    }

    async process() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const text = this.queue.shift();

        try {
            this.currentRequest = this.createSpeech(text);
            const response = await this.currentRequest;
            this.currentRequest = null;

            if (response.error || !response.sourceUrl) {
                console.error('Error processing audio:', response.error || 'No sourceUrl');
                return;
            }

            const audioElement = await this.createAudioElement(response.sourceUrl, response.sequence);
            await audioQueue.enqueue(audioElement);
        } catch (error) {
            console.error('TTS processing error:', error);
        } finally {
            this.isProcessing = false;
            this.currentRequest = null;
            if (this.queue.length > 0 && !this.isAwaitingNext) {
                await this.process();
            }
        }
    }

    async createSpeech(text) {
        return chrome.runtime.sendMessage({
            type: 'CREATE_SPEECH',
            text,
            streamId: Date.now().toString()
        });
    }

    async createAudioElement(sourceUrl, sequence) {
        const response = await fetch(sourceUrl);
        const arrayBuffer = await response.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        const blobUrl = URL.createObjectURL(blob);
    
        const audioElement = document.createElement('audio');
        audioElement.src = blobUrl;
        audioElement.controls = true;
        audioElement.dataset.streamId = sequence;
        audioElement.dataset.sequence = sequence;
        
        return audioElement;
    }

    clear() {
        this.queue = [];
        this.isProcessing = false;
        this.isAwaitingNext = false;
        this.currentRequest = null;
    }
}

const ttsQueue = new TTSQueue();

function initializeSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
        console.warn('Speech recognition not supported');
        return null;
    }

    const recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    const handleSubmission = () => {
        const messageToSend = finalTranscript
            .trim()
            .replace(/\s*over[.,!?]*\s*$/i, '')
            .trim();
        
        if (messageToSend) {
            setPromptText(messageToSend);
            setTimeout(() => {
                submitMessage();
                finalTranscript = '';
            }, 50);
        }
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
                const messageWithoutPunctuation = finalTranscript.toLowerCase().trim().replace(/[.,!?]+$/, '').trim();
                
                if (messageWithoutPunctuation.endsWith('over')) {
                    const promptDiv = document.querySelector('div.ProseMirror[contenteditable="true"]');
                    if (promptDiv) {
                        recognition.stop();
                        stopAllAudio(true);

                        const stopButton = document.querySelector('button[data-testid="stop-button"]');
                        if (stopButton) {
                            stopButton.click();
                            setTimeout(() => {
                                setPromptText(finalTranscript.trim());
                                handleSubmission();
                            }, 1000);
                        } else {
                            setPromptText(finalTranscript.trim());
                            handleSubmission();
                        }
                        return;
                    }
                }
            } else {
                interimTranscript += transcript;
            }
        }

        setPromptText((finalTranscript + interimTranscript).trim());
    };

    recognition.onstart = () => {
        state.isRecognitionActive = true;
    };

    recognition.onend = () => {
        state.isRecognitionActive = false;
        if (state.isEnabled) {
            try {
                if (!state.isRecognitionActive) {
                    recognition.start();
                }
            } catch (error) {
                console.warn('Failed to restart recognition:', error);
            }
        }
        
        const micButton = document.querySelector('#voice-input-button');
        if (micButton) {
            const buttonState = state.isEnabled ? BUTTONS.MIC.states.ACTIVE : BUTTONS.MIC.states.INACTIVE;
            micButton.style.backgroundColor = buttonState.style.split(';')[0].split(':')[1].trim();
            micButton.style.color = buttonState.style.split(';')[1].split(':')[1].trim();
            micButton.innerHTML = buttonState.icon;
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        state.isRecognitionActive = false;
        
        if (event.error === 'no-speech' && state.isEnabled && !state.isRecognitionActive) {
            try {
                recognition.stop();
                setTimeout(() => {
                    if (state.isEnabled && !state.isRecognitionActive) {
                        recognition.start();
                    }
                }, 100);
            } catch (error) {
                console.warn('Failed to handle no-speech error:', error);
            }
        }
    };

    return recognition;
}

function setPromptText(text) {
    const promptDiv = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (promptDiv) {
        promptDiv.innerHTML = `<p>${text}</p>`;
        promptDiv.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function submitMessage() {
    const textarea = document.querySelector('#prompt-textarea');
    if (textarea) {
        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
        });
        textarea.dispatchEvent(enterEvent);
    }
}

function createMicrophoneButton() {
    const button = document.createElement('button');
    button.id = 'voice-input-button';
    button.type = 'button';
    
    const buttonState = state.isEnabled ? BUTTONS.MIC.states.ACTIVE : BUTTONS.MIC.states.INACTIVE;
    
    button.innerHTML = buttonState.icon;
    
    button.style.cssText = `
        ${BUTTONS.MIC.baseStyle}
        ${buttonState.style}
    `;

    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
        position: absolute;
        top: -40px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #1e1e1e;
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
        white-space: nowrap;
    `;
    tooltip.textContent = 'Voice input (say "over" to send)';
    button.appendChild(tooltip);

    button.onmouseenter = () => {
        button.style.backgroundColor = state.isEnabled ? 
            'rgba(255, 68, 68, 0.2)' : 'rgba(142, 142, 160, 0.1)';
        tooltip.style.opacity = '1';
    };
    button.onmouseleave = () => {
        const currentState = state.isEnabled ? BUTTONS.MIC.states.ACTIVE : BUTTONS.MIC.states.INACTIVE;
        button.style.backgroundColor = currentState.style.match(/background-color:\s*([^;]+)/)[1];
        tooltip.style.opacity = '0';
    };

    button.onclick = null;

    return button;
}

function addMicrophoneButton() {
    const formContainer = document.querySelector('form.w-full .relative.flex.h-full');
    if (!formContainer || document.getElementById('voice-input-button')) return;

    const target = document.querySelector('form.w-full button[data-testid="send-button"]');
    if (target?.parentNode) {
        target.parentNode.style.display = 'flex';
        target.parentNode.style.alignItems = 'center';
        target.parentNode.insertBefore(createMicrophoneButton(), target);
    }
}

function createControlButton() {
    if (document.getElementById('voice-chat-control-button')) {
        return null;
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 12px;
    `;

    const speechBubble = document.createElement('div');
    speechBubble.style.cssText = `
        position: absolute;
        bottom: 100%;
        right: 0;
        margin-bottom: 12px;
        background: white;
        padding: 12px 16px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        font-size: 14px;
        color: #333;
        white-space: nowrap;
        display: none;
        align-items: center;
        gap: 8px;
        animation: float 3s ease-in-out infinite;
        pointer-events: none;
    `;
    
    const styleSheet = document.createElement("style");
    styleSheet.textContent = `
        @keyframes float {
            0% {
                transform: translateY(0px);
            }
            50% {
                transform: translateY(-10px);
            }
            100% {
                transform: translateY(0px);
            }
        }
    `;
    document.head.appendChild(styleSheet);
    
    speechBubble.innerHTML = `
      <svg fill="#ffffff" width="18" height="18" viewBox="0 0 32.00 32.00" id="icon" xmlns="http://www.w3.org/2000/svg" stroke="#ffffff" stroke-width="0.00032"><g id="SVGRepo_bgCarrier" stroke-width="0"><rect x="0" y="0" width="32.00" height="32.00" rx="16" fill="#212121" strokewidth="0"></rect></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" stroke="#CCCCCC" stroke-width="0.768"></g><g id="SVGRepo_iconCarrier"> <defs> <style> .cls-1 { fill: none; } </style> </defs> <path d="M26,30H24V27H20a5.0055,5.0055,0,0,1-5-5V20.7207l-2.3162-.772a1,1,0,0,1-.5412-1.4631L15,13.7229V11a9.01,9.01,0,0,1,9-9h5V4H24a7.0078,7.0078,0,0,0-7,7v3a.9991.9991,0,0,1-.1426.5144l-2.3586,3.9312,1.8174.6057A1,1,0,0,1,17,20v2a3.0033,3.0033,0,0,0,3,3h5a1,1,0,0,1,1,1Z"></path> <rect x="19" y="12" width="4" height="2"></rect> <path d="M9.3325,25.2168a7.0007,7.0007,0,0,1,0-10.4341l1.334,1.49a5,5,0,0,0,0,7.4537Z"></path> <path d="M6.3994,28.8008a11.0019,11.0019,0,0,1,0-17.6006L7.6,12.8a9.0009,9.0009,0,0,0,0,14.4014Z"></path> <rect id="_Transparent_Rectangle_" data-name="<Transparent Rectangle>" class="cls-1" width="32" height="32"></rect> </g></svg>
        Speak, then say "over" to send message
    `;

    const arrow = document.createElement('div');
    arrow.style.cssText = `
        position: absolute;
        bottom: -6px;
        right: 20px;
        width: 12px;
        height: 12px;
        background: white;
        transform: rotate(45deg);
        box-shadow: 3px 3px 3px rgba(0,0,0,0.05);
    `;

    speechBubble.appendChild(arrow);
    buttonContainer.appendChild(speechBubble);

    const button = document.createElement('button');
    button.id = 'voice-chat-control-button';

    chrome.storage.local.get(['elevenLabsKey'], (result) => {
        const hasApiKey = result.elevenLabsKey && result.elevenLabsKey.trim() !== '';

        const getButtonContent = () => {
            if (state.isPlaying) {
                return `${BUTTONS.CONTROL.states.PLAYING.icon} ${BUTTONS.CONTROL.states.PLAYING.text}`;
            } else if (state.isEnabled) {
                return `${BUTTONS.CONTROL.states.ENABLED.icon} ${BUTTONS.CONTROL.states.ENABLED.text}`;
            }
            return `${BUTTONS.CONTROL.states.DISABLED.icon} ${BUTTONS.CONTROL.states.DISABLED.text}`;
        };

        const getButtonStyles = () => {
            if (state.isPlaying) {
                return `${BUTTONS.CONTROL.baseStyle} ${BUTTONS.CONTROL.states.PLAYING.style}`;
            } else if (state.isEnabled) {
                return `${BUTTONS.CONTROL.baseStyle} ${BUTTONS.CONTROL.states.ENABLED.style}`;
            }
            return `${BUTTONS.CONTROL.baseStyle} ${BUTTONS.CONTROL.states.DISABLED.style}`;
        };

        button.innerHTML = getButtonContent();
        button.style.cssText = getButtonStyles();

        if (!hasApiKey) {
            const tooltip = document.createElement('div');
            tooltip.style.cssText = `
                position: absolute;
                top: -40px;
                left: 50%;
                transform: translateX(-50%);
                background-color: #1e1e1e;
                color: white;
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 12px;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s ease;
                white-space: nowrap;
                z-index: 10001;
            `;
            tooltip.textContent = 'Please set your ElevenLabs API key in the extension popup';
            button.appendChild(tooltip);

            button.onmouseenter = () => tooltip.style.opacity = '1';
            button.onmouseleave = () => tooltip.style.opacity = '0';
            return;
        }

        button.onclick = () => {
            if (!hasApiKey) return;

            if (state.isPlaying) {
                stopAllAudio(true);
                return;
            }

            state.isEnabled = !state.isEnabled;

            if (!state.isEnabled) {
                stopAllAudio(false);
            } else {
                if (!state.recognition) {
                    state.recognition = initializeSpeechRecognition();
                }
                if (state.recognition && !state.isRecognitionActive) {
                    try {
                        state.recognition.start();
                    } catch (error) {
                        console.warn('Failed to start recognition:', error);
                    }
                }
            }

            updateButtonAppearance(button, false, state.isEnabled);
            speechBubble.style.display = state.isEnabled ? 'flex' : 'none';
        };

        button.onmouseenter = () => {
            if (!hasApiKey) return;
            if (state.isPlaying) return;
            button.style.backgroundColor = state.isEnabled ? '#0052cc' : '#e8e8e8';
        };

        button.onmouseleave = () => {
            if (!hasApiKey) return;
            if (state.isPlaying) return;
            button.style.backgroundColor = state.isEnabled ? '#0066ff' : '#f0f0f0';
        };

        const originalOnClick = button.onclick;
        button.onclick = () => {
            if (!hasApiKey) return;
            
            originalOnClick?.();
            
            speechBubble.style.display = state.isEnabled ? 'flex' : 'none';
        };

        speechBubble.style.display = state.isEnabled ? 'flex' : 'none';
    });

    buttonContainer.appendChild(button);
    return buttonContainer;
}

function stopAllAudio(keepEnabled = true) {
    // First stop all audio and clear queues
    audioQueue.stopAll();
    ttsQueue.clear();

    // Then clear the interceptor state with immediate flag
    window.postMessage({ 
        type: 'CLEAR_INTERCEPTOR_STATE', 
        immediate: true 
    }, '*');

    // Stop any pending requests
    chrome.runtime.sendMessage({ 
        type: 'STOP_ALL_REQUESTS' 
    });

    // Stop recognition if active
    if (state.recognition && state.isRecognitionActive) {
        state.recognition.stop();
    }

    // Update button appearance
    const controlButton = document.getElementById('voice-chat-control-button');
    if (controlButton) {
        if (keepEnabled && state.isEnabled) {
            updateButtonAppearance(controlButton, false, true);
        } else if (!keepEnabled) {
            updateButtonAppearance(controlButton, false, false);
        }
    }

    // Reset all processing flags
    state.isPlaying = false;

    // Re-enable processing after a short delay
    setTimeout(() => {
        window.postMessage({ 
            type: 'CLEAR_INTERCEPTOR_STATE', 
            immediate: false 
        }, '*');
    }, 200);
}

function enqueueTTS(text) {
    ttsQueue.enqueue(text);
}

window.addEventListener('message', async ({ data }) => {
    if (data.type === 'CHATGPT_RESPONSE' && state.isEnabled) {
        const chunk = data.chunk;
        await ttsQueue.enqueue(chunk);
    }
});

function initializeFeatures() {
    const button = createControlButton();
    if (button) {
        document.body.appendChild(button);
    }
    addMicrophoneButton();
}

const observer = new MutationObserver(() => {
    if (document.querySelector('form.w-full .relative.flex.h-full') && 
        !document.getElementById('voice-input-button')) {
        requestAnimationFrame(() => addMicrophoneButton());
    }
    
    if (!document.getElementById('voice-chat-control-button')) {
        requestAnimationFrame(() => initializeFeatures());
    }
});
    
observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
});

document.addEventListener('DOMContentLoaded', initializeFeatures);
if (document.readyState === 'complete') {
    initializeFeatures();
}

function getButtonContent(isPlaying, isEnabled) {
    if (isPlaying) {
        return `${BUTTONS.CONTROL.states.PLAYING.icon} ${BUTTONS.CONTROL.states.PLAYING.text}`;
    } else if (isEnabled) {
        return `${BUTTONS.CONTROL.states.ENABLED.icon} ${BUTTONS.CONTROL.states.ENABLED.text}`;
    }
    return `${BUTTONS.CONTROL.states.DISABLED.icon} ${BUTTONS.CONTROL.states.DISABLED.text}`;
}

function getButtonStyles(isPlaying, isEnabled) {
    if (isPlaying) {
        return `${BUTTONS.CONTROL.baseStyle} ${BUTTONS.CONTROL.states.PLAYING.style}`;
    } else if (isEnabled) {
        return `${BUTTONS.CONTROL.baseStyle} ${BUTTONS.CONTROL.states.ENABLED.style}`;
    }
    return `${BUTTONS.CONTROL.baseStyle} ${BUTTONS.CONTROL.states.DISABLED.style}`;
}

function updateButtonAppearance(button, isPlaying, isEnabled) {
    const stateKey = isPlaying ? 'PLAYING' : (isEnabled ? 'ENABLED' : 'DISABLED');
    const buttonConfig = BUTTONS.CONTROL.states[stateKey];
    button.innerHTML = `${buttonConfig.icon}${buttonConfig.text}`;
    button.style.cssText = BUTTONS.CONTROL.baseStyle + buttonConfig.style;
}

