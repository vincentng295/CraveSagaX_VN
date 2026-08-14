// Cấu hình chọn công cụ dịch (Google Dịch / Gemma-Gemini API) cho Popup.
document.addEventListener('DOMContentLoaded', () => {
    const engineSelect = document.getElementById('engine-select');
    const keyRow = document.getElementById('engine-key-row');
    const apiKeyInput = document.getElementById('engine-api-key');
    const apiKeySelect = document.getElementById('gemini-api-key-select');
    const btnSaveKey = document.getElementById('btn-engine-key-save');
    const hintEl = document.getElementById('engine-hint');

    if (!engineSelect) return;

    let availableKeys = [];

    function setupApiKeyUI(selectedKey) {
        if (!apiKeyInput || !apiKeySelect) return;

        if (availableKeys.length > 0) {
            apiKeyInput.style.display = 'none';
            apiKeySelect.style.display = 'block';
            apiKeySelect.innerHTML = '<option value="">-- Chọn API Key --</option>';

            let isMatched = false;
            availableKeys.forEach((item) => {
                const opt = document.createElement('option');
                opt.value = item.key;
                opt.textContent = `${item.name} (${item.key.slice(0, 8)}...)`;
                if (item.key === selectedKey) {
                    opt.selected = true;
                    isMatched = true;
                }
                apiKeySelect.appendChild(opt);
            });

            if (!isMatched && selectedKey) {
                const customOpt = document.createElement('option');
                customOpt.value = selectedKey;
                customOpt.textContent = `Custom (${selectedKey.slice(0, 8)}...)`;
                customOpt.selected = true;
                apiKeySelect.appendChild(customOpt);
            }
        } else {
            apiKeySelect.style.display = 'none';
            apiKeyInput.style.display = 'block';
            apiKeyInput.value = selectedKey;
        }
    }

    function refreshUI(engine) {
        const isGemma = engine === 'gemma';
        keyRow.style.display = isGemma ? 'flex' : 'none';
        hintEl.textContent = isGemma
            ? 'Câu thoại trong file sẽ được gộp lô gửi Gemma; label hiển thị realtime vẫn dùng Google Dịch.'
            : '';
    }

    chrome.storage.local.get({
        translateEngine: 'google',
        geminiApiKey: '',
        fetchedApiKeys: []
    }, (result) => {
        engineSelect.value = result.translateEngine || 'google';
        availableKeys = result.fetchedApiKeys || [];

        setupApiKeyUI(result.geminiApiKey || '');
        refreshUI(engineSelect.value);
    });

    engineSelect.addEventListener('change', () => {
        refreshUI(engineSelect.value);
        chrome.storage.local.set({ translateEngine: engineSelect.value });
    });

    btnSaveKey.addEventListener('click', () => {
        let key = '';
        if (availableKeys.length > 0 && apiKeySelect) {
            key = apiKeySelect.value.trim();
        } else if (apiKeyInput) {
            key = apiKeyInput.value.trim();
        }

        if (!key) {
            alert('Vui lòng chọn hoặc nhập Gemini API Key.');
            return;
        }

        chrome.storage.local.set({ geminiApiKey: key }, () => {
            const original = btnSaveKey.innerText;
            btnSaveKey.innerText = '✓';
            btnSaveKey.classList.add('saved');
            setTimeout(() => {
                btnSaveKey.innerText = original;
                btnSaveKey.classList.remove('saved');
            }, 1200);
        });
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
            if (changes.translateEngine) {
                engineSelect.value = changes.translateEngine.newValue || 'google';
                refreshUI(engineSelect.value);
            }
            if (changes.fetchedApiKeys) {
                availableKeys = changes.fetchedApiKeys.newValue || [];
                chrome.storage.local.get({ geminiApiKey: '' }, (res) => {
                    setupApiKeyUI(res.geminiApiKey || '');
                });
            }
        }
    });
});