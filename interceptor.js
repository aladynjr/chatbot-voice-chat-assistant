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
    text = text.trim();
    // Add space at start if the text starts with a capital letter
    return text ? (/^[A-Z]/.test(text) ? ' ' + text : text) : '';
};

// Remove markdown function implementation
const removeMarkdown = (md, options = {}) => {
    // Default options
    const defaults = {
        listUnicodeChar: false,
        stripListLeaders: true,
        gfm: true,
        useImgAltText: true,
        abbr: false,
        replaceLinksWithURL: false,
        htmlTagsToSkip: []
    };
    
    options = { ...defaults, ...options };
    let output = md || '';

    try {
        // Remove horizontal rules
        output = output.replace(/^(-\s*?|\*\s*?|_\s*?){3,}\s*/gm, '');

        // Handle list leaders
        if (options.stripListLeaders) {
            if (options.listUnicodeChar) {
                output = output.replace(/^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm, options.listUnicodeChar + ' $1');
            } else {
                output = output.replace(/^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm, '$1');
            }
        }

        // Handle GFM specific features
        if (options.gfm) {
            output = output
                .replace(/\n={2,}/g, '\n')          // Header
                .replace(/~{3}.*\n/g, '')           // Fenced codeblocks
                .replace(/~~/g, '')                 // Strikethrough
                .replace(/`{3}.*\n/g, '');          // Fenced codeblocks
        }

        output = output
            // Remove HTML tags
            .replace(/<[^>]*>/g, '')
            // Remove setext-style headers
            .replace(/^[=\-]{2,}\s*$/g, '')
            // Remove footnotes
            .replace(/\[\^.+?\](\: .*?$)?/g, '')
            .replace(/\s{0,2}\[.*?\]: .*?$/g, '')
            // Remove images
            .replace(/\!\[(.*?)\][\[\(].*?[\]\)]/g, options.useImgAltText ? '$1' : '')
            // Remove inline links
            .replace(/\[([^\]]*?)\][\[\(].*?[\]\)]/g, options.replaceLinksWithURL ? '$2' : '$1')
            // Remove blockquotes
            .replace(/^(\n)?\s{0,3}>\s?/gm, '$1')
            // Remove reference-style links
            .replace(/^\s{1,2}\[(.*?)\]: (\S+)( ".*?")?\s*$/g, '')
            // Remove atx-style headers
            .replace(/^(\n)?\s{0,}#{1,6}\s*( (.+))? +#+$|^(\n)?\s{0,}#{1,6}\s*( (.+))?$/gm, '$1$3$4$6')
            // Remove * emphasis
            .replace(/([\*]+)(\S)(.*?\S)??\1/g, '$2$3')
            // Remove _ emphasis with special rules
            .replace(/(^|\W)([_]+)(\S)(.*?\S)??\2($|\W)/g, '$1$3$4$5')
            // Remove code blocks
            .replace(/(`{3,})(.*?)\1/gm, '$2')
            // Remove inline code
            .replace(/`(.+?)`/g, '$1')
            // Replace strike through
            .replace(/~(.*?)~/g, '$1');

        return output;
    } catch (e) {
        console.error("remove-markdown encountered error:", e);
        return md;
    }
};



// Helper function to split text into sentences
const splitIntoSentences = (text) => {
    // More comprehensive sentence splitting with lookahead for common abbreviations
    const sentences = text.match(/[^.!?]+(?:[.!?](?:[ \n\r]|$))+/g) || [];
    return sentences
        .map(sentence => sentence.trim())
        .filter(sentence => {
            // Enhanced filtering to avoid short or incomplete sentences
            return sentence.length > 10 && // Increased minimum length
                   !/^[A-Z]\.$/.test(sentence) &&
                   !/^\s*$/.test(sentence) &&
                   !/^[^a-zA-Z]*$/.test(sentence) && // Must contain some letters
                   !sentence.endsWith('...'); // Avoid incomplete sentences
        });
};
// Function to process the chunk queue
const processQueue = async () => {
    if (isProcessing || chunkQueue.length === 0) {
        console.log('[Interceptor] Queue processing skipped:', { 
            isProcessing, 
            queueLength: chunkQueue.length 
        });
        return;
    }
    
    isProcessing = true;

    while (chunkQueue.length > 0) {
        const { chunk, isLast } = chunkQueue.shift();

        // Remove the markdown cleaning here, just do basic cleaning
        const cleanedChunk = chunk
            .replace(/【[^】]+】/g, '')      // Remove sources in【】brackets
            .replace(/\[\d+\†source\]/g, ''); // Remove [number†source] format

        if (cleanedChunk.length <= 1) continue;

        // Add space at start of chunk if it starts with a capital letter
        const shouldAddSpace = /^[A-Z]/.test(cleanedChunk);
        pendingText += shouldAddSpace ? ' ' + cleanedChunk : cleanedChunk;

        console.log('Current pendingText:', pendingText);
        
        // Only process if we have a complete sentence or it's the last chunk
        if (isLast || pendingText.match(/[.!?](?:[ \n\r]|$)/)) {
            let processedText = removeMarkdown(pendingText);
            const sentences = splitIntoSentences(processedText);
            let lastIndex = 0;

            // Only process complete sentences
            if (sentences.length > 0) {
                sentences.forEach((sentence, index) => {
                    // Only process if it's a complete sentence
                    if (sentence.match(/[.!?](?:[ \n\r]|$)/)) {
                        const trimmedSentence = sentence.trim();
                        if (trimmedSentence && !sentSentences.has(trimmedSentence)) {
                            window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: trimmedSentence }, '*');
                            sentSentences.add(trimmedSentence);
                            lastIndex = pendingText.indexOf(sentence) + sentence.length;
                        }
                    }
                });

                pendingText = pendingText.slice(lastIndex).trim();
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
        console.log('[Interceptor] Skipping chunk - shouldIgnoreProcessing is true');
        return;
    }
    
    try {
        const parsed = JSON.parse(data);
  
        
        // Track the current message's author role
        if (parsed.v?.message?.author?.role) {
            currentAuthorRole = parsed.v.message.author.role;
            // console.log('[Interceptor] Author role changed:', currentAuthorRole);
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
            console.log('[Interceptor] Extracted chunk text:', chunkText);
            chunkQueue.push({ chunk: chunkText, isLast: isComplete });
            processQueue();
        }
    } catch (e) {
        console.error('[Interceptor] Error parsing chunk:', e);
    }
};

// Update the fetch override with more specific request matching
window.fetch = async function(...args) {
    const [url, options] = args;
    
    // Only intercept POST requests to the exact conversation endpoint
    const shouldIntercept = 
        url.endsWith('/backend-api/conversation') && 
        options?.method === 'POST';
    
    const response = await originalFetch.apply(this, args);

    if (!shouldIntercept) return response;
    
    const [stream1, stream2] = response.body.tee();
    currentReader = stream2.getReader();

    (async () => {
        try {
            while (true) {
                if (shouldIgnoreProcessing || !currentReader) {
                    console.log('[Interceptor] Stream processing stopped:', { 
                        shouldIgnoreProcessing, 
                        hasReader: !!currentReader 
                    });
                    if (currentReader) {
                        currentReader.cancel();
                        currentReader = null;
                    }
                    break;
                }
                
                const {done, value} = await currentReader.read();
                if (done) {
                    console.log('[Interceptor] Stream complete');
                    currentReader = null;
                    break;
                }

                const chunk = new TextDecoder().decode(value);
                for (const event of chunk.split('\n\n')) {
                    const dataLine = event.split('\n').find(line => line.startsWith('data: '));
                    if (!dataLine) continue;

                    const data = dataLine.slice(6);
                    if (data === '[DONE]') {
                        if (pendingText) {
                            chunkQueue.push({ chunk: pendingText, isLast: true });
                            processQueue();
                        }
                        resetChatState();
                        continue;
                    }

                    processEventData(data);
                }
            }
        } catch (error) {
            console.error('[Interceptor] Stream processing error:', error);
        }
    })();

    return new Response(stream1, response);
};




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