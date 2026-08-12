// Cấu hình chọn công cụ dịch (Google Dịch / Gemma-Gemini API) cho Popup.
document.addEventListener('DOMContentLoaded', () => {
    const engineSelect = document.getElementById('engine-select');
    const keyRow = document.getElementById('engine-key-row');
    const apiKeyInput = document.getElementById('engine-api-key');
    const btnSaveKey = document.getElementById('btn-engine-key-save');
    const hintEl = document.getElementById('engine-hint');
    if (!engineSelect) return;

    function refreshUI(engine) {
        const isGemma = engine === 'gemma';
        keyRow.style.display = isGemma ? 'flex' : 'none';
        hintEl.textContent = isGemma
            ? 'Câu thoại trong file sẽ được gộp lô gửi Gemma; label hiển thị realtime vẫn dùng Google Dịch.'
            : '';
    }

    chrome.storage.local.get({ translateEngine: 'google', geminiApiKey: '' }, (result) => {
        engineSelect.value = result.translateEngine || 'google';
        apiKeyInput.value = result.geminiApiKey || '';
        refreshUI(engineSelect.value);
    });

    engineSelect.addEventListener('change', () => {
        refreshUI(engineSelect.value);
        chrome.storage.local.set({ translateEngine: engineSelect.value });
    });

    btnSaveKey.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            alert('Vui lòng nhập Gemini API Key.');
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
        if (areaName === 'local' && changes.translateEngine) {
            engineSelect.value = changes.translateEngine.newValue || 'google';
            refreshUI(engineSelect.value);
        }
    });
});
