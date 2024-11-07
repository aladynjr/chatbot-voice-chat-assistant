const originalFetch = window.fetch;
const sentChunks = new Set();
let pendingChunk = '';

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

// Helper function to count words
const countWords = (text) => text.trim().split(/\s+/).length;

// Helper to find the last sentence break
const findLastSentenceBreak = (text) => {
    // Order of precedence for break points
    const breakPoints = [
        text.lastIndexOf('. '),   // Period with space
        text.lastIndexOf('? '),   // Question mark with space
        text.lastIndexOf('! '),   // Exclamation with space
        text.lastIndexOf('; '),   // Semicolon with space
        text.lastIndexOf(': '),   // Colon with space
        text.lastIndexOf(', ')    // Comma with space
    ];

    // Find the last occurring break point
    const lastBreak = Math.max(...breakPoints);
    return lastBreak >= 0 ? lastBreak + 2 : -1; // +2 to include the punctuation and space
};

// Combined send function
const processChunk = (chunk, forceSend = false) => {
    const cleanedChunk = cleanChunkText(chunk);
    if (cleanedChunk.length <= 1) return;

    if (!pendingChunk) {
        pendingChunk = cleanedChunk;
    } else {
        pendingChunk = `${pendingChunk} ${cleanedChunk}`.trim();
    }

    // Check if we should process the pending chunk
    if (forceSend || countWords(pendingChunk) >= 20) {
        const breakPoint = findLastSentenceBreak(pendingChunk);
        
        if (breakPoint > 0) {
            // Split at the last sentence break
            const toSend = pendingChunk.substring(0, breakPoint).trim();
            const remaining = pendingChunk.substring(breakPoint).trim();
            
            if (!sentChunks.has(toSend)) {
                sentChunks.add(toSend);
                window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: toSend }, '*');
            }
            
            pendingChunk = remaining; // Keep the remainder for the next chunk
        } else if (forceSend) {
            // If no break point found and force send, send everything
            if (!sentChunks.has(pendingChunk)) {
                sentChunks.add(pendingChunk);
                window.postMessage({ type: 'CHATGPT_RESPONSE', chunk: pendingChunk }, '*');
            }
            pendingChunk = '';
        }
    }
};

window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    if (!args[0].includes('/backend-api/conversation')) return response;
    
    const [stream1, stream2] = response.body.tee();
    const reader = stream2.getReader();
    
    (async () => {
        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                
                const chunk = new TextDecoder().decode(value);
                for (const event of chunk.split('\n\n')) {
                    const dataLine = event.split('\n').find(line => line.startsWith('data: '));
                    if (!dataLine) continue;
                    
                    try {
                        const data = dataLine.slice(6);
                        if (data === '[DONE]') {
                            if (pendingChunk) processChunk(pendingChunk, true); // Force send remaining chunk
                            sentChunks.clear();
                            continue;
                        }
                        
                        const parsed = JSON.parse(data);
                        if (parsed.v?.message?.author?.role === 'user') continue;
                        
                        const chunkText = extractChunkText(parsed);
                        if (chunkText) processChunk(chunkText);
                        
                    } catch (e) {
                        console.error('Error parsing chunk:', e);
                    }
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') console.error('Stream processing error:', error);
        }
    })();
    
    return new Response(stream1, response);
};