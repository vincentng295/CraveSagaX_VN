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

let localDictCache = {};
let isDictLoaded = false;
let pendingQueue = [];
let saveTimeout = null;

// Chap thực sự đang được load/chơi ở thời điểm hiện tại (khác với chap của
// entry mới nhất trong từ điển, vì entry cũ không được cập nhật lại khi
// người dùng mở lại 1 chap đã dịch trước đó).
let lastKnownChap = null;
let currentChapSaveTimeout = null;

function updateCurrentChap(chap) {
    if (!chap || chap === lastKnownChap) return;
    lastKnownChap = chap;

    if (currentChapSaveTimeout) clearTimeout(currentChapSaveTimeout);
    currentChapSaveTimeout = setTimeout(() => {
        chrome.storage.local.set({
            currentChap: { chap, time: Math.floor(Date.now() / 1000) }
        });
    }, 150);
}

function syncDictToInjected() {
    window.postMessage({ type: 'GAME_DICT_UPDATE', dict: localDictCache }, '*');
}

function initDictCache() {
    chrome.storage.local.get({ translationDict: {} }, (result) => {
        localDictCache = result.translationDict || {};
        isDictLoaded = true;

        if (pendingQueue.length > 0) {
            pendingQueue.forEach(item => processSingleTranslation(item));
            pendingQueue = [];
            scheduleSaveToStorage();
        } else {
            syncDictToInjected();
        }
    });
}

function processSingleTranslation(data) {
    const { original, translated, speaker, chap, seq } = data;
    if (!original) return;

    const existingEntry = localDictCache[original];

    if (!existingEntry) {
        localDictCache[original] = {
            translated: translated || '',
            name: speaker || null,
            chap: chap || null,
            time: Math.floor(Date.now() / 1000),
            ...(typeof seq === 'number' ? { seq } : {})
        };
        return;
    }

    const oldTranslated = typeof existingEntry === 'string' ? existingEntry : existingEntry.translated;
    if ((!oldTranslated || !oldTranslated.trim()) && translated && translated.trim()) {
        if (typeof existingEntry === 'string') {
            localDictCache[original] = {
                translated: translated,
                name: speaker || null,
                chap: chap || null,
                time: Math.floor(Date.now() / 1000),
                ...(typeof seq === 'number' ? { seq } : {})
            };
        } else {
            localDictCache[original] = {
                ...existingEntry,
                translated: translated,
                name: existingEntry.name || speaker || null,
                chap: existingEntry.chap || chap || null
            };
        }
    }
}

function scheduleSaveToStorage() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        chrome.storage.local.set({ translationDict: localDictCache }, () => {
            syncDictToInjected();
        });
    }, 300);
}

initDictCache();

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SAVE_NEW_TRANSLATION') {
        if (event.data.chap) updateCurrentChap(event.data.chap);

        if (!isDictLoaded) {
            pendingQueue.push(event.data);
        } else {
            processSingleTranslation(event.data);
            scheduleSaveToStorage();
        }
    }
});