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

// Đọc/đồng bộ cấu hình công cụ dịch (Google Dịch hoặc Gemma/Gemini API) vào main world
function syncEngineSettings(engine, apiKey) {
    window.postMessage({ type: 'GAME_ENGINE_UPDATE', engine: engine || 'google', apiKey: apiKey || '' }, '*');
}

chrome.storage.local.get({ translateEngine: 'google', geminiApiKey: '' }, (result) => {
    syncEngineSettings(result.translateEngine, result.geminiApiKey);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.translateEngine || changes.geminiApiKey)) {
        chrome.storage.local.get({ translateEngine: 'google', geminiApiKey: '' }, (result) => {
            syncEngineSettings(result.translateEngine, result.geminiApiKey);
        });
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
    if (event.data && event.data.type === 'GAME_CHAP_OPENED' && event.data.chap) {
        updateCurrentChap(event.data.chap);
    }
});

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

// ==== Relay gọi Gemini/Gemma API thay cho injected.js ====
// injected.js chạy ở MAIN world nên không có host_permissions bypass CORS.
// content.js chạy ở isolated world nên fetch() ở đây mới gọi được thẳng tới
// generativelanguage.googleapis.com mà không bị CORS chặn.
window.addEventListener('message', async (event) => {
    if (!event.data || event.data.type !== 'GEMMA_BATCH_REQUEST') return;

    const { requestId, apiKey, modelId, promptText } = event.data;

    if (!requestId) return;

    if (!apiKey) {
        window.postMessage({ type: 'GEMMA_BATCH_RESULT', requestId, error: 'Thiếu API Key' }, '*');
        return;
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: promptText }] }],
                generationConfig: {
                    temperature: 0.35,
                    responseMimeType: 'application/json',
                    thinkingConfig: {
                        thinkingLevel: 'MINIMAL'
                    }
                }
            })
        });

        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${errBody}`);
        }

        const data = await res.json();
        // Phòng trường hợp thinkingBudget:0 không được model tôn trọng hoàn toàn,
        // vẫn lọc bỏ mọi part có "thought": true trước khi ghép text lại.
        const rawText = (data?.candidates?.[0]?.content?.parts || [])
            .filter((p) => !p.thought)
            .map((p) => p.text || '')
            .join('') || '';
        window.postMessage({ type: 'GEMMA_BATCH_RESULT', requestId, rawText }, '*');
    } catch (err) {
        window.postMessage({ type: 'GEMMA_BATCH_RESULT', requestId, error: err.message || String(err) }, '*');
    }
});

// Lắng nghe sự kiện thay đổi storage từ Options hoặc Popup
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.translationDict) {
        localDictCache = changes.translationDict.newValue || {};
        isDictLoaded = true;
        syncDictToInjected();
    }
});