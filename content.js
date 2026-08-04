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

// --- QUẢN LÝ TỪ ĐIỂN TRONG BỘ NHỚ RAM ĐỂ TRÁNH RACE CONDITION ---
let localDictCache = {};
let isDictLoaded = false;
let pendingQueue = [];
let saveTimeout = null;

// Gửi Dictionary hiện tại trong memory vào main world cho injected.js
function syncDictToInjected() {
    window.postMessage({ type: 'GAME_DICT_UPDATE', dict: localDictCache }, '*');
}

// Khởi tạo và tải Dictionary từ Storage lên Memory 1 lần duy nhất
function initDictCache() {
    chrome.storage.local.get({ translationDict: {} }, (result) => {
        localDictCache = result.translationDict || {};
        isDictLoaded = true;

        // Xử lý các câu thoại gửi đến trong lúc chờ Storage load xong
        if (pendingQueue.length > 0) {
            pendingQueue.forEach(item => processSingleTranslation(item));
            pendingQueue = [];
            scheduleSaveToStorage();
        } else {
            syncDictToInjected();
        }
    });
}

// Cập nhật 1 câu thoại vào bộ nhớ RAM
function processSingleTranslation(data) {
    const { original, translated, speaker, seq } = data;
    if (!original) return;

    const existingEntry = localDictCache[original];

    // Trường hợp 1: Chưa có trong dict -> Lưu mới
    if (!existingEntry) {
        localDictCache[original] = {
            translated: translated || '',
            name: speaker || null,
            time: Math.floor(Date.now() / 1000),
            ...(typeof seq === 'number' ? { seq } : {})
        };
        return;
    }

    // Trường hợp 2: Đã tồn tại nhưng bản dịch cũ bị trống ("") và lần này dịch thành công
    const oldTranslated = typeof existingEntry === 'string' ? existingEntry : existingEntry.translated;
    if ((!oldTranslated || !oldTranslated.trim()) && translated && translated.trim()) {
        if (typeof existingEntry === 'string') {
            localDictCache[original] = {
                translated: translated,
                name: speaker || null,
                time: Math.floor(Date.now() / 1000),
                ...(typeof seq === 'number' ? { seq } : {})
            };
        } else {
            localDictCache[original] = {
                ...existingEntry,
                translated: translated,
                name: existingEntry.name || speaker || null 
            };
        }
    }
}

// Gom nhiều lần cập nhật liên tiếp để ghi xuống chrome.storage.local một lần
function scheduleSaveToStorage() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        chrome.storage.local.set({ translationDict: localDictCache }, () => {
            syncDictToInjected();
        });
    }, 300); // Đợi 300ms sau câu thoại cuối cùng rồi mới ghi ổ đĩa
}

// Bắt đầu load cache
initDictCache();

// Lắng nghe lệnh lưu câu dịch mới từ injected.js
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SAVE_NEW_TRANSLATION') {
        if (!isDictLoaded) {
            pendingQueue.push(event.data);
        } else {
            processSingleTranslation(event.data);
            scheduleSaveToStorage();
        }
    }
});