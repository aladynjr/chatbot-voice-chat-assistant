// Inject the interceptor script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('interceptor.js');
(document.head || document.documentElement).appendChild(script);

// Global state management
const state = {
    audioQueue: [],
    isPlaying: false,
    isEnabled: false,
    isRecording: false,
    pendingAudio: new Map(),
    nextSequence: 0,
    recognition: null,
    isRecognitionActive: false,
    currentSequence: 0,
    ttsQueue: [], // Holds incoming TTS chunks
    isProcessingTTS: false, // Indicates if a TTS request is being processed
    isAwaitingNextTTS: false, // Indicates if the system is waiting to process the next TTS
};

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

    recognition.onresult = (event) => {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
                // Trim the message and convert to lowercase for checking
                const trimmedMessage = finalTranscript.toLowerCase().trim();
                // Remove trailing punctuation before checking for 'over'
                const messageWithoutPunctuation = trimmedMessage.replace(/[.,!?]+$/, '').trim();
                
                if (messageWithoutPunctuation.endsWith('over')) {
                    const promptDiv = document.querySelector('div.ProseMirror[contenteditable="true"]');
                    if (promptDiv) {
                        // Stop recognition immediately to prevent double triggers
                        recognition.stop();
                        promptDiv.focus();
                        
                        // Clean up any playing audio first
                        cleanupAudio();
                        
                        // Show the full text including "over" first
                        updateTextarea(finalTranscript.trim());
                        
                        // Then handle the message after a brief delay
                        const stopButton = document.querySelector('button[data-testid="stop-button"]');
                        if (stopButton) {
                            stopButton.click();
                            setTimeout(() => {
                                // Remove 'over' before sending
                                const messageToSend = finalTranscript
                                    .trim()
                                    .replace(/\s*over[.,!?]*\s*$/i, '')
                                    .trim();
                                
                                if (messageToSend) {
                                    // First update the display without 'over'
                                    updateTextarea(messageToSend);
                                    // Then submit after a tiny delay
                                    setTimeout(() => {
                                        submitMessage();
                                        finalTranscript = '';
                                    }, 50);
                                }
                            }, 1000);
                        } else {
                            setTimeout(() => {
                                // Remove 'over' before sending
                                const messageToSend = finalTranscript
                                    .trim()
                                    .replace(/\s*over[.,!?]*\s*$/i, '')
                                    .trim();
                                
                                if (messageToSend) {
                                    // First update the display without 'over'
                                    updateTextarea(messageToSend);
                                    // Then submit after a tiny delay
                                    setTimeout(() => {
                                        submitMessage();
                                        finalTranscript = '';
                                    }, 50);
                                }
                            }, 250);
                        }
                        return;
                    }
                }
            } else {
                interimTranscript += transcript;
            }
        }

        // Show the full transcript including "over" in the input field
        const displayText = (finalTranscript + interimTranscript).trim();
        updateTextarea(displayText);
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
            if (state.isEnabled) {
                micButton.style.backgroundColor = 'rgba(255, 68, 68, 0.1)';
                micButton.style.color = '#ff4444';
                micButton.innerHTML = `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor">
                            <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite"/>
                        </path>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
                    </svg>
                `;
            } else {
                micButton.style.backgroundColor = 'transparent';
                micButton.style.color = '#8e8ea0';
                micButton.innerHTML = `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
                    </svg>
                `;
            }
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        state.isRecognitionActive = false;
        
        if (event.error === 'no-speech') {
            if (state.isEnabled && !state.isRecognitionActive) {
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
        }
    };

    return recognition;
}

function updateTextarea(text) {
    // Find the ProseMirror div
    const promptDiv = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (promptDiv) {
        // Create a paragraph element with the cleaned text
        promptDiv.innerHTML = `<p>${text}</p>`;
        // Dispatch input event to trigger ChatGPT's internal handlers
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

function updateChatGPTInput(text) {
    // Clean up previous audio elements and state before sending new message
    cleanupAudio();
    
    // Reset sequence counter when sending new message
    state.currentSequence = 0;
    
    // Remove 'over' from the text before sending
    const cleanedText = text.replace(/\s*over[.,!?]*\s*$/i, '').trim();
    console.log('dude')
    // Update textarea and submit
    updateTextarea(cleanedText+' duuuuuuuude');
    submitMessage();
}

function createMicrophoneButton() {
    const button = document.createElement('button');
    button.id = 'voice-input-button';
    button.type = 'button';
    
    // Set initial state based on state.isEnabled
    const buttonState = state.isEnabled ? {
        backgroundColor: 'rgba(255, 68, 68, 0.1)',
        color: '#ff4444',
        innerHTML: `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor">
                    <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite"/>
                </path>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
            </svg>
        `
    } : {
        backgroundColor: 'transparent',
        color: '#8e8ea0',
        innerHTML: `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
            </svg>
        `
    };
    
    button.innerHTML = buttonState.innerHTML;
    
    button.style.cssText = `
        background: ${buttonState.backgroundColor};
        border: none;
        padding: 8px;
        cursor: pointer;
        color: ${buttonState.color};
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 8px;
        border-radius: 6px;
        transition: all 0.2s ease;
        position: relative;
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
        button.style.backgroundColor = state.isEnabled ? 
            'rgba(255, 68, 68, 0.1)' : 'transparent';
        tooltip.style.opacity = '0';
    };

    // Remove click handler since the control button will handle recording
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

async function playNextInQueue() {
    if (state.audioQueue.length === 0 || state.isPlaying) return;
    
    state.isPlaying = true;
    const audioElement = state.audioQueue.shift();
    
    audioElement.onended = () => {
        URL.revokeObjectURL(audioElement.src);
        state.isPlaying = false;
        playNextInQueue();
    };
    
    audioElement.onplay = () => {
        console.log(`Audio sequence ${audioElement.dataset.sequence} is now playing.`);
        processTTSQueue(); // Trigger the next TTS request
    };
    
    try {
        await audioElement.play();
    } catch {
        state.isPlaying = false;
        playNextInQueue();
    }

    // Update Control Button Appearance when audio starts playing
    const controlButton = document.getElementById('voice-chat-control-button');
    if (controlButton) {
        controlButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
            Pause Voice Chat
        `;
        controlButton.style.backgroundColor = '#ffcc00';
        controlButton.style.color = '#ffffff';
    }
}

// START: Control Button Component
/**
 * Creates the Voice Chat Control Button with dynamic behavior based on audio playback state.
 */
function createControlButton() {
    // Check if the control button already exists to prevent duplicates
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

    // Add speech bubble tooltip
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
        display: none;  /* Hidden by default */
        align-items: center;
        gap: 8px;
        animation: float 3s ease-in-out infinite;
        pointer-events: none;
    `;
    
    // Add floating animation keyframes
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
    
    // Add speaking person icon and text
    speechBubble.innerHTML = `
      <svg fill="#ffffff" width="18" height="18" viewBox="0 0 32.00 32.00" id="icon" xmlns="http://www.w3.org/2000/svg" stroke="#ffffff" stroke-width="0.00032"><g id="SVGRepo_bgCarrier" stroke-width="0"><rect x="0" y="0" width="32.00" height="32.00" rx="16" fill="#212121" strokewidth="0"></rect></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" stroke="#CCCCCC" stroke-width="0.768"></g><g id="SVGRepo_iconCarrier"> <defs> <style> .cls-1 { fill: none; } </style> </defs> <path d="M26,30H24V27H20a5.0055,5.0055,0,0,1-5-5V20.7207l-2.3162-.772a1,1,0,0,1-.5412-1.4631L15,13.7229V11a9.01,9.01,0,0,1,9-9h5V4H24a7.0078,7.0078,0,0,0-7,7v3a.9991.9991,0,0,1-.1426.5144l-2.3586,3.9312,1.8174.6057A1,1,0,0,1,17,20v2a3.0033,3.0033,0,0,0,3,3h5a1,1,0,0,1,1,1Z"></path> <rect x="19" y="12" width="4" height="2"></rect> <path d="M9.3325,25.2168a7.0007,7.0007,0,0,1,0-10.4341l1.334,1.49a5,5,0,0,0,0,7.4537Z"></path> <path d="M6.3994,28.8008a11.0019,11.0019,0,0,1,0-17.6006L7.6,12.8a9.0009,9.0009,0,0,0,0,14.4014Z"></path> <rect id="_Transparent_Rectangle_" data-name="<Transparent Rectangle>" class="cls-1" width="32" height="32"></rect> </g></svg>
        Speak, then say "over" to send message
    `;

    // Add arrow/triangle
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

    // Retrieve the ElevenLabs API key from Chrome storage
    chrome.storage.local.get(['elevenLabsKey'], (result) => {
        const hasApiKey = result.elevenLabsKey && result.elevenLabsKey.trim() !== '';

        /**
         * Returns the appropriate HTML content for the button based on the current state.
         */
        const getButtonContent = () => {
            if (state.isPlaying) {
                return `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                    Pause Voice Chat
                `;
            } else if (state.isEnabled) {
                return `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" />
                    </svg>
                    Voice Chat Active
                `;
            } else {
                return `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" />
                    </svg>
                    Start Voice Chat
                `;
            }
        };

        /**
         * Returns the appropriate CSS styles for the button based on the current state.
         */
        const getButtonStyles = () => {
            if (state.isPlaying) {
                return 'background-color: #ffcc00; color: #ffffff;';
            } else if (state.isEnabled) {
                return 'background-color: #0066ff; color: #ffffff;';
            } else {
                return 'background-color: #f0f0f0; color: #666666;';
            }
        };

        button.innerHTML = getButtonContent();

        // Apply initial styles to the button
        button.style.cssText = `
            padding: 12px 20px;
            ${getButtonStyles()}
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
        `;

        // Add tooltip for API key warning if the key is missing
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

            // Show tooltip on hover
            button.onmouseenter = () => tooltip.style.opacity = '1';
            button.onmouseleave = () => tooltip.style.opacity = '0';
            return;
        }

        /**
         * Click handler for the control button.
         * - If audio is playing, clicking pauses/stops the audio.
         * - Otherwise, toggles the voice chat state.
         */
        button.onclick = () => {
            if (!hasApiKey) return; // Do nothing if API key is missing

            if (state.isPlaying) {
                cleanupAudio();
                return;
            }

            // Toggle the voice chat enabled state
            state.isEnabled = !state.isEnabled;

            // Update button appearance
            if (state.isEnabled) {
                button.style.backgroundColor = '#0066ff';
                button.style.color = '#ffffff';
                button.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" />
                    </svg>
                    Voice Chat Active
                `;

                // Immediately update mic button appearance
                const micButton = document.querySelector('#voice-input-button');
                if (micButton) {
                    micButton.style.backgroundColor = 'rgba(255, 68, 68, 0.1)';
                    micButton.style.color = '#ff4444';
                    micButton.innerHTML = `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor">
                                <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite"/>
                            </path>
                            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
                        </svg>
                    `;
                }
            } else {
                button.style.backgroundColor = '#f0f0f0';
                button.style.color = '#666666';
                button.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                        <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" />
                    </svg>
                    Start Voice Chat
                `;

                // Immediately update mic button appearance
                const micButton = document.querySelector('#voice-input-button');
                if (micButton) {
                    micButton.style.backgroundColor = 'transparent';
                    micButton.style.color = '#8e8ea0';
                    micButton.innerHTML = `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="currentColor"/>
                            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/>
                        </svg>
                    `;
                }
            }

            // When enabling voice chat
            if (state.isEnabled) {
                // Initialize and start speech recognition if not already active
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
            } else {
                // When disabling voice chat
                // Stop speech recognition if it's active
                if (state.recognition) {
                    state.recognition.stop();
                }
                // Clean up any existing audio
                cleanupAudio();
            }

            // Update the button's inner HTML based on the new state
            button.innerHTML = getButtonContent();
        };

        /**
         * Hover effects for the button.
         * Changes background color on hover, excluding when audio is playing.
         */
        button.onmouseenter = () => {
            if (!hasApiKey) return;
            if (state.isPlaying) return; // Do not change styles when audio is playing
            if (state.isEnabled) {
                button.style.backgroundColor = '#0052cc';
            } else {
                button.style.backgroundColor = '#e8e8e8';
            }
        };

        button.onmouseleave = () => {
            if (!hasApiKey) return;
            if (state.isPlaying) return; // Do not change styles when audio is playing
            if (state.isEnabled) {
                button.style.backgroundColor = '#0066ff';
            } else {
                button.style.backgroundColor = '#f0f0f0';
            }
        };

        // Modify the button click handler to show/hide tooltip
        const originalOnClick = button.onclick;
        button.onclick = () => {
            if (!hasApiKey) return;
            
            originalOnClick?.();
            
            // Show/hide tooltip based on state.isEnabled
            speechBubble.style.display = state.isEnabled ? 'flex' : 'none';
        };

        // Initial tooltip visibility
        speechBubble.style.display = state.isEnabled ? 'flex' : 'none';
    });

    // Append the control button to the container
    buttonContainer.appendChild(button);
    return buttonContainer;
}

/**
 * Stops all audio playback, cleans up resources, and resets relevant state variables.
 * Also removes all audio elements from the DOM.
 */
function cleanupAudio() {
    // First, stop all ongoing requests
    chrome.runtime.sendMessage({ type: 'STOP_ALL_REQUESTS' });

    // Clear interceptor state
    window.postMessage({ type: 'CLEAR_INTERCEPTOR_STATE' }, '*');

    // Clear all state variables
    state.audioQueue = [];
    state.isPlaying = false;
    state.isProcessingTTS = false;
    state.isAwaitingNextTTS = false;
    state.ttsQueue = []; // Add this line to clear TTS queue
    state.currentSequence = 0; // Reset sequence counter

    // Remove all audio elements
    const audioWrapper = document.querySelector('.tts-audio-wrapper');
    if (audioWrapper) {
        const audioElements = audioWrapper.querySelectorAll('audio');
        audioElements.forEach(audio => {
            audio.pause();
            if (audio.src) {
                URL.revokeObjectURL(audio.src);
            }
        });
        audioWrapper.innerHTML = ''; // Clear all audio containers
    }

    // Update control button appearance
    const controlButton = document.getElementById('voice-chat-control-button');
    if (controlButton && state.isEnabled) {
        controlButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" />
            </svg>
            Voice Chat Active
        `;
        controlButton.style.backgroundColor = '#0066ff';
        controlButton.style.color = '#ffffff';
    }
}
// New Functions for TTS Queue Management

function enqueueTTS(text) {
    state.ttsQueue.push(text);
    processTTSQueue();
}

async function processTTSQueue() {
    if (state.isProcessingTTS || state.ttsQueue.length === 0) return;

    state.isProcessingTTS = true;
    const text = state.ttsQueue.shift();

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'CREATE_SPEECH',
            text: text,
            streamId: Date.now().toString()
        });

        if (response.error || !response.sourceUrl) {
            console.error('Error processing audio:', response.error || 'No sourceUrl');
        } else {
            const sequence = response.sequence;
            const audioElement = await createAudioElement(response.sourceUrl, sequence);
            state.audioQueue.push(audioElement);
            if (!state.isPlaying) {
                playNextInQueue();
            }
        }
    } catch (error) {
        console.error('Error sending CREATE_SPEECH message:', error);
    } finally {
        state.isProcessingTTS = false;
    }
}

async function createAudioElement(sourceUrl, sequence) {
    const base64Data = sourceUrl.split(',')[1];
    const binaryData = atob(base64Data);
    const arrayBuffer = new ArrayBuffer(binaryData.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    
    for (let i = 0; i < binaryData.length; i++) {
        uint8Array[i] = binaryData.charCodeAt(i);
    }
    
    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);

    const audioElement = document.createElement('audio');
    audioElement.src = blobUrl;
    audioElement.controls = true;
    audioElement.dataset.streamId = sequence;
    audioElement.dataset.sequence = sequence;
    
    const audioContainer = document.createElement('div');
    audioContainer.style.cssText = `
        margin: 10px 0;
        padding: 10px;
        background-color: white;
        border-radius: 5px;
        transition: background-color 0.5s ease;
        display: none; /* Hide the container */
    `;
    audioContainer.appendChild(audioElement);

    let audioWrapper = document.querySelector('.tts-audio-wrapper');
    if (!audioWrapper) {
        audioWrapper = document.createElement('div');
        audioWrapper.className = 'tts-audio-wrapper';
        audioWrapper.style.cssText = `
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
            display: none; /* Hide the wrapper */
        `;
        document.body.appendChild(audioWrapper);
    }
    
    audioWrapper.appendChild(audioContainer);

    // When the audio starts playing, set the flag to allow the next TTS request
    audioElement.onplay = () => {
        console.log(`Audio sequence ${sequence} is now playing.`);
        if (!state.isAwaitingNextTTS) {
            state.isAwaitingNextTTS = true;
            processTTSQueue(); // Trigger the next TTS request
        }
    };

    audioElement.onended = () => {
        console.log(`Audio sequence ${sequence} has finished playing.`);
        
        // Add green background when audio finishes playing
        audioContainer.style.backgroundColor = 'green';
        
        // Optional: Remove the audio element after a short delay to allow the background color change to be visible
        setTimeout(() => {
            audioContainer.remove();
            URL.revokeObjectURL(blobUrl);
            state.isPlaying = false;
            state.isAwaitingNextTTS = false;
            playNextInQueue();

            console.log(`Audio sequence ${sequence} container removed.`);
        }, 1000); // 1-second delay
    };

    return audioElement;
}

function initializeFeatures() {
    const button = createControlButton();
    if (button) {  // Only append if a new button was created
        document.body.appendChild(button);
    }
    addMicrophoneButton();
}

// Initialize and observe
const observer = new MutationObserver(() => {
    if (document.querySelector('form.w-full .relative.flex.h-full') && 
        !document.getElementById('voice-input-button')) {
        requestAnimationFrame(() => addMicrophoneButton());  // Only add microphone button
    }
    
    // Add control button if it doesn't exist
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

// Initial setup
document.addEventListener('DOMContentLoaded', initializeFeatures);
// Backup in case DOMContentLoaded already fired
if (document.readyState === 'complete') {
    initializeFeatures();
}

// Message handler with sequence assignment
window.addEventListener('message', async ({ data }) => {
    if (data.type === 'CHATGPT_RESPONSE' && state.isEnabled) {
        const chunk = data.chunk;
        enqueueTTS(chunk); // Enqueue the chunk for TTS processing
    }
});

