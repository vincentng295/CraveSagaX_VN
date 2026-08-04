// Đọc trạng thái ban đầu khi load trang và gửi vào main world
chrome.storage.local.get({ translateEnabled: true }, (result) => {
    window.postMessage({ type: 'GAME_TRANSLATION_STATE_UPDATE', enabled: result.translateEnabled }, '*');
});

// Nhận message từ Popup gửi đến và forward tiếp cho injected.js
chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'SET_TRANSLATION_STATE') {
        window.postMessage({ type: 'GAME_TRANSLATION_STATE_UPDATE', enabled: message.enabled }, '*');
    }
});

// Gửi Dictionary ban đầu vào main world
function syncDictToInjected() {
    chrome.storage.local.get({ translationDict: {} }, (result) => {
        window.postMessage({ type: 'GAME_DICT_UPDATE', dict: result.translationDict }, '*');
    });
}

syncDictToInjected();

// Lắng nghe lệnh lưu câu dịch mới từ injected.js
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SAVE_NEW_TRANSLATION') {
        const { original, translated } = event.data;
        chrome.storage.local.get({ translationDict: {} }, (result) => {
            const dict = result.translationDict;
            if (!dict[original]) {
                dict[original] = translated;
                chrome.storage.local.set({ translationDict: dict }, () => {
                    syncDictToInjected(); // Đồng bộ lại sau khi lưu
                });
            }
        });
    }
});