const originalFetch = window.fetch;
const sentSentences = new Set();
let pendingText = '';
let isMessageComplete = false;

// Queue to handle incoming chunks
const chunkQueue = [];
let isProcessing = false;

// Add this at the top with other state variables
let shouldIgnoreProcessing = false;

// Add currentReader variable at the top
let currentReader = null;

// Function to reset the state for a new chat
const resetChatState = () => {
    console.log('Resetting chat state');
    pendingText = ''; // Clear the pending text
    sentSentences.clear(); // Clear the sent sentences
    isMessageComplete = false; // Reset completion flag
    chunkQueue.length = 0; // Clear the chunk queue
    shouldIgnoreProcessing = false; // Reset the ignore flag
    isProcessing = false;
};

// Helper function to extract text from different chunk formats
const extractChunkText = (parsed) => {
    if (parsed.v?.message?.content?.parts?.[0]) return parsed.v.message.content.parts[0];
    if (parsed.p === '/message/content/parts/0' && parsed.o === 'append') return parsed.v;
    if (parsed.v && typeof parsed.v === 'string' && !parsed.p) return parsed.v;
    if (parsed.p === '' && parsed.o === 'patch' && Array.isArray(parsed.v)) {
        return parsed.v
            .filter(p => p.p === '/message/content/parts/0' && p.o === 'append')
            .map(p => p.v)
            .join('');
    }
    return '';
};

// Clean text helper
const cleanChunkText = (text) => {
    return text
        .replace(/```[\s\S]*?```/g, '') // Remove code blocks
        .replace(/`([^`]+)`/g, '$1')     // Remove inline code
        .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
        .replace(/\*([^*]+)\*/g, '$1')     // Remove italic
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links
        .replace(/#{1,6}\s/g, '')         // Remove headers
        .replace(/>\s[^\n]+/g, '')        // Remove blockquotes
        .trim();
};

// Helper function to split text into sentences
const splitIntoSentences = (text) => {
    // Split based on sentence-ending punctuation followed by a space or end of string
    return text.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
};

// Function to process the chunk queue
const processQueue = async () => {
    if (isProcessing || chunkQueue.length === 0) return;
    isProcessing = true;

    while (chunkQueue.length > 0) {
        const { chunk, isLast } = chunkQueue.shift();
        const cleanedChunk = cleanChunkText(chunk);
        if (cleanedChunk.length <= 1) continue;

        pendingText += ` ${cleanedChunk}`.trim();
        console.log('Current pendingText:', pendingText);

        const sentences = splitIntoSentences(pendingText);
        let lastIndex = 0;

        sentences.forEach(sentence => {
            const trimmedSentence = sentence.trim();
            if (trimmedSentence && !sentSentences.has(trimmedSentence)) {
                // Send the sentence
                window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: trimmedSentence }, '*');
                console.log('Chunk sent successfully:', trimmedSentence);
                sentSentences.add(trimmedSentence);
                // Remove the sent sentence from pendingText
                lastIndex += sentence.length;
            }
        });

        pendingText = pendingText.slice(lastIndex).trim();

        if (isLast && pendingText) {
            const trimmedPending = pendingText.trim();
            if (trimmedPending && !sentSentences.has(trimmedPending)) {
                console.log('Force sending final chunk:', trimmedPending);
                window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: trimmedPending }, '*');
                sentSentences.add(trimmedPending);
                pendingText = '';
                console.log('Final chunk sent and cleared');
            } else {
                console.log('Final chunk already sent or empty, clearing pendingText');
                pendingText = '';
            }
        }
    }

    isProcessing = false;
};

// Add a check to ensure that the chunk is valid JSON before parsing
const processEventData = (data) => {
    if (shouldIgnoreProcessing) {
        console.log('Skipping chunk processing - shouldIgnoreProcessing is true');
        return;
    }
    
    try {
        const parsed = JSON.parse(data);
        if (parsed.v?.message?.author?.role === 'user') return;

        const isComplete = parsed.v?.message?.metadata?.is_complete;
        if (isComplete) {
            isMessageComplete = true;
        }

        const chunkText = extractChunkText(parsed);
        if (chunkText) {
            chunkQueue.push({ chunk: chunkText, isLast: isComplete });
            processQueue();
        }
    } catch (e) {
        console.error('Error parsing chunk:', e);
    }
};

// Override the fetch function
window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    if (!args[0].includes('/backend-api/conversation')) return response;

    const [stream1, stream2] = response.body.tee();
    currentReader = stream2.getReader();  // Store the reader

    (async () => {
        try {
            while (true) {
                if (shouldIgnoreProcessing) {
                    currentReader.cancel();
                    currentReader = null;
                    break;
                }
                
                const {done, value} = await currentReader.read();
                if (done) break;

                const chunk = new TextDecoder().decode(value);
                for (const event of chunk.split('\n\n')) {
                    const dataLine = event.split('\n').find(line => line.startsWith('data: '));
                    if (!dataLine) continue;

                    const data = dataLine.slice(6);
                    if (data === '[DONE]') {
                        if (pendingText) {
                            // Add the remaining text as the last chunk
                            chunkQueue.push({ chunk: pendingText, isLast: true });
                            processQueue();
                        }
                        resetChatState(); // Reset state after sending the last chunk
                        continue;
                    }

                    processEventData(data); // Use the new function to process event data
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') console.error('Stream processing error:', error);
        } finally {
            currentReader = null;
        }
    })();

    return new Response(stream1, response);
};

// Reset state on URL change
window.addEventListener('popstate', resetChatState); // Reset when the URL changes

// Expose a method to clear the interceptor state
window.clearInterceptorState = (immediate = false) => {
    console.log('Clearing interceptor state');
    shouldIgnoreProcessing = true;  // Set to true temporarily
    
    // Always clear everything immediately when called
    chunkQueue.length = 0;
    pendingText = '';
    sentSentences.clear();
    isMessageComplete = true;
    isProcessing = false;
    
    // Cancel any ongoing fetch reader
    if (currentReader) {
        currentReader.cancel();
        currentReader = null;
    }

    // Reset shouldIgnoreProcessing after a short delay
    setTimeout(() => {
        shouldIgnoreProcessing = false;
        console.log('Reset shouldIgnoreProcessing to false');
    }, 100);
};

// Listen for messages from content script
window.addEventListener('message', (event) => {
    if (event.data.type === 'CLEAR_INTERCEPTOR_STATE') {
        window.clearInterceptorState(event.data.immediate);
    }
});