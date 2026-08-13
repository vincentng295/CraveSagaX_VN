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

function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Kiểm tra 1 lỗi có phải do HTTP 429 (quota/rate-limit) hay không, để quyết
// định có nên tự động thử lại hay không (các lỗi khác như API Key sai, 400...
// thì retry cũng vô ích nên không retry).
function isRateLimitError(err) {
    return !!err && /HTTP 429/.test(err.message || String(err));
}

const GEMMA_MAX_RETRIES = 3;
const GEMMA_RETRY_DELAY_MS = 30000; // 30s

// Gọi streamGenerateContent 1 lần, trả về rawText đã gộp từ các chunk SSE.
async function callGeminiStreamOnce(url, contents) {
    // Dùng streamGenerateContent (SSE) thay vì generateContent: với các lô dịch
    // dài, generateContent giữ kết nối im lặng cho tới khi có response hoàn
    // chỉnh, dễ bị proxy/trình duyệt coi là treo và tự huỷ ("Failed to fetch").
    // streamGenerateContent trả dữ liệu ngay khi có chunk đầu tiên nên connection
    // luôn "sống", giảm hẳn tình trạng fetch thất bại giữa chừng.
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents,
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

    if (!res.body) {
        throw new Error('Trình duyệt không hỗ trợ đọc response dạng stream.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let rawText = '';

    function consumeSseEvent(eventBlock) {
        // Mỗi event SSE gồm nhiều dòng, chỉ quan tâm các dòng "data: {...}"
        const lines = eventBlock.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            let chunkData;
            try {
                chunkData = JSON.parse(jsonStr);
            } catch (e) {
                continue; // bỏ qua chunk JSON lỗi/không trọn vẹn
            }

            // Phòng trường hợp thinkingBudget:0 không được model tôn trọng hoàn toàn,
            // vẫn lọc bỏ mọi part có "thought": true trước khi ghép text lại.
            const parts = chunkData?.candidates?.[0]?.content?.parts || [];
            for (const p of parts) {
                if (!p.thought && p.text) rawText += p.text;
            }
        }
    }

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events cách nhau bởi dòng trống ("\n\n")
        let sepIndex;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
            const eventBlock = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);
            consumeSseEvent(eventBlock);
        }
    }
    // Xử lý phần còn sót lại trong buffer (nếu stream kết thúc không có \n\n cuối)
    if (buffer.trim()) consumeSseEvent(buffer);

    return rawText;
}

// Gọi callGeminiStreamOnce, tự động thử lại nếu gặp lỗi 429 (quota exceeded):
// chờ 30s rồi thử lại, tối đa 3 lần thử (1 lần đầu + 2 lần retry).
async function callGeminiStreamWithRetry(url, contents, onRetryNotice) {
    let lastErr;
    for (let attempt = 1; attempt <= GEMMA_MAX_RETRIES; attempt++) {
        try {
            return await callGeminiStreamOnce(url, contents);
        } catch (err) {
            lastErr = err;
            const isLastAttempt = attempt >= GEMMA_MAX_RETRIES;
            if (!isRateLimitError(err) || isLastAttempt) {
                throw err;
            }
            console.warn(`[Gemma] HTTP 429, thử lại sau 30s (lần ${attempt}/${GEMMA_MAX_RETRIES})...`);
            if (typeof onRetryNotice === 'function') {
                onRetryNotice(attempt, GEMMA_MAX_RETRIES);
            }
            await sleepMs(GEMMA_RETRY_DELAY_MS);
        }
    }
    throw lastErr;
}

window.addEventListener('message', async (event) => {
    if (!event.data || event.data.type !== 'GEMMA_BATCH_REQUEST') return;

    const { requestId, apiKey, modelId, contents } = event.data;

    if (!requestId) return;

    if (!apiKey) {
        window.postMessage({ type: 'GEMMA_BATCH_RESULT', requestId, error: 'Thiếu API Key' }, '*');
        return;
    }

    if (!Array.isArray(contents) || contents.length === 0) {
        window.postMessage({ type: 'GEMMA_BATCH_RESULT', requestId, error: 'Thiếu nội dung hội thoại (contents)' }, '*');
        return;
    }

    try {
        // "contents" ở đây là cả lịch sử hội thoại (nhiều turn user/model của các
        // lô 40 câu trước đó) do injected.js gửi sang — chuyển tiếp nguyên vẹn để
        // model thấy được ngữ cảnh đã dịch trước, thay vì chỉ 1 prompt đơn lẻ.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

        const rawText = await callGeminiStreamWithRetry(url, contents, (attempt, max) => {
            window.postMessage({
                type: 'GEMMA_BATCH_RETRY',
                requestId,
                attempt,
                max,
                delayMs: GEMMA_RETRY_DELAY_MS
            }, '*');
        });

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