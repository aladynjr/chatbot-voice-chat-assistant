let activeStreams = new Map();
let abortController = null;
let requestQueue = [];
let processingCount = 0;
const MAX_CONCURRENT_REQUESTS = 1;
let sequenceNumber = 0;

async function streamSpeech(text, streamId, sequence) {
    const startTime = performance.now();
    console.log(`[${streamId}] Starting speech generation at ${startTime.toFixed(2)}ms`);
    
    try {
        const result = await chrome.storage.local.get(['elevenLabsKey']);
        const apiKey = result.elevenLabsKey;
        
        if (!apiKey) {
            throw new Error('API key not found');
        }

        abortController = new AbortController();
        
        const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/9BWtsMINqrJLrRacOk9x/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': apiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_turbo_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.2,
                    style: 1,
                    use_speaker_boost: true
                }
            }),
            signal: abortController.signal
        });

        if (!response.ok) {
            throw new Error('Speech generation failed');
        }

        const fetchEndTime = performance.now();
        console.log(`[${streamId}] Fetch completed in ${(fetchEndTime - startTime).toFixed(2)}ms`);

        // Get the array buffer from the response
        const arrayBuffer = await response.arrayBuffer();
        
        // Convert array buffer to base64 in chunks to avoid stack overflow
        const chunks = [];
        const uint8Array = new Uint8Array(arrayBuffer);
        const chunkSize = 32768;
        
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            chunks.push(String.fromCharCode.apply(null, chunk));
        }
        
        const base64Audio = btoa(chunks.join(''));
        const audioDataUrl = `data:audio/mpeg;base64,${base64Audio}`;
        
        activeStreams.set(streamId, {
            url: audioDataUrl,
            isActive: true
        });

        const endTime = performance.now();
        console.log(`[${streamId}] Total processing time in background: ${(endTime - startTime).toFixed(2)}ms`);
        return { sourceUrl: audioDataUrl, sequence };
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request was aborted');
            return { error: 'Request aborted', sequence };
        }
        console.error('Error in streamSpeech:', error);
        return { error: error.message, sequence };
    }
}

function cleanupStream(streamId) {
    const stream = activeStreams.get(streamId);
    if (stream) {
        activeStreams.delete(streamId);
    }
}

async function processQueue() {
    while (requestQueue.length > 0 && processingCount < MAX_CONCURRENT_REQUESTS) {
        const { text, streamId, sendResponse, sequence } = requestQueue.shift();
        processingCount++;
        console.log(`Processing sequence ${sequence}: ${text}`);
        
        try {
            const result = await streamSpeech(text, streamId, sequence);
            sendResponse({ ...result, sequence });
            console.log(`Completed sequence ${sequence}`);
        } catch (error) {
            sendResponse({ error: error.message, sequence });
            console.error(`Error in sequence ${sequence}:`, error);
        } finally {
            processingCount--;
            processQueue();
        }
    }
}

function stopAllRequests() {
    if (abortController) {
        abortController.abort();
        abortController = new AbortController();
    }
    
    requestQueue.length = 0;
    processingCount = 0;
    
    activeStreams.clear();
    
    sequenceNumber = 0;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CREATE_SPEECH') {
        const currentSequence = sequenceNumber++;
        requestQueue.push({
            text: message.text,
            streamId: message.streamId,
            sendResponse,
            sequence: currentSequence
        });
        
        processQueue();
        return true;
    } else if (message.type === 'CLEANUP_STREAM') {
        cleanupStream(message.streamId);
        sendResponse({ success: true });
        return true;
    } else if (message.type === 'STOP_ALL_REQUESTS') {
        stopAllRequests();
        sendResponse({ success: true });
        return true;
    } else if (message.type === 'VALIDATE_API_KEY') {
        validateApiKey(message.apiKey).then(sendResponse);
        return true;
    }
}); 

async function validateApiKey(apiKey) {
    try {
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            method: 'GET',
            headers: {
                'xi-api-key': apiKey
            }
        });

        if (!response.ok) {
            return { isValid: false, error: 'Invalid API key' };
        }

        return { isValid: true };
    } catch (error) {
        return { isValid: false, error: 'Network error' };
    }
}