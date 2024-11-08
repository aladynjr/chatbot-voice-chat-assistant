const script = document.createElement('script');
script.src = chrome.runtime.getURL('interceptor.js');
(document.head || document.documentElement).appendChild(script);

const state = {
    isEnabled: false,
    isRecording: false,
    recognition: null,
    isRecognitionActive: false,
    currentSequence: 0,
    currentMessageId: null,
};

const BUTTONS = {
    CONTROL: {
        states: {
            PLAYING: {
                text: 'Stop Playing Audio',
                icon: `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <rect x="6" y="4" width="4" height="16" rx="1" ry="1"></rect>
                        <rect x="14" y="4" width="4" height="16" rx="1" ry="1"></rect>
                    </svg>
                `,
                style: `
                    background: #EAB308;
                    color: #FFFFFF;
                `
            },
            ENABLED: {
                text: 'Deactivate Voice Chat',
                icon: `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                `,
                style: `
                    background: #1E293B;
                    color: #FFFFFF;
                `
            },
            DISABLED: {
                text: 'Activate Voice Chat',
                icon: `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                `,
                style: `
                    background: #FFFFFF;
                    color: #1E293B;
                    border: 1px solid #1E293B;
                `
            }
        },
        baseStyle: `
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
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
                style: `
                    background: rgba(239, 68, 68, 0.1);
                    color: rgb(239, 68, 68);
                    box-shadow: 0 2px 6px rgba(239, 68, 68, 0.2);
                `
            },
            INACTIVE: {
                icon: `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
                    </svg>
                `,
                style: `
                    background: transparent;
                    color: #1F2937;
                `
            }
        },
        baseStyle: `
            background: transparent;
            border: none;
            padding: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 8px;
            border-radius: 50%;
            transition: background 0.3s ease;
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
                background: #ffffff;
                padding: 12px;
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
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
                updateSpeechBubbleVisibility(state.isEnabled);
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
        if (!state.currentMessageId) {
            state.currentMessageId = Date.now().toString();
        }
        
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
            streamId: Date.now().toString(),
            messageId: state.currentMessageId
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
        updateMicButtonAppearance(true);
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
        updateMicButtonAppearance(state.isEnabled);
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

    button.onclick = () => {
        const controlButton = document.getElementById('voice-chat-control-button');
        if (controlButton) {
            controlButton.click();
        }
    };

    return button;
}

function addMicrophoneButton() {
    const formContainer = document.querySelector('form.w-full .relative.flex.h-full');
    if (!formContainer || document.getElementById('voice-input-button')) return;

    const target = document.querySelector('form.w-full button[data-testid="send-button"]');
    if (target?.parentNode) {
        target.parentNode.style.display = 'flex';
        target.parentNode.style.alignItems = 'center';
        const micButton = createMicrophoneButton();
        target.parentNode.insertBefore(micButton, target);
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
        background: #FFFFFF;
        padding: 12px 16px;
        border-radius: 4px;
        border: 1px solid #E5E7EB;
        font-size: 14px;
        color: #000000;
        white-space: nowrap;
        display: none;
        align-items: center;
        gap: 8px;
        pointer-events: none;
        animation: fadeIn 0.3s ease forwards;
    `;
    
    const styleSheet = document.createElement("style");
    styleSheet.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
    `;
    document.head.appendChild(styleSheet);
    
    speechBubble.innerHTML = `
     <svg fill="#22D3EE" width="18px" height="18px" viewBox="0 0 32.00 32.00" id="icon" xmlns="http://www.w3.org/2000/svg" stroke="#22D3EE" stroke-width="0.00032"><g id="SVGRepo_bgCarrier" stroke-width="0"><rect x="0" y="0" width="32.00" height="32.00" rx="5.44" fill="#1E293B" strokewidth="0"></rect></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <defs> <style> .cls-1 { fill: none; } </style> </defs> <path d="M26,30H24V27H20a5.0055,5.0055,0,0,1-5-5V20.7207l-2.3162-.772a1,1,0,0,1-.5412-1.4631L15,13.7229V11a9.01,9.01,0,0,1,9-9h5V4H24a7.0078,7.0078,0,0,0-7,7v3a.9991.9991,0,0,1-.1426.5144l-2.3586,3.9312,1.8174.6057A1,1,0,0,1,17,20v2a3.0033,3.0033,0,0,0,3,3h5a1,1,0,0,1,1,1Z"></path> <rect x="19" y="12" width="4" height="2"></rect> <path d="M9.3325,25.2168a7.0007,7.0007,0,0,1,0-10.4341l1.334,1.49a5,5,0,0,0,0,7.4537Z"></path> <path d="M6.3994,28.8008a11.0019,11.0019,0,0,1,0-17.6006L7.6,12.8a9.0009,9.0009,0,0,0,0,14.4014Z"></path> <rect id="_Transparent_Rectangle_" data-name="<Transparent Rectangle>" class="cls-1" width="32" height="32"></rect> </g></svg>

        Speak, then say "over" to send message
    `;

    const arrow = document.createElement('div');
    arrow.style.cssText = `
        position: absolute;
        bottom: -6px;
        right: 20px;
        width: 12px;
        height: 12px;
        background: #FFFFFF;
        transform: rotate(45deg);
        border-right: 1px solid #E5E7EB;
        border-bottom: 1px solid #E5E7EB;
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
                background-color: rgba(31, 41, 55, 0.9);
                color: #FFFFFF;
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 12px;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s ease;
                white-space: nowrap;
                z-index: 1001;
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
            updateSpeechBubbleVisibility(state.isEnabled);
            updateMicButtonAppearance(state.isEnabled);
        };

        button.onmouseenter = () => {
            if (!hasApiKey) return;
        };

        button.onmouseleave = () => {
            if (!hasApiKey) return;
        };

        const originalOnClick = button.onclick;
        button.onclick = () => {
            if (!hasApiKey) return;
            
            originalOnClick?.();
            
            updateSpeechBubbleVisibility(state.isEnabled);
        };

        updateSpeechBubbleVisibility(state.isEnabled);
    });

    buttonContainer.appendChild(button);
    return buttonContainer;
}

function stopAllAudio(keepEnabled = true) {
    state.currentMessageId = null;
    
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
        if (!keepEnabled) {
            state.isEnabled = false;
        }
        updateButtonAppearance(controlButton, false, state.isEnabled);
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
    
    button.innerHTML = `
        <span style="color: ${isEnabled ? '#22D3EE' : 'currentColor'}">
            ${buttonConfig.icon}
        </span>
        ${buttonConfig.text}
    `;
    button.style.cssText = BUTTONS.CONTROL.baseStyle + buttonConfig.style;
}

function updateSpeechBubbleVisibility(isEnabled) {
    const speechBubble = document.querySelector('#voice-chat-control-button')?.parentElement?.querySelector('div');
    if (speechBubble) {
        speechBubble.style.display = isEnabled ? 'flex' : 'none';
    }
}

function updateMicButtonAppearance(isEnabled) {
    const micButton = document.querySelector('#voice-input-button');
    if (micButton) {
        const buttonState = isEnabled ? BUTTONS.MIC.states.ACTIVE : BUTTONS.MIC.states.INACTIVE;
        micButton.style.cssText = `
            ${BUTTONS.MIC.baseStyle}
            ${buttonState.style}
        `;
        micButton.innerHTML = buttonState.icon;
    }
}

