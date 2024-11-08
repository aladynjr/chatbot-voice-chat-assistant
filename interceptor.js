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

// Variable to track the current message's author role
let currentAuthorRole = null;
let currentOperation = null;  // Add this
let isOperationData = false; // Add this

// Function to reset the state for a new chat
const resetChatState = () => {
    console.log('Resetting chat state');
    pendingText = ''; // Clear the pending text
    sentSentences.clear(); // Clear the sent sentences
    isMessageComplete = false; // Reset completion flag
    chunkQueue.length = 0; // Clear the chunk queue
    shouldIgnoreProcessing = false; // Reset the ignore flag
    isProcessing = false;
    currentAuthorRole = null; // Reset the author role tracker
    currentOperation = null;    // Add this
    isOperationData = false;   // Add this

};

// Helper function to extract text from different chunk formats
const extractChunkText = (parsed) => {
    let text = '';
    if (parsed.v?.message?.content?.parts?.[0]) text = parsed.v.message.content.parts[0];
    else if (parsed.p === '/message/content/parts/0' && parsed.o === 'append') text = parsed.v;
    else if (parsed.v && typeof parsed.v === 'string' && !parsed.p) text = parsed.v;
    else if (parsed.p === '' && parsed.o === 'patch' && Array.isArray(parsed.v)) {
        text = parsed.v
            .filter(p => p.p === '/message/content/parts/0' && p.o === 'append')
            .map(p => p.v)
            .join('');
    }
    // Ensure there's a space at the end of the chunk
    return text ? text.trim() + ' ' : '';
};

// Clean text helper
const cleanChunkText = (text) => {
    return text
        .replace(/```[\s\S]*?```/g, '') // Remove code blocks
        .replace(/\*\*([^*]+?)\*\*/g, '$1')     // Keep bold text content
        .replace(/\*([^*]+?)\*/g, '$1')         // Keep italic text content
        .replace(/_([^_]+?)_/g, '$1')           // Keep underscore-italic text content
        .replace(/`([^`]+)`/g, '$1')            // Keep inline code content
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Keep link text
        .replace(/^#{1,6}\s+(.+)$/gm, '$1')     // Keep header content
        .replace(/>\s*(.+)/g, '$1')             // Keep blockquote content
        .replace(/【[^】]+】/g, '')             // Remove sources in【】brackets
        .replace(/\[\d+\†source\]/g, '')        // Remove [number†source] format
        .replace(/^\d+\.\s+/gm, '')            // Remove numbered list markers
        .replace(/([a-z])([A-Z])/g, '$1 $2')   // Add space between camelCase
        .replace(/([.!?])"(\s|$)/g, '"$1$2')   // Fix quote placement after punctuation
        .replace(/(\w)(["""])/g, '$1 $2')      // Add space before quotes
        .replace(/(["""])(\w)/g, '$1 $2')      // Add space after quotes
        .replace(/(\w)([.!?])(\w)/g, '$1$2 $3') // Add space after punctuation between words
        .trim() + ' ';                          // Add space at the end
};

// Helper function to split text into sentences
const splitIntoSentences = (text) => {
    // More comprehensive sentence splitting
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [];
    return sentences
        .map(sentence => sentence.trim())
        .filter(sentence => {
            // Filter out single letters or very short fragments
            return sentence.length > 2 && 
                   !/^[A-Z]\.$/.test(sentence) &&
                   !/^\s*$/.test(sentence);
        });
};

// Function to process the chunk queue
const processQueue = async () => {
    if (isProcessing || chunkQueue.length === 0) return;
    isProcessing = true;

    while (chunkQueue.length > 0) {
        const { chunk, isLast } = chunkQueue.shift();
        const cleanedChunk = cleanChunkText(chunk);
        if (cleanedChunk.length <= 1) continue;

        // Ensure there's a space before appending if needed
        if (pendingText.length > 0 && !pendingText.endsWith(' ')) {
            pendingText += ' ';
        }
        pendingText += cleanedChunk;

        console.log('Current pendingText:', pendingText);

        const sentences = splitIntoSentences(pendingText);
        let lastIndex = 0;

        // Only process sentences if we have complete ones or this is the last chunk
        if (sentences.length > 0 && (sentences.length > 1 || isLast)) {
            sentences.forEach((sentence, index) => {
                // Only process if it's not the last sentence or if this is the last chunk
                if (index < sentences.length - 1 || isLast) {
                    const trimmedSentence = sentence.trim();
                    if (trimmedSentence && !sentSentences.has(trimmedSentence)) {
                        window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: trimmedSentence }, '*');
                        console.log('Chunk sent successfully:', trimmedSentence);
                        sentSentences.add(trimmedSentence);
                        lastIndex += sentence.length;
                    }
                }
            });

            pendingText = pendingText.slice(lastIndex).trim();
        }

        // Handle the last chunk if there's remaining text
        if (isLast && pendingText) {
            const trimmedPending = pendingText.trim();
            if (trimmedPending && !sentSentences.has(trimmedPending)) {
                console.log('Force sending final chunk:', trimmedPending);
                window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: trimmedPending }, '*');
                sentSentences.add(trimmedPending);
                pendingText = '';
            }
        }
    }

    isProcessing = false;
};

// Add this helper function to check if a path is a valid content parts path
const isValidContentPath = (path) => {
    if (!path) return false;
    return /^\/message\/content\/parts\/\d+$/.test(path);
};

// Update processEventData function
const processEventData = (data) => {
    if (shouldIgnoreProcessing) {
        console.log('Skipping chunk processing - shouldIgnoreProcessing is true');
        return;
    }
    
    try {
        const parsed = JSON.parse(data);
        
        // Track the current message's author role
        if (parsed.v?.message?.author?.role) {
            currentAuthorRole = parsed.v.message.author.role;
            // Reset operation state when a new message starts
            currentOperation = null;
            isOperationData = false;
        }

        // Check if this is the start of an operation
        if (parsed.p === '/message/content/text' && parsed.o === 'append') {
            const value = parsed.v;
            if (value.includes('search(')) {
                currentOperation = 'search';
                isOperationData = true;
                return;
            } else if (value.includes('mclick')) {
                currentOperation = 'mclick';
                isOperationData = true;
                return;
            }
        }

        // If we're in an operation and this is a simple value continuation, skip it
        if (currentOperation && parsed.v && typeof parsed.v === 'string' && !parsed.p) {
            return;
        }

        // Check for operation completion
        if (currentOperation && parsed.p === '' && parsed.o === 'patch') {
            const patchData = Array.isArray(parsed.v) ? parsed.v : [parsed.v];
            const hasEndMarker = patchData.some(patch => 
                patch.p === '/message/status' && patch.v === 'finished_successfully'
            );
            if (hasEndMarker) {
                currentOperation = null;
                isOperationData = false;
                return;
            }
        }

        // Only process chunks from the assistant and when not in an operation
        if (currentAuthorRole !== 'assistant' || isOperationData) {
            return;
        }

        // If there's a path (p) field, check if it's a valid content parts path
        if (parsed.p && !isValidContentPath(parsed.p)) {
            return;
        }

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
                if (shouldIgnoreProcessing || !currentReader) {
                    if (currentReader) {
                        currentReader.cancel();
                        currentReader = null;
                    }
                    break;
                }
                
                const {done, value} = await currentReader.read();
                if (done) {
                    currentReader = null;  // Clean up the reader when done
                    break;
                }

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

                    processEventData(data); // Use the updated function to process event data
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Stream processing error:', error);
            }
            if (currentReader) {
                currentReader.cancel();
                currentReader = null;
            }
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
    currentAuthorRole = null; // Reset the author role tracker
    
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