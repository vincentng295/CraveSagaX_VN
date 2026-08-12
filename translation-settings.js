// Cấu hình chọn công cụ dịch (Google Dịch / Gemma-Gemini API) dùng chung cho Options page.
document.addEventListener('DOMContentLoaded', () => {
    const engineSelect = document.getElementById('engine-select');
    const apiKeyInput = document.getElementById('gemini-api-key');
    const btnSaveEngine = document.getElementById('btn-save-engine');
    const statusEl = document.getElementById('engine-save-status');
    if (!engineSelect) return; // trang không có block cấu hình này

    function refreshApiKeyVisibility() {
        const showKeyField = engineSelect.value === 'gemma';
        apiKeyInput.style.display = showKeyField ? '' : 'none';
        btnSaveEngine.style.display = showKeyField ? '' : 'none';
    }

    chrome.storage.local.get({ translateEngine: 'google', geminiApiKey: '' }, (result) => {
        engineSelect.value = result.translateEngine || 'google';
        apiKeyInput.value = result.geminiApiKey || '';
        refreshApiKeyVisibility();
    });

    engineSelect.addEventListener('change', () => {
        refreshApiKeyVisibility();
        chrome.storage.local.set({ translateEngine: engineSelect.value });
        statusEl.textContent = 'Đã chuyển công cụ dịch.';
        setTimeout(() => { statusEl.textContent = ''; }, 1500);
    });

    btnSaveEngine.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            alert('Vui lòng nhập Gemini API Key.');
            return;
        }
        chrome.storage.local.set({ geminiApiKey: key }, () => {
            statusEl.textContent = '✓ Đã lưu API Key.';
            setTimeout(() => { statusEl.textContent = ''; }, 1500);
        });
    });
});
