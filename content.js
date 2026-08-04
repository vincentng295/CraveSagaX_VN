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
            if (!dict[original]) {
                // "time" (unix giây) vẫn giữ nguyên ý nghĩa cũ: thời điểm content.js
                // NHẬN được message này — chỉ dùng để HIỂN THỊ ở trang Options.
                // "seq" mới là mốc dùng để SẮP XẾP: injected.js đã chụp lại giá trị
                // này ngay tại thời điểm câu thoại được xử lý (đồng bộ, đúng thứ tự
                // xuất hiện trong file kịch bản), nên không bị xáo trộn bởi việc các
                // request dịch song song hoàn thành không theo đúng thứ tự. Ở đây chỉ
                // lưu lại nguyên giá trị nhận được, không tự tính toán gì thêm.
                // "name" giữ nguyên là null nếu không rõ nhân vật (tương thích ngược).
                dict[original] = {
                    translated,
                    name: speaker || null,
                    time: Math.floor(Date.now() / 1000),
                    ...(typeof seq === 'number' ? { seq } : {})
                };
                chrome.storage.local.set({ translationDict: dict }, () => {
                    syncDictToInjected(); // Đồng bộ lại sau khi lưu
                });
            }
        });
    }
});