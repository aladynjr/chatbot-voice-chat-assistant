const originalFetch = window.fetch;
const sentSentences = new Set();
let pendingText = '';
let isMessageComplete = false;
const chunkQueue = [];
let isProcessing = false;
let shouldIgnoreProcessing = false;
let currentReader = null;
let currentAuthorRole = null;
let currentOperation = null;
let isOperationData = false;

const resetChatState = () => {
    console.log('Resetting chat state');
    pendingText = '';
    sentSentences.clear();
    isMessageComplete = false;
    chunkQueue.length = 0;
    shouldIgnoreProcessing = false;
    isProcessing = false;
    currentAuthorRole = null;
    currentOperation = null;
    isOperationData = false;
};

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
    return text ? (/^[A-Z]/.test(text) ? ' ' + text : text) : '';
};

const removeMarkdown = (md, options = {}) => {
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
        output = output.replace(/^(-\s*?|\*\s*?|_\s*?){3,}\s*/gm, '');
        if (options.stripListLeaders) {
            if (options.listUnicodeChar) {
                output = output.replace(/^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm, options.listUnicodeChar + ' $1');
            } else {
                output = output.replace(/^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm, '$1');
            }
        }
        if (options.gfm) {
            output = output
                .replace(/\n={2,}/g, '\n')
                .replace(/~{3}.*\n/g, '')
                .replace(/~~/g, '')
                .replace(/`{3}.*\n/g, '');
        }
        output = output
            .replace(/<[^>]*>/g, '')
            .replace(/^[=\-]{2,}\s*$/g, '')
            .replace(/\[\^.+?\](\: .*?$)?/g, '')
            .replace(/\s{0,2}\[.*?\]: .*?$/g, '')
            .replace(/\!\[(.*?)\][\[\(].*?[\]\)]/g, options.useImgAltText ? '$1' : '')
            .replace(/\[([^\]]*?)\][\[\(].*?[\]\)]/g, options.replaceLinksWithURL ? '$2' : '$1')
            .replace(/^(\n)?\s{0,3}>\s?/gm, '$1')
            .replace(/^\s{1,2}\[(.*?)\]: (\S+)( ".*?")?\s*$/g, '')
            .replace(/^(\n)?\s{0,}#{1,6}\s*( (.+))? +#+$|^(\n)?\s{0,}#{1,6}\s*( (.+))?$/gm, '$1$3$4$6')
            .replace(/([\*]+)(\S)(.*?\S)??\1/g, '$2$3')
            .replace(/(^|\W)([_]+)(\S)(.*?\S)??\2($|\W)/g, '$1$3$4$5')
            .replace(/(`{3,})(.*?)\1/gm, '$2')
            .replace(/`(.+?)`/g, '$1')
            .replace(/~(.*?)~/g, '$1');
        return output;
    } catch (e) {
        console.error("remove-markdown encountered error:", e);
        return md;
    }
};

const splitIntoSentences = (text) => {
    const sentences = text.match(/[^.!?]+(?:[.!?](?:[ \n\r]|$))+/g) || [];
    return sentences
        .map(sentence => sentence.trim())
        .filter(sentence => {
            return sentence.length > 10 &&
                   !/^[A-Z]\.$/.test(sentence) &&
                   !/^\s*$/.test(sentence) &&
                   !/^[^a-zA-Z]*$/.test(sentence) &&
                   !sentence.endsWith('...');
        });
};

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

        const cleanedChunk = chunk
            .replace(/【[^】]+】/g, '')
            .replace(/\[\d+\†source\]/g, '')
            .replace(/\s+/g, ' ');

        if (cleanedChunk.length <= 1) continue;

        const shouldAddSpace = /^[A-Z]/.test(cleanedChunk);
        pendingText += shouldAddSpace ? ' ' + cleanedChunk : cleanedChunk;

        console.log('Current pendingText:', pendingText);
        
        if (isLast || pendingText.match(/[.!?](?:[ \n\r]|$)/)) {
            let processedText = removeMarkdown(pendingText);
            const sentences = splitIntoSentences(processedText);
            
            if (isLast && pendingText.trim() && sentences.length === 0) {
                const finalText = pendingText.trim();
                if (!sentSentences.has(finalText)) {
                    window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: finalText }, '*');
                    sentSentences.add(finalText);
                }
                pendingText = '';
            } else if (sentences.length > 0) {
                let lastIndex = 0;
                sentences.forEach((sentence, index) => {
                    const trimmedSentence = sentence.trim();
                    if (trimmedSentence && !sentSentences.has(trimmedSentence)) {
                        window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: trimmedSentence }, '*');
                        sentSentences.add(trimmedSentence);
                        lastIndex = pendingText.indexOf(sentence) + sentence.length;
                    }
                });
                pendingText = pendingText.slice(lastIndex).trim();
            }
        }
    }

    isProcessing = false;
};

const isValidContentPath = (path) => {
    if (!path) return false;
    return /^\/message\/content\/parts\/\d+$/.test(path);
};

const processEventData = (data) => {
    if (shouldIgnoreProcessing) {
        console.log('[Interceptor] Skipping chunk - shouldIgnoreProcessing is true');
        return;
    }
    
    try {
        const parsed = JSON.parse(data);
  
        if (parsed.v?.message?.author?.role) {
            currentAuthorRole = parsed.v.message.author.role;
        }

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

        if (currentOperation && parsed.v && typeof parsed.v === 'string' && !parsed.p) {
            return;
        }

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

        if (currentAuthorRole !== 'assistant' || isOperationData) {
            return;
        }

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

window.fetch = async function(...args) {
    const [url, options] = args;
    
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

window.clearInterceptorState = (immediate = false) => {
    console.log('Clearing interceptor state');
    shouldIgnoreProcessing = true;
    chunkQueue.length = 0;
    pendingText = '';
    sentSentences.clear();
    isMessageComplete = true;
    isProcessing = false;
    currentAuthorRole = null;
    
    if (currentReader) {
        currentReader.cancel();
        currentReader = null;
    }

    setTimeout(() => {
        shouldIgnoreProcessing = false;
        console.log('Reset shouldIgnoreProcessing to false');
    }, 100);
};

window.addEventListener('message', (event) => {
    if (event.data.type === 'CLEAR_INTERCEPTOR_STATE') {
        window.clearInterceptorState(event.data.immediate);
    }
});