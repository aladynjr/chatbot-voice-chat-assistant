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
    currentSequence: 0,
    recognition: null,
    isRecognitionActive: false
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
                if (finalTranscript.toLowerCase().includes('over')) {
                    const promptDiv = document.querySelector('div.ProseMirror[contenteditable="true"]');
                    if (promptDiv) {
                        // Stop recognition immediately to prevent double triggers
                        recognition.stop();
                        promptDiv.focus();
                        
                        // Clean up any playing audio first
                        cleanupAudio();
                        
                        // Then handle the message
                        const stopButton = document.querySelector('button[data-testid="stop-button"]');
                        if (stopButton) {
                            // If there's an ongoing response, stop it and then send the new message
                            stopButton.click();
                            // Wait a brief moment for the stop to take effect
                            setTimeout(() => {
                                const overIndex = finalTranscript.toLowerCase().indexOf('over');
                                const finalMessage = overIndex !== -1 
                                    ? finalTranscript.substring(0, overIndex).trim()
                                    : finalTranscript.trim();
                                
                                if (finalMessage) {
                                    updateChatGPTInput(finalMessage);
                                    finalTranscript = '';
                                }
                            }, 1000);
                        } else {
                            // If no ongoing response, send immediately
                            const overIndex = finalTranscript.toLowerCase().indexOf('over');
                            const finalMessage = overIndex !== -1 
                                ? finalTranscript.substring(0, overIndex).trim()
                                : finalTranscript.trim();
                            
                            if (finalMessage) {
                                updateChatGPTInput(finalMessage);
                                finalTranscript = '';
                            }
                        }
                        return;
                    }
                }
            } else {
                interimTranscript += transcript;
            }
        }

        updateTextarea(finalTranscript + interimTranscript);
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
    const promptTextarea = document.querySelector('#prompt-textarea');
    if (promptTextarea) {
        promptTextarea.innerHTML = text;
        promptTextarea.dispatchEvent(new Event('input', { bubbles: true }));
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
    updateTextarea(text);
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
    
    try {
        await audioElement.play();
    } catch {
        state.isPlaying = false;
        playNextInQueue();
    }
}

// START: Control Button Component - Only modify this section
function createControlButton() {
    // First check if button already exists
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

    const button = document.createElement('button');
    button.id = 'voice-chat-control-button';

    // Check for API key first
    chrome.storage.local.get(['elevenLabsKey'], (result) => {
        const hasApiKey = result.elevenLabsKey && result.elevenLabsKey.trim() !== '';
        
        button.innerHTML = `
            ${hasApiKey ? `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                    <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" fill="currentColor"/>
                </svg>
                Voice Chat
            ` : `
                ⚠️ Voice Chat
            `}
        `;

        button.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 10000;
            padding: 12px 20px;
            background-color: ${hasApiKey ? '#f0f0f0' : '#e0e0e0'};
            border: 1px solid #e0e0e0;
            color: ${hasApiKey ? '#666' : '#999'};
            border-radius: 28px;
            cursor: ${hasApiKey ? 'pointer' : 'not-allowed'};
            font-weight: 500;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            letter-spacing: -0.01em;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        // Add tooltip for API key warning
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

        // Rest of the button click handler only if API key exists
        button.onclick = () => {
            if (!hasApiKey) return;
            
            state.isEnabled = !state.isEnabled;
            
            if (state.isEnabled) {
                button.style.backgroundColor = '#0066ff';
                button.style.color = '#ffffff';
                button.style.border = '1px solid #0066ff';
                
                // Update mic button appearance immediately
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
                
                // Start recording when enabling
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
                button.style.backgroundColor = '#f0f0f0';
                button.style.color = '#666';
                button.style.border = '1px solid #e0e0e0';
                
                if (state.recognition) {
                    state.recognition.stop();
                }
                cleanupAudio();
            }

            button.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
                    <path d="M14.47 3.12a.75.75 0 0 0-1.32-.48L8.27 8.5H4.75A.75.75 0 0 0 4 9.25v5.5c0 .41.34.75.75.75h3.52l4.88 5.86a.75.75 0 0 0 1.32-.48V3.12zm2.74 4.17a.75.75 0 0 1 1.06.02c1.27 1.31 2.03 3.1 2.03 5.06s-.76 3.75-2.03 5.06a.75.75 0 1 1-1.08-1.04c.96-1 1.61-2.37 1.61-4.02s-.65-3.02-1.61-4.02a.75.75 0 0 1 .02-1.06z" fill="currentColor"/>
                </svg>
                ${state.isEnabled ? 'Voice Chat Active' : 'Voice Chat'}
            `;
            
            if (!state.isEnabled) {
                cleanupAudio();
            }
        };

        // Hover effects only if API key exists
        button.onmouseenter = () => {
            if (!hasApiKey) return;
            if (state.isEnabled) {
                button.style.backgroundColor = '#0052cc';
            } else {
                button.style.backgroundColor = '#e8e8e8';
            }
        };

        button.onmouseleave = () => {
            if (!hasApiKey) return;
            if (state.isEnabled) {
                button.style.backgroundColor = '#0066ff';
            } else {
                button.style.backgroundColor = '#f0f0f0';
            }
        };
    });

    buttonContainer.appendChild(button);
    return buttonContainer;
}

function cleanupAudio() {
    chrome.runtime.sendMessage({ type: 'STOP_ALL_REQUESTS' });
    
    state.audioQueue.forEach(audio => {
        audio.pause();
        URL.revokeObjectURL(audio.src);
    });
    state.audioQueue = [];
    state.isPlaying = false;

    document.querySelectorAll('audio').forEach(audio => audio.pause());
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

// Message handler
window.addEventListener('message', async ({ data }) => {
    if (data.type === 'CHATGPT_RESPONSE' && state.isEnabled) {
        const streamId = Date.now().toString();
        console.log('Received chunk:', data.chunk);
        
        const startTime = state.currentSequence === 0 ? performance.now() : null;
        const audioElement = await processAudioChunk(data.chunk, streamId, startTime);
        
        if (audioElement) {
            state.audioQueue.push(audioElement);
            playNextInQueue();
            state.currentSequence++;
            
            while (state.pendingAudio.has(state.currentSequence)) {
                const nextAudio = state.pendingAudio.get(state.currentSequence);
                state.pendingAudio.delete(state.currentSequence);
                state.audioQueue.push(nextAudio);
                playNextInQueue();
                state.currentSequence++;
            }
        }
    }
});

async function processAudioChunk(chunk, streamId, startTime) {
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'CREATE_SPEECH',
            text: chunk,
            streamId
        });

        if (response.error || !response.sourceUrl) {
            console.error('Error processing audio:', response.error || 'No sourceUrl');
            return null;
        }

        if (startTime) {
            console.log(`Time from chunk to audio ready: ${performance.now() - startTime}ms`);
        }

        const audioElement = await createAudioElement(response.sourceUrl, streamId, response.sequence);
        return audioElement;
    } catch (error) {
        console.error(`[${streamId}] Error processing audio:`, error);
        return null;
    }
}

async function createAudioElement(sourceUrl, streamId, sequence) {
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
    audioElement.dataset.streamId = streamId;
    audioElement.dataset.sequence = sequence;
    
    const audioContainer = document.createElement('div');
    audioContainer.style.margin = '10px 0';
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
            background: white;
            padding: 10px;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        `;
        document.body.appendChild(audioWrapper);
    }
    
    audioWrapper.appendChild(audioContainer);

    audioElement.onended = () => {
        audioContainer.remove();
        URL.revokeObjectURL(blobUrl);
        chrome.runtime.sendMessage({
            type: 'CLEANUP_STREAM',
            streamId
        });
        state.isPlaying = false;
        playNextInQueue();

        // If this was the last audio in the queue and voice chat is still enabled,
        // restart the microphone
        if (state.audioQueue.length === 0 && state.isEnabled) {
            setTimeout(() => {
                if (state.recognition) {
                    state.recognition.start();
                }
            }, 500); // Small delay to ensure everything is cleaned up
        }
    };

    return audioElement;
}
