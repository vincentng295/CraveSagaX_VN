// ==== Kênh riêng (MessageChannel) giữa content.js (isolated world) và
// injected.js (MAIN world) ====
// window.postMessage(data, '*') mặc định phát cho MỌI listener đang gắn trên
// window, kể cả code của chính trang game (hoặc bất kỳ script nào khác được
// nhúng vào trang) — không có cách nào giới hạn "chỉ gửi cho extension" với
// kiểu postMessage này. MessagePort thì khác: 1 khi 1 đầu port đã được
// transfer sang phía kia, chỉ 2 đầu giữ port mới đọc/ghi được message đi
// qua port đó; trang game (hay code khác) dù có gắn 'message' listener trên
// window cũng không thấy được các message đi qua port.
//
// Cách làm: tạo 1 MessageChannel ở đây, giữ lại port1, rồi "chuyển giao"
// port2 sang injected.js đúng 1 LẦN DUY NHẤT bằng window.postMessage (bước
// duy nhất còn dùng window.postMessage, và nó không mang dữ liệu gì ngoài
// chiếc port rỗng). Việc này chạy ngay ở document_start, trước khi bất kỳ
// script nào của trang có cơ hội gắn listener để "chặn tay trên" — nên rủi
// ro bị trang lấy mất port gần như bằng 0 trên thực tế.
const __extChannel = new MessageChannel();
const injectedPort = __extChannel.port1;
injectedPort.start();

function sendToInjected(data) {
    injectedPort.postMessage(data);
}

window.postMessage({ type: '__EXT_PORT_INIT__' }, '*', [__extChannel.port2]);

// Đọc trạng thái ban đầu khi load trang và gửi vào main world
chrome.storage.local.get({ translateEnabled: true }, (result) => {
    sendToInjected({ type: 'GAME_TRANSLATION_STATE_UPDATE', enabled: result.translateEnabled });
});

// Nhận message từ Popup gửi đến và forward tiếp cho injected.js
chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'SET_TRANSLATION_STATE') {
        sendToInjected({ type: 'GAME_TRANSLATION_STATE_UPDATE', enabled: message.enabled });
    }
});

// Đọc/đồng bộ cấu hình công cụ dịch (Google Dịch hoặc Gemma/Gemini API) vào main world
function syncEngineSettings(engine, apiKey) {
    sendToInjected({ type: 'GAME_ENGINE_UPDATE', engine: engine || 'google', apiKey: apiKey || '' });
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
    sendToInjected({ type: 'GAME_DICT_UPDATE', dict: localDictCache });
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

injectedPort.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GAME_CHAP_OPENED' && event.data.chap) {
        updateCurrentChap(event.data.chap);
    }
});

// ==== Cache toàn văn (nguyên thứ tự dòng) .txt gốc + bản dịch theo từng chap ====
// Dùng riêng cho tính năng Export .doc, KHÔNG dùng translationDict vì dict lưu
// theo câu rời rạc, không giữ thứ tự và có thể thiếu câu (câu đã dịch ở chap khác).
const STORY_FILE_CACHE_MAX_ENTRIES = 30;

let storyCacheWriteChain = Promise.resolve();

// Số entry sẽ bị cắt bớt mỗi lần gặp lỗi quota, để thử ghi lại với cache nhỏ hơn
// thay vì mất trắng dữ liệu vừa thu thập được.
const STORY_FILE_CACHE_SHRINK_STEP = 5;
const STORY_FILE_CACHE_MIN_ENTRIES = 5;

function pruneStoryCache(cache, maxEntries) {
    const keys = Object.keys(cache);
    if (keys.length > maxEntries) {
        keys
            .sort((a, b) => (cache[a].time || 0) - (cache[b].time || 0))
            .slice(0, keys.length - maxEntries)
            .forEach((k) => delete cache[k]);
    }
    return cache;
}

function setStoryCacheWithRetry(cache, maxEntries, fileName, patchKeys, resolve) {
    chrome.storage.local.set({ storyFileCache: cache }, () => {
        if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            const isQuotaError = /quota/i.test(msg);
            if (isQuotaError && maxEntries > STORY_FILE_CACHE_MIN_ENTRIES) {
                // Hết dung lượng: cắt bớt cache nhỏ hơn nữa rồi thử ghi lại,
                // thay vì bỏ luôn bản dịch/nguyên văn vừa thu thập được.
                const smallerMax = Math.max(STORY_FILE_CACHE_MIN_ENTRIES, maxEntries - STORY_FILE_CACHE_SHRINK_STEP);
                console.warn('[StoryFileCache] Vượt quota, thu nhỏ cache xuống', smallerMax, 'entry và thử lại. file:', fileName);
                const shrunk = pruneStoryCache(cache, smallerMax);
                setStoryCacheWithRetry(shrunk, smallerMax, fileName, patchKeys, resolve);
                return;
            }
            console.error('[StoryFileCache] Lỗi lưu cache:', msg, 'file:', fileName);
        } else {
            console.log('[StoryFileCache] Đã cache', fileName, patchKeys);
        }
        resolve();
    });
}

function saveStoryFileCache(fileName, patch) {
    if (!fileName) return;
    // Nối tiếp các lần ghi (thay vì get/set song song) để tránh 2 message
    // (raw + translated) đến gần như cùng lúc đọc cùng 1 state cũ rồi ghi đè
    // lẫn nhau, làm mất field vừa được lưu bởi lần ghi kia.
    storyCacheWriteChain = storyCacheWriteChain.then(() => new Promise((resolve) => {
        chrome.storage.local.get({ storyFileCache: {} }, (result) => {
            const cache = result.storyFileCache || {};
            cache[fileName] = {
                ...(cache[fileName] || {}),
                ...patch,
                time: Math.floor(Date.now() / 1000)
            };

            // Giới hạn số chap được cache để tránh phình storage: giữ lại các entry
            // mới nhất theo "time" khi vượt quá ngưỡng.
            pruneStoryCache(cache, STORY_FILE_CACHE_MAX_ENTRIES);

            setStoryCacheWithRetry(cache, STORY_FILE_CACHE_MAX_ENTRIES, fileName, Object.keys(patch), resolve);
        });
    }));
}

// ==== Tự động điền chapRemarks từ resourcePath lấy được qua hook /readStory ====
// (vd file "52baa3e4...txt" -> remark "chara010201_01"). Chỉ điền cho những
// chap CHƯA có remark, để không ghi đè remark người dùng đã tự đặt tay.
let resourceMapWriteChain = Promise.resolve();

injectedPort.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'STORY_RESOURCE_MAP_UPDATE' && event.data.map) {
        const incomingMap = event.data.map;
        resourceMapWriteChain = resourceMapWriteChain.then(() => new Promise((resolve) => {
            chrome.storage.local.get({ chapRemarks: {} }, (result) => {
                const chapRemarks = result.chapRemarks || {};
                let changed = false;

                Object.keys(incomingMap).forEach((fileName) => {
                    if (!chapRemarks[fileName] || !chapRemarks[fileName].trim()) {
                        chapRemarks[fileName] = incomingMap[fileName];
                        changed = true;
                    }
                });

                if (!changed) { resolve(); return; }

                chrome.storage.local.set({ chapRemarks }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[ReadStory] Lỗi lưu chapRemarks:', chrome.runtime.lastError.message);
                    } else {
                        console.log('[ReadStory] Đã tự động điền remark cho', Object.keys(incomingMap).length, 'chap.');
                    }
                    resolve();
                });
            });
        }));
    }
});

injectedPort.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'STORY_FILE_RAW_CACHE' && event.data.fileName) {
        saveStoryFileCache(event.data.fileName, { original: event.data.original || '' });
    }
});

injectedPort.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'STORY_FILE_TRANSLATED_CACHE' && event.data.fileName) {
        saveStoryFileCache(event.data.fileName, { translated: event.data.translated || '' });
    }
});

injectedPort.addEventListener('message', (event) => {
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

// Trích "retryDelay" (vd "33s", "1.5s") mà Gemini API gợi ý trong
// details[].@type=RetryInfo của response lỗi 429, trả về số mili-giây.
// Trả về null nếu không tìm thấy/parse được, để nơi gọi tự fallback về giá trị mặc định.
function parseRetryDelayMs(errBody) {
    try {
        const parsed = JSON.parse(errBody);
        const details = parsed?.error?.details || [];
        for (const d of details) {
            if (d && typeof d.retryDelay === 'string') {
                const match = d.retryDelay.match(/^([\d.]+)s$/);
                // +1s cho chắc, tránh trường hợp thử lại ngay sát mép thời điểm
                // server mới reset quota do sai lệch làm tròn/độ trễ mạng.
                if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 1000;
            }
        }
    } catch (e) {
        // errBody không phải JSON hợp lệ, bỏ qua
    }
    return null;
}

const GEMMA_MAX_RETRIES = 3;
const GEMMA_DEFAULT_RETRY_DELAY_MS = 30000; // fallback khi API không trả về retryDelay

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
        const err = new Error(`HTTP ${res.status} ${errBody}`);
        if (res.status === 429) {
            err.retryDelayMs = parseRetryDelayMs(errBody);
        }
        throw err;
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
// ưu tiên dùng "retryDelay" mà server gợi ý (details[].RetryInfo.retryDelay),
// nếu không có thì fallback chờ 30s, tối đa 3 lần thử (1 lần đầu + 2 lần retry).
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
            const delayMs = err.retryDelayMs || GEMMA_DEFAULT_RETRY_DELAY_MS;
            console.warn(`[Gemma] HTTP 429, thử lại sau ${Math.round(delayMs / 1000)}s (lần ${attempt}/${GEMMA_MAX_RETRIES})...`);
            if (typeof onRetryNotice === 'function') {
                onRetryNotice(attempt, GEMMA_MAX_RETRIES, delayMs);
            }
            await sleepMs(delayMs);
        }
    }
    throw lastErr;
}

injectedPort.addEventListener('message', async (event) => {
    if (!event.data || event.data.type !== 'GEMMA_BATCH_REQUEST') return;

    const { requestId, apiKey, modelId, contents } = event.data;

    if (!requestId) return;

    if (!apiKey) {
        sendToInjected({ type: 'GEMMA_BATCH_RESULT', requestId, error: 'Thiếu API Key' });
        return;
    }

    if (!Array.isArray(contents) || contents.length === 0) {
        sendToInjected({ type: 'GEMMA_BATCH_RESULT', requestId, error: 'Thiếu nội dung hội thoại (contents)' });
        return;
    }

    try {
        // "contents" ở đây là cả lịch sử hội thoại (nhiều turn user/model của các
        // lô 40 câu trước đó) do injected.js gửi sang — chuyển tiếp nguyên vẹn để
        // model thấy được ngữ cảnh đã dịch trước, thay vì chỉ 1 prompt đơn lẻ.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

        const rawText = await callGeminiStreamWithRetry(url, contents, (attempt, max, delayMs) => {
            sendToInjected({
                type: 'GEMMA_BATCH_RETRY',
                requestId,
                attempt,
                max,
                delayMs
            });
        });

        sendToInjected({ type: 'GEMMA_BATCH_RESULT', requestId, rawText });
    } catch (err) {
        sendToInjected({ type: 'GEMMA_BATCH_RESULT', requestId, error: err.message || String(err) });
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