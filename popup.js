document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const saveButton = document.getElementById('save');
    const status = document.getElementById('status');

    // Load existing API key
    chrome.storage.local.get(['elevenLabsKey'], (result) => {
        if (result.elevenLabsKey) {
            apiKeyInput.value = result.elevenLabsKey;
        }
    });

    saveButton.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        
        if (!apiKey) {
            status.textContent = 'Please enter an API key';
            status.style.color = '#ff4444';
            return;
        }

        // Show loading state
        saveButton.disabled = true;
        status.textContent = 'Validating API key...';
        status.style.color = '#666';

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'VALIDATE_API_KEY',
                apiKey: apiKey
            });

            if (response.isValid) {
                // Save the API key if valid
                chrome.storage.local.set({ elevenLabsKey: apiKey }, () => {
                    status.textContent = 'API key validated and saved successfully!';
                    status.style.color = '#44bb44';
                    setTimeout(() => {
                        status.textContent = '';
                    }, 2000);
                });
            } else {
                status.textContent = response.error || 'Invalid API key';
                status.style.color = '#ff4444';
            }
        } catch (error) {
            status.textContent = 'Error validating API key';
            status.style.color = '#ff4444';
        } finally {
            saveButton.disabled = false;
        }
    });
}); 