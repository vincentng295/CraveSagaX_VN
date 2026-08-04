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
        const { original, translated, speaker, seq } = event.data;
        chrome.storage.local.get({ translationDict: {} }, (result) => {
            const dict = result.translationDict;
            const existingEntry = dict[original];

            // 1. Nếu chưa có câu thoại này trong dict -> Lưu mới
            if (!existingEntry) {
                dict[original] = {
                    translated: translated || '',
                    name: speaker || null,
                    time: Math.floor(Date.now() / 1000),
                    ...(typeof seq === 'number' ? { seq } : {})
                };
                chrome.storage.local.set({ translationDict: dict }, () => {
                    syncDictToInjected();
                });
                return;
            }

            // 2. Nếu đã tồn tại nhưng trước đó bị trống ("") và lần này có bản dịch thành công
            // -> Cập nhật bản dịch mới, GIỮ NGUYÊN time và seq cũ
            const oldTranslated = typeof existingEntry === 'string' ? existingEntry : existingEntry.translated;
            if ((!oldTranslated || !oldTranslated.trim()) && translated && translated.trim()) {
                if (typeof existingEntry === 'string') {
                    dict[original] = {
                        translated: translated,
                        name: speaker || null,
                        time: Math.floor(Date.now() / 1000),
                        ...(typeof seq === 'number' ? { seq } : {})
                    };
                } else {
                    dict[original] = {
                        ...existingEntry,
                        translated: translated,
                        // Nếu câu cũ chưa có name thì bổ sung name mới
                        name: existingEntry.name || speaker || null 
                    };
                }
                chrome.storage.local.set({ translationDict: dict }, () => {
                    syncDictToInjected();
                });
            }
        });
    }
});