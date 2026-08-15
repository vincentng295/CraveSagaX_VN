// ==== Kênh riêng (MessageChannel) với content.js — xem giải thích đầy đủ ở
// đầu content.js. Tóm tắt: content.js tạo 1 MessageChannel, giữ port1, và
// chuyển port2 sang đây bằng đúng 1 lần window.postMessage (không mang dữ
// liệu, chỉ mang cái port rỗng). Từ đó về sau, MỌI trao đổi giữa injected.js
// <-> content.js đều đi qua port này — không còn dùng window.postMessage
// nữa nên trang game (hay bất kỳ script nào khác gắn 'message' listener lên
// window) không nghe/xem được nội dung trao đổi giữa 2 phía nữa.
let __extPort = null;
const __pendingOutMessages = [];
const __portMessageHandlers = [];

function sendToExtension(data) {
    if (__extPort) {
        __extPort.postMessage(data);
    } else {
        // Port chưa sẵn sàng (cực hiếm, chỉ trong khoảnh khắc đầu tiên lúc
        // script vừa chạy) -> xếp hàng, gửi bù ngay khi port init xong.
        __pendingOutMessages.push(data);
    }
}

// Đăng ký lắng nghe message từ content.js. Trả về hàm "off" để hủy đăng ký
// (dùng cho các handler chỉ cần dùng 1 lần, như request/response của Gemma).
function onExtensionMessage(fn) {
    __portMessageHandlers.push(fn);
    return function off() {
        const idx = __portMessageHandlers.indexOf(fn);
        if (idx !== -1) __portMessageHandlers.splice(idx, 1);
    };
}

// Lắng nghe (chỉ) message khởi tạo port, ở capture phase để có cơ hội chạy
// trước các listener khác nếu lỡ có script nào đó cũng đang nghe 'message'
// trên window ngay từ document_start. Sau khi lấy được port, gỡ listener
// này đi ngay — từ đó window.postMessage không còn được dùng để trao đổi dữ
// liệu thật giữa injected.js và content.js nữa.
window.addEventListener('message', function __onExtPortInit(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== '__EXT_PORT_INIT__') return;
    if (!event.ports || !event.ports[0]) return;

    event.stopImmediatePropagation();
    window.removeEventListener('message', __onExtPortInit, true);

    __extPort = event.ports[0];
    __extPort.addEventListener('message', (e) => {
        __portMessageHandlers.forEach((fn) => {
            try { fn(e); } catch (err) { console.error(err); }
        });
    });
    __extPort.start();

    while (__pendingOutMessages.length) {
        __extPort.postMessage(__pendingOutMessages.shift());
    }
}, true);

let is_translated = 1;
let customTranslationDict = {};
let translateEngine = 'google'; // 'google' | 'gemma'
let geminiApiKey = '';

/**
 * ==== Toast báo trạng thái đang dịch bằng Gemma ====
 * Chèn 1 overlay nhỏ đè lên canvas Cocos để người chơi biết đang gọi AI dịch theo lô.
 */
const GEMMA_TOAST_ID = '__gemma_translate_toast__';
let gemmaToastActiveCount = 0;

function ensureGemmaToastEl() {
    let el = document.getElementById(GEMMA_TOAST_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = GEMMA_TOAST_ID;
    el.style.cssText = [
        'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
        'display:none', 'align-items:center', 'gap:8px',
        'background:rgba(17,24,39,0.9)', 'color:#fff',
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
        'font-size:13px', 'font-weight:600', 'padding:8px 14px',
        'border-radius:999px', 'box-shadow:0 4px 12px rgba(0,0,0,0.35)',
        'pointer-events:none', 'transition:opacity .2s'
    ].join(';');

    const spinner = document.createElement('div');
    spinner.style.cssText = [
        'width:14px', 'height:14px', 'border-radius:50%',
        'border:2px solid rgba(255,255,255,0.35)', 'border-top-color:#fff',
        'animation:__gemma_spin__ .7s linear infinite', 'flex-shrink:0'
    ].join(';');

    const styleTag = document.createElement('style');
    styleTag.textContent = '@keyframes __gemma_spin__{to{transform:rotate(360deg)}}';
    document.head.appendChild(styleTag);

    const label = document.createElement('span');
    label.id = GEMMA_TOAST_ID + '_label';
    label.textContent = 'Đang dịch bằng Gemma...';

    el.appendChild(spinner);
    el.appendChild(label);
    document.body.appendChild(el);
    return el;
}

function showGemmaToast(text) {
    gemmaToastActiveCount++;
    const el = ensureGemmaToastEl();
    const label = document.getElementById(GEMMA_TOAST_ID + '_label');
    if (label) label.textContent = text || 'Đang dịch bằng Gemma...';
    el.style.display = 'flex';
    el.style.opacity = '1';
}

function hideGemmaToast() {
    gemmaToastActiveCount = Math.max(0, gemmaToastActiveCount - 1);
    if (gemmaToastActiveCount > 0) return;
    const el = document.getElementById(GEMMA_TOAST_ID);
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => {
        if (gemmaToastActiveCount === 0) el.style.display = 'none';
    }, 200);
}

/**
 * ==== Toast báo lỗi Gemma + fallback về Google Dịch ====
 * Hiện riêng biệt với toast loading ở trên (màu đỏ, nằm ngay dưới), tự ẩn sau vài giây.
 */
const GEMMA_ERROR_TOAST_ID = '__gemma_error_toast__';
let gemmaErrorToastHideTimeoutId = null;

function ensureGemmaErrorToastEl() {
    let el = document.getElementById(GEMMA_ERROR_TOAST_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = GEMMA_ERROR_TOAST_ID;
    el.style.cssText = [
        'position:fixed', 'top:52px', 'right:12px', 'z-index:2147483647',
        'max-width:320px',
        'display:none', 'align-items:flex-start', 'gap:8px',
        'background:rgba(220,38,38,0.95)', 'color:#fff',
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
        'font-size:12px', 'font-weight:600', 'line-height:1.45', 'padding:10px 14px',
        'border-radius:10px', 'box-shadow:0 4px 12px rgba(0,0,0,0.35)',
        'pointer-events:none', 'transition:opacity .2s'
    ].join(';');
    document.body.appendChild(el);
    return el;
}

function showGemmaErrorToast(text, durationMs = 6000) {
    const el = ensureGemmaErrorToastEl();
    el.textContent = `⚠️ ${text}`;
    el.style.display = 'flex';
    el.style.opacity = '1';

    if (gemmaErrorToastHideTimeoutId) clearTimeout(gemmaErrorToastHideTimeoutId);
    gemmaErrorToastHideTimeoutId = setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => { el.style.display = 'none'; }, 200);
    }, durationMs);
}

// Rút gọn message lỗi trả về từ Gemini API (thường là JSON {"error":{"message":"..."}})
// thành 1 câu ngắn gọn, dễ đọc để hiển thị cho người dùng.
function extractApiErrorMessage(rawMessage) {
    if (!rawMessage) return 'Lỗi không xác định';
    try {
        const jsonStart = rawMessage.indexOf('{');
        if (jsonStart !== -1) {
            const parsed = JSON.parse(rawMessage.slice(jsonStart));
            if (parsed && parsed.error && parsed.error.message) {
                return parsed.error.message;
            }
        }
    } catch (e) {
        // rawMessage không phải JSON, dùng nguyên văn bên dưới
    }
    return rawMessage.length > 200 ? rawMessage.slice(0, 200) + '...' : rawMessage;
}

const TRANSLATED_MARKER = '\uFEFF'; // Zero-width non-breaking space (U+FEFF)
const TRANSLATED_MARKER_REGEX = /\uFEFF/g;

document.addEventListener('DOMContentLoaded', () => {
    // Thay đổi màu nền của trang web để phù hợp với chế độ tối
    document.querySelector('body')?.style.setProperty('background-color', '#000000', 'important');
});

let __translationSeqCounter = Date.now();
function nextTranslationSeq() {
    __translationSeqCounter += 1;
    return __translationSeqCounter;
}

function interleaveMarkers(text) {
    if (typeof text !== 'string' || !text) return text;

    // Bọc mọi chuỗi không chứa khoảng trắng ([^\s]+) bằng TRANSLATED_MARKER
    return text.replace(/[^\s]+/g, TRANSLATED_MARKER + '$&') + TRANSLATED_MARKER;
}

/**
 * Fragment (đoạn Cocos cắt ra từ câu gốc khi tách 2-3 dòng) có marker
 * bên trong => coi như đã dịch, hook không dịch lại.
 */
function isFragmentTranslated(fragmentText) {
    return typeof fragmentText === 'string' && fragmentText.indexOf(TRANSLATED_MARKER) !== -1;
}

function extractTranslatedValue(entry) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof entry.translated === 'string') return entry.translated;
    return null;
}

// Escape any bare " that isn't already escaped as \" (leaves \" and \\\" untouched),
// since the story script's CSV-like format requires quotes to be escaped just like commas.
function escapeUnescapedQuotes(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/\\?"/g, (m) => (m === '"' ? '\\"' : m));
}

onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_TRANSLATION_STATE_UPDATE') {
        is_translated = event.data.enabled ? 1 : 0;
    }
});

onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_ENGINE_UPDATE') {
        translateEngine = event.data.engine === 'gemma' ? 'gemma' : 'google';
        geminiApiKey = event.data.apiKey || '';
    }
});

/**
 * ==== Gemma / Gemini batch translation ====
 * Khác với Google Dịch (free, dịch được từng câu một mà không tốn kém),
 * Gemma tính theo request nên phải GỘP nhiều câu vào 1 JSON rồi gọi 1 lần duy nhất.
 */
const GEMINI_MODEL_ID = 'gemma-4-31b-it';
const GEMINI_SYSTEM_INSTRUCTION = "Bạn là AI chuyên chỉnh sửa bản dịch game **Crave Saga** (có nội dung NSFW).\n" +
    "Crave Saga X là tựa game nhập vai chiến thuật theo lượt (turn-based) dành cho người lớn (BL/yaoi), lấy bối cảnh tại Vesteria — một thế giới song song giả tưởng nơi chỉ có nam giới sinh sống, chịu sự chi phối giữa các thiên thần và ác quỷ. Người chơi vào vai \"Master\" thực hiện hành trình cứu thế giới. Vesteria là một thế giới song song độc nhất chỉ có các chàng trai thuộc nhiều chủng tộc khác nhau sinh sống. Nơi đây chịu sự kiểm soát của phe thiên thần (muốn dẫn dắt nhân loại đến utopia) và phe ác quỷ (thỏa mãn tham vọng và sự đồi trụy). Nhân vật chính được tái sinh tại Vesteria bởi Thần Sáng tạo và Vua Thần nguyên thủy Arche để bắt đầu hành trình phiêu lưu và cứu rỗi.\n" +
    "Vesteria không có phụ nữ, chỉ có đàn ông.\n\n" +
    "Nhiệm vụ của bạn:\n" +
    "Nhận vào một mảng JSON các object {\"original\": \"...\", \"name\": \"...\"} — trong đó \"original\" là câu thoại tiếng Anh cần dịch, \"name\" là tên nhân vật đang nói câu đó (có thể null/rỗng nếu là dòng lựa chọn hoặc không xác định). " +
    "Hãy DÙNG \"name\" để hiểu khẩu khí, giới tính, vai vế của nhân vật đó (đây là game BL toàn nam giới) rồi dịch \"original\" sang tiếng Việt tự nhiên, mượt mà, đúng ngữ cảnh game hơn.\n\n" +
    "### Quy tắc bắt buộc\n" +
    "- Ưu tiên tự nhiên, dễ đọc như người Việt viết, không máy móc.\n" +
    "- Giữ đúng ý nghĩa gốc, không thêm bớt thông tin.\n" +
    "- Với tên riêng, thuật ngữ game thì giữ nguyên hoặc dịch theo chuẩn game: Master → Master, Soulmate → Soulmate, Sacred → Sacred, Raid → Raid, Player Rank → Hạng người chơi / Rank, Login → Đăng nhập.\n" +
    "- Các câu nhiệm vụ / thành tựu nên ngắn gọn, có cảm giác \"quest game\".\n" +
    "- Các câu thoại thì giữ khẩu khí riêng của từng nhân vật (thân mật, thô, lịch sự…) dựa theo \"name\" đi kèm.\n\n" +
    "### Phong cách\n" +
    "- Tránh dịch word-by-word.\n" +
    "- Tránh câu quá cứng hoặc quá \"Google dịch\".\n" +
    "- Ưu tiên ngắn gọn, rõ ràng, tự nhiên.\n\n" +
    "### Định dạng output\n" +
    "Trả về ĐÚNG một JSON object dạng {\"response\": [{\"original\": \"...\", \"translated\": \"...\"}, ...]}, giữ nguyên từng \"original\" y hệt input (không đổi \"name\" ra output), điền \"translated\", không giải thích, không thêm text nào khác ngoài JSON.";

/**
 * injected.js chạy ở MAIN world (như 1 script thường của trang game), nên KHÔNG
 * được hưởng CORS bypass từ "host_permissions" khai báo trong manifest.json —
 * quyền đó chỉ áp dụng cho code chạy ở isolated world (content script, background,
 * popup/options). Vì vậy fetch() trực tiếp tới generativelanguage.googleapis.com
 * từ đây sẽ bị trình duyệt chặn (CORS/CSP) và luôn báo lỗi "Failed to fetch".
 *
 * Giải pháp: gửi request qua postMessage sang content.js (isolated world), nhờ
 * content.js gọi fetch() thật (được CORS bypass) rồi trả kết quả về bằng
 * postMessage, giống cơ chế GAME_ENGINE_UPDATE / GAME_DICT_UPDATE đã có sẵn.
 */
let __gemmaReqCounter = 0;
// contents: mảng conversation turns dạng [{role:'user'|'model', parts:[{text}]}]
// giống format "contents" của Gemini API — gửi NGUYÊN cả lịch sử hội thoại mỗi lần
// (API không lưu state), để model thấy được các lượt dịch trước đó và giữ nhất
// quán văn phong/ngữ cảnh giữa các lô.
function requestGemmaBatchFromContentScript(contents) {
    return new Promise((resolve, reject) => {
        const requestId = 'gemma_' + Date.now() + '_' + (++__gemmaReqCounter);

        const timeoutId = setTimeout(() => {
            offHandler();
            reject(new Error('Timeout chờ phản hồi từ content script (10 phút)'));
        }, 600000);

        function handler(event) {
            if (!event.data || !event.data.requestId || event.data.requestId !== requestId) return;

            // content.js đang tự động thử lại sau lỗi 429 (quota) — chỉ cập nhật
            // toast, KHÔNG resolve/reject vì kết quả thật vẫn chưa về.
            if (event.data.type === 'GEMMA_BATCH_RETRY') {
                const secs = Math.round((event.data.delayMs || 30000) / 1000);
                showGemmaToast(`Gemma bị giới hạn quota (429), thử lại sau ${secs}s (lần ${event.data.attempt}/${event.data.max})...`);
                return;
            }

            if (!event.data.type || event.data.type !== 'GEMMA_BATCH_RESULT') return;
            clearTimeout(timeoutId);
            offHandler();
            if (event.data.error) {
                reject(new Error(event.data.error));
            } else {
                resolve(event.data.rawText || '');
            }
        }

        const offHandler = onExtensionMessage(handler);
        sendToExtension({
            type: 'GEMMA_BATCH_REQUEST',
            requestId,
            apiKey: geminiApiKey,
            modelId: GEMINI_MODEL_ID,
            contents
        });
    });
}

// Số câu thoại tối đa mỗi lượt (turn) gửi lên Gemma. Thay vì nhồi toàn bộ
// uniqueItems (có thể vài trăm/nghìn câu) vào 1 request duy nhất, ta tách thành
// từng lô 150 câu và gửi nối tiếp dưới dạng nhiều turn trong CÙNG một conversation
// (lượt sau kèm theo toàn bộ lượt trước làm lịch sử) — giúp giảm độ trễ/khả năng
// timeout của 1 request quá lớn, đồng thời model vẫn giữ được ngữ cảnh xuyên suốt
// nhờ thấy lại các cặp user/model của những lô trước. Gemma hỗ trợ tới ~256k
// token nên hầu như không có nguy cơ vượt giới hạn context dù nối nhiều lượt.
const GEMMA_DIALOG_CHUNK_SIZE = 150;

function buildDialogChunks(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function parseGemmaRawText(rawText) {
    // Phòng vệ thêm: dù đã tắt thinking + lọc "thought" part ở content.js,
    // vẫn trích phần {...} ngoài cùng ra trước khi parse, để tránh vỡ nếu
    // model lỡ chèn thêm text thừa trước/sau JSON.
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    const jsonSlice = (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart)
        ? rawText.slice(jsonStart, jsonEnd + 1)
        : rawText;

    const parsed = JSON.parse(jsonSlice);
    return Array.isArray(parsed) ? parsed : (parsed.response || []);
}

async function callGemmaBatch(uniqueItems) {
    if (!uniqueItems.length) return {};
    if (!geminiApiKey) {
        console.warn('[Gemma] Thiếu API Key, bỏ qua dịch lô.');
        return {};
    }

    // Lưu ý: model Gemma (khác Gemini) trên generativelanguage API KHÔNG hỗ trợ
    // "systemInstruction" và "responseSchema" -> phải gộp instruction vào prompt
    // và chỉ dùng responseMimeType để ép JSON, nếu không server trả lỗi 400.
    const chunks = buildDialogChunks(uniqueItems, GEMMA_DIALOG_CHUNK_SIZE);
    const contents = [];
    const map = {};

    try {
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const inputJson = JSON.stringify(chunk.map((it) => ({ original: it.text, name: it.speaker || null })));

            const userText = (i === 0)
                ? `${GEMINI_SYSTEM_INSTRUCTION}\n\nInput:\n${inputJson}`
                : `Dịch tiếp danh sách câu thoại sau, giữ đúng phong cách, giọng văn và quy tắc đã áp dụng ở các lượt trước:\n\nInput:\n${inputJson}`;

            contents.push({ role: 'user', parts: [{ text: userText }] });

            const rawText = await requestGemmaBatchFromContentScript(contents);
            const items = parseGemmaRawText(rawText);

            items.forEach((item) => {
                if (item && typeof item.original === 'string' && typeof item.translated === 'string') {
                    map[item.original] = item.translated;
                }
            });

            // Đưa câu trả lời của model vào lịch sử để lượt kế tiếp giữ ngữ cảnh.
            contents.push({ role: 'model', parts: [{ text: rawText }] });
        }
        return map;
    } catch (err) {
        console.error('[Gemma] Lỗi khi dịch theo lô:', err);
        // Ném lại lỗi để nơi gọi (processStoryScript) biết và hiển thị thông báo
        // cho người dùng, thay vì âm thầm trả về {} khiến người chơi không hay biết
        // là đang bị fallback sang Google Dịch.
        throw err;
    }
}

onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_DICT_UPDATE') {
        customTranslationDict = event.data.dict || {};
    }
});

onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_DICT_UPDATE') {
        customTranslationDict = event.data.dict || {};
        
        // Xóa cache dịch tạm thời để bắt buộc dùng từ điển mới nhập vào
        if (typeof translationCache !== 'undefined' && translationCache instanceof Map) {
            translationCache.clear();
        }
        if (typeof translateCache !== 'undefined' && translateCache instanceof Map) {
            translateCache.clear();
        }
        console.log("-> [AutoTranslate]: Đã cập nhật từ điển!");
    }
});

(function () {
    let lastMeasureCtx = null;
    let lastMeasureFont = null;

    (function hookMeasureText() {
        const nativeMeasureText = CanvasRenderingContext2D.prototype.measureText;
        CanvasRenderingContext2D.prototype.measureText = function (text) {
            if (typeof text === 'string' && /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(text)) {
                lastMeasureCtx = this;
                lastMeasureFont = this.font;
            }
            return nativeMeasureText.call(this, text);
        };
    })();

    const widthCache = new Map();

    function measureWidth(ctx, font, text) {
        const key = font + '|' + text;
        if (widthCache.has(key)) return widthCache.get(key);
        ctx.font = font;
        const w = ctx.measureText(text).width;
        widthCache.set(key, w);
        return w;
    }

    function wrapWithEngineMetrics(ctx, font, text, maxWidth) {
        const paragraphs = text.split('\n');
        const outLines = [];

        for (const para of paragraphs) {
            const words = para.split(' ');
            let currentLine = '';

            for (const word of words) {
                const candidate = currentLine ? currentLine + ' ' + word : word;
                const candidateWidth = measureWidth(ctx, font, candidate);

                if (candidateWidth <= maxWidth || !currentLine) {
                    if (candidateWidth <= maxWidth) {
                        currentLine = candidate;
                        continue;
                    }
                }

                if (currentLine && candidateWidth > maxWidth) {
                    outLines.push(currentLine);
                    currentLine = '';
                }

                if (measureWidth(ctx, font, word) > maxWidth) {
                    let chunk = '';
                    for (const ch of word) {
                        const testChunk = chunk + ch;
                        if (chunk && measureWidth(ctx, font, testChunk) > maxWidth) {
                            outLines.push(chunk);
                            chunk = ch;
                        } else {
                            chunk = testChunk;
                        }
                    }
                    currentLine = chunk;
                } else {
                    currentLine = word;
                }
            }
            if (currentLine) outLines.push(currentLine);
        }

        return outLines.join('\n');
    }

    function initCocosHook() {
        if (!window.cc || !cc.Label) {
            setTimeout(initCocosHook, 200);
            return;
        }

        const proto = cc.Label.prototype;

        if (proto.__originalDescriptor) {
            Object.defineProperty(proto, 'string', proto.__originalDescriptor);
        }

        const originalDescriptor = Object.getOwnPropertyDescriptor(proto, 'string');
        if (!originalDescriptor || !originalDescriptor.set) return;

        proto.__originalDescriptor = originalDescriptor;
        const originalSet = originalDescriptor.set;
        const debounceMap = new WeakMap();
        const translationCache = new Map();

        function isDialogueText(text) {
            const trimmed = text.trim();
            if (/^\d+$/.test(trimmed)) return false;
            if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return false;
            if (!/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(trimmed)) return false;
            return true;
        }

        async function translateText(text) {
            if (!is_translated) return text;
            if (!text || !text.trim()) return text;
            const cleanText = text.trim();
            const seq = nextTranslationSeq();

            if (customTranslationDict && customTranslationDict[cleanText]) {
                const dictValue = extractTranslatedValue(customTranslationDict[cleanText]);
                if (dictValue) return dictValue;
            }

            if (translationCache.has(cleanText)) {
                const cachedTranslated = translationCache.get(cleanText);
                return cachedTranslated;
            }

            // Live label (Cocos) luôn dùng Google Dịch, kể cả khi engine = Gemma —
            // chỉ phần dịch theo file (XHR hook) mới gộp lô gửi Gemma.
            try {
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(cleanText)}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP error ${res.status}`);
                const data = await res.json();
                let translated = data[0].map(item => item[0]).join('');

                translationCache.set(cleanText, translated);

                return translated;
            } catch (e) {
                return null;
            }
        }

        // Chỉ ép font, không đụng tới overflow/width - áp dụng cho MỌI label,
        // bất kể có phải dialog/đã dịch hay không, để đồng bộ font toàn game.
        function forceArialFont(label) {
            try {
                if ('useSystemFont' in label) label.useSystemFont = true;
                if ('_isSystemFontUsed' in label) label._isSystemFontUsed = true;
                if (label.font) label.font = null;
                if (label._N$file) label._N$file = null;
                if (label._font) label._font = null;

                label.fontFamily = "Arial, sans-serif";
            } catch (err) {}
        }

        function fixCocosFont(label) {
            try {
                forceArialFont(label);

                if (cc.Label.Overflow) {
                    label.overflow = cc.Label.Overflow.RESIZE_HEIGHT;
                } else {
                    label.overflow = 1;
                }

                if (label.node && label.node.width < 500) {
                    label.node.width = 650;
                }
            } catch (err) {}
        }

        function fixAndRewrap(labelInstance, text) {
            fixCocosFont(labelInstance);

            // Không còn ctx/font đã đo (VD label chưa từng render lần nào) ->
            // đành phải nhờ Cocos tự wrap 1 lần để hook measureText bắt được font.
            if (!lastMeasureCtx || !lastMeasureFont) {
                labelInstance.enableWrapText = true;
                if ('_enableWrapText' in labelInstance) labelInstance._enableWrapText = true;
                originalSet.call(labelInstance, text);
                if (typeof labelInstance.setVertsDirty === 'function') labelInstance.setVertsDirty();
                return;
            }

            // Có ctx/font cached rồi -> tính wrap luôn, KHÔNG set text thô trước
            // (trước đây set 2 lần khiến Cocos layout 2 lần, gây khựng với câu 2-3 dòng)
            const safetyMargin = 8;
            const maxWidth = (labelInstance.node ? labelInstance.node.width : 650) - safetyMargin;
            const wrapped = wrapWithEngineMetrics(lastMeasureCtx, lastMeasureFont, text, maxWidth);

            labelInstance.enableWrapText = false;
            if ('_enableWrapText' in labelInstance) labelInstance._enableWrapText = false;
            originalSet.call(labelInstance, wrapped);

            // Không ép _updateRenderData(true) đồng bộ nữa - để engine tự cập nhật
            // ở frame kế tiếp qua setVertsDirty(), tránh block main thread giữa frame.
            if (typeof labelInstance.setVertsDirty === 'function') labelInstance.setVertsDirty();
        }

        Object.defineProperty(proto, 'string', {
            set: function (val) {
                const labelInstance = this;

                // Ép font Arial cho MỌI label, không quan tâm có dịch/dialog hay không.
                forceArialFont(labelInstance);

                if (isFragmentTranslated(val)) {
                    originalSet.call(this, val);

                    if (debounceMap.has(this)) {
                        clearTimeout(debounceMap.get(this));
                    }
                    debounceMap.set(this, setTimeout(() => {
                        fixAndRewrap(labelInstance, val);
                    }, 150));
                    return;
                }

                originalSet.call(this, val);

                if (!is_translated || !val || typeof val !== 'string' || !isDialogueText(val)) return;

                if (debounceMap.has(this)) {
                    clearTimeout(debounceMap.get(this));
                }

                debounceMap.set(this, setTimeout(async () => {
                    let translatedText = await translateText(val);
                    if (!translatedText || !is_translated) return;
                    fixAndRewrap(labelInstance, translatedText);
                }, 150));
            },
            get: originalDescriptor.get,
            configurable: true
        });

        console.log("-> [AutoTranslate]: Hook Cocos2d successfully!");
    }

    initCocosHook();
})();

(function () {
    'use strict';

    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    const rawAddEventListener = XMLHttpRequest.prototype.addEventListener;

    const originalResponseTextDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
    const originalResponseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');

    const SUFFIX = ".txt";

    const stateMap = new WeakMap();
    function getState(xhr) {
        if (!stateMap.has(xhr)) {
            stateMap.set(xhr, {
                isStoryFile: false,
                fileName: null,
                translatedText: null,
                translating: false,
                realOnload: null,
                realOnReadyStateChange: null,
                loadListeners: [],
                rscListeners: [],
            });
        }
        return stateMap.get(xhr);
    }

    const translateCache = new Map();
    // Kết quả dịch theo lô (Gemma) của file story script hiện đang xử lý.
    let currentGemmaBatchResults = null;

    async function translateSingleText(text, speakerName = null, fileName = null) {
        if (!text || !text.trim()) return text;
        const seq = nextTranslationSeq();
        const cleanText = text.replace(/\\,/g, ',');

        if (customTranslationDict && customTranslationDict[cleanText]) {
            const dictValue = extractTranslatedValue(customTranslationDict[cleanText]);
            if (dictValue) {
                const customResult = escapeUnescapedQuotes(dictValue).replace(/,/g, '\\,');
                return interleaveMarkers(customResult);
            }
        }

        if (translateEngine === 'gemma' && currentGemmaBatchResults && currentGemmaBatchResults.has(cleanText)) {
            const translated = currentGemmaBatchResults.get(cleanText);
            if (translated) {
                const result = escapeUnescapedQuotes(translated).replace(/,/g, '\\,');
                translateCache.set(cleanText, result);
                sendToExtension({
                    type: 'SAVE_NEW_TRANSLATION',
                    original: cleanText,
                    translated,
                    speaker: speakerName || undefined,
                    chap: fileName || undefined,
                    seq
                });
                return interleaveMarkers(result);
            }
        }

        if (translateCache.has(cleanText)) {
            const cached = translateCache.get(cleanText);
            if (cached) {
                sendToExtension({
                    type: 'SAVE_NEW_TRANSLATION',
                    original: cleanText,
                    translated: cached,
                    speaker: speakerName || undefined,
                    chap: fileName || undefined,
                    seq
                });
                return interleaveMarkers(cached);
            }
            return text;
        }

        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(cleanText)}`; 
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            
            const data = await res.json();
            if (data && data[0]) {
                const translated = data[0].map(seg => seg[0]).join('');
                const result = escapeUnescapedQuotes(translated).replace(/,/g, '\\,');
                
                translateCache.set(cleanText, result); 

                sendToExtension({
                    type: 'SAVE_NEW_TRANSLATION',
                    original: cleanText,
                    translated: translated,
                    speaker: speakerName || undefined,
                    chap: fileName || undefined,
                    seq
                });

                return interleaveMarkers(result); 
            }
        } catch (err) {
            console.error(`[Network Error] "${cleanText}":`, err);
        }

        sendToExtension({
            type: 'SAVE_NEW_TRANSLATION',
            original: cleanText,
            translated: '',
            speaker: speakerName || undefined,
            chap: fileName || undefined,
            seq
        });

        return text;
    }

    const MSG_LINE_REGEX = /^(msg,\d+,\s*(?:<size=\d+>)?)((?:\\,|[^<,])*)((?:<\/size>)?,.*)$/;

    function splitUnescapedComma(str) {
        const parts = [];
        let current = '';
        for (let i = 0; i < str.length; i++) {
            if (str[i] === '\\' && str[i + 1] === ',') {
                current += '\\,';
                i++;
            } else if (str[i] === ',') {
                parts.push(current);
                current = '';
            } else {
                current += str[i];
            }
        }
        parts.push(current);
        return parts;
    }

    function extractSpeakerName(line) {
        const fields = splitUnescapedComma(line);
        const raw = (fields[1] || '').replace(/\\,/g, ',');
        const stripped = raw.replace(/<[^>]*>/g, '').trim();
        return stripped || null;
    }

    async function processSelectLine(line, fileName = null) {
        const fields = splitUnescapedComma(line);
        const tasks = fields.map(async (field, idx) => {
            if (idx === 0) return field;
            if (!field.trim()) return field;
            return await translateSingleText(field, null, fileName);
        });
        const translated = await Promise.all(tasks);
        return translated.join(',');
    }

    function markNameLineTranslated(line) {
        const fields = splitUnescapedComma(line);
        if (fields.length > 1 && fields[1] && fields[1].trim()) {
            // Chèn marker vào đầu field tên để hook Cocos (proto.string setter)
            // nhận ra đây là text "đã dịch" và không tự động dịch tên nhân vật.
            fields[1] = TRANSLATED_MARKER + fields[1];
        }
        return fields.join(',');
    }

    function hasDialogueContent(rawText) {
        if (!rawText || !rawText.trim()) return false;
        return rawText.split('\n').some((line) => {
            const trimmed = line.trim();
            return trimmed.startsWith('name,') || trimmed.startsWith('msg,') || trimmed.startsWith('select,');
        });
    }

    // Duyệt file 1 lượt để thu thập MỌI câu cần dịch (msg + các field của select)
    // chưa có trong customTranslationDict/translateCache, để gộp thành 1 request Gemma.
    // Mỗi câu msg được đính kèm tên nhân vật (name,) đứng trước nó để Gemma hiểu ngữ cảnh.
    function collectUntranslatedTexts(lines) {
        const collectedMap = new Map(); // cleanText -> speaker
        let speakerForCollect = null;

        function needsTranslation(rawField) {
            const cleanText = rawField.replace(/\\,/g, ',');
            if (!cleanText.trim()) return null;
            if (customTranslationDict && customTranslationDict[cleanText]) return null;
            if (translateCache.has(cleanText)) return null;
            return cleanText;
        }

        lines.forEach((line) => {
            if (line.startsWith('name,')) {
                speakerForCollect = extractSpeakerName(line);
            } else if (line.startsWith('msg,')) {
                const match = line.match(MSG_LINE_REGEX);
                if (!match || !match[2] || !match[2].trim()) return;
                const cleanText = needsTranslation(match[2]);
                if (cleanText && !collectedMap.has(cleanText)) {
                    collectedMap.set(cleanText, speakerForCollect);
                }
            } else if (line.startsWith('select,')) {
                const fields = splitUnescapedComma(line);
                fields.forEach((field, idx) => {
                    if (idx === 0 || !field.trim()) return;
                    const cleanText = needsTranslation(field);
                    if (cleanText && !collectedMap.has(cleanText)) {
                        collectedMap.set(cleanText, null); // dòng lựa chọn không gắn với 1 nhân vật cụ thể
                    }
                });
            }
        });

        return Array.from(collectedMap.entries()).map(([text, speaker]) => ({ text, speaker }));
    }

    // Dịch 1 lô câu thoại bằng Gemma, KHÔNG âm thầm fallback về Google Dịch khi
    // gặp lỗi. Khi lỗi xảy ra, hỏi người chơi qua confirm(): OK = thử lại bằng
    // Gemma, Hủy = chuyển tạm sang Google Dịch cho các câu của file này. Khi dịch
    // thành công, báo cho người chơi biết bằng alert().
    async function translateBatchWithGemmaConfirm(uniqueItems) {
        while (true) {
            showGemmaToast(`Đang dịch ${uniqueItems.length} câu bằng Gemma...`);
            try {
                const map = await callGemmaBatch(uniqueItems);
                hideGemmaToast();
                alert('Dịch hoàn tất! Mời bạn thưởng thức câu chuyện.');
                return new Map(Object.entries(map));
            } catch (err) {
                hideGemmaToast();
                const wantsRetry = confirm(
                    `Gemma lỗi: ${extractApiErrorMessage(err.message)}.\n\n` +
                    `Bấm OK để THỬ LẠI bằng Gemma, hoặc bấm Hủy để chuyển tạm sang Google Dịch cho phần này.`
                );
                if (!wantsRetry) {
                    showGemmaErrorToast('Đang chuyển tạm sang Google Dịch...');
                    return new Map();
                }
                // Người dùng chọn thử lại -> lặp lại vòng while, gọi callGemmaBatch lần nữa.
            }
        }
    }

    async function processStoryScript(rawScript, fileName = null) {
        const lines = rawScript.split('\n');
        let currentSpeaker = null;

        if (translateEngine === 'gemma') {
            const uniqueItems = collectUntranslatedTexts(lines);
            console.log(`[Gemma] Gộp ${uniqueItems.length} câu chưa dịch của "${fileName || ''}" vào 1 request...`);
            if (uniqueItems.length > 0) {
                currentGemmaBatchResults = await translateBatchWithGemmaConfirm(uniqueItems);
            } else {
                currentGemmaBatchResults = new Map();
            }
        } else {
            currentGemmaBatchResults = null;
        }

        const tasks = lines.map(async (line) => {
            if (line.startsWith('name,')) {
                currentSpeaker = extractSpeakerName(line);
                return markNameLineTranslated(line);
            }

            if (line.startsWith('msg,')) {
                const match = line.match(MSG_LINE_REGEX);
                if (!match || !match[2] || !match[2].trim()) return line;
                const [, prefix, content, suffix] = match;
                const speakerForThisLine = currentSpeaker;
                const translated = await translateSingleText(content, speakerForThisLine, fileName);
                return `${prefix}${translated}${suffix}`;
            }

            if (line.startsWith('select,')) {
                return await processSelectLine(line, fileName);
            }

            return line;
        });

        return (await Promise.all(tasks)).join('\n');
    }

    const _nativeToString = Function.prototype.toString;
    const __fakeNativeMap = new WeakMap();

    function mark(fn, nativeSrc) {
        if (typeof fn !== 'function') return fn;
        __fakeNativeMap.set(fn, nativeSrc || `function ${fn.name || ''}() { [native code] }`);
        return fn;
    }

    Function.prototype.toString = new Proxy(_nativeToString, {
        apply(target, thisArg, args) {
            if (__fakeNativeMap.has(thisArg)) {
                return __fakeNativeMap.get(thisArg);
            }
            return Reflect.apply(target, thisArg, args);
        }
    });
    mark(Function.prototype.toString, "function toString() { [native code] }");

    const __sanitizeStack = (stackStr) => {
        if (!stackStr || typeof stackStr !== "string") return stackStr;
        return stackStr
            .split('\n')
            .filter((line) => !line.includes('injected.js') && !line.includes('chrome-extension://'))
            .join('\n');
    };
    try {
        const _origGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        Object.getOwnPropertyDescriptor = new Proxy(_origGetOwnPropertyDescriptor, {
            apply(target, thisArg, args) {
                const desc = Reflect.apply(target, thisArg, args);
                if (args[1] === 'stack' && desc) {
                    if (desc.get) {
                        const origGet = desc.get;
                        desc.get = function () { return __sanitizeStack(origGet.call(this)); };
                    } else if ('value' in desc) {
                        desc.value = __sanitizeStack(desc.value);
                    }
                }
                return desc;
            }
        });
        mark(Object.getOwnPropertyDescriptor, "function getOwnPropertyDescriptor() { [native code] }");
    } catch {}

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const st = getState(this);
        st.isStoryFile = typeof url === 'string' && url.endsWith(SUFFIX);
        if (st.isStoryFile) {
            // Lấy tên file .txt từ URL
            st.fileName = url.split('/').pop();
        }
        // readStory trả về mảng {md5, resourcePath, path,...} -> dùng để tự
        // động điền remark (tên gợi nhớ) cho chap md5.txt tương ứng.
        st.isReadStory = typeof url === 'string' && url.indexOf('/readStory') !== -1;
        return rawOpen.call(this, method, url, ...rest);
    };
    mark(XMLHttpRequest.prototype.open, "function open() { [native code] }");

    Object.defineProperty(XMLHttpRequest.prototype, 'onload', {
        configurable: true,
        get() { return getState(this).realOnload; },
        set(fn) { getState(this).realOnload = fn; }
    });

    Object.defineProperty(XMLHttpRequest.prototype, 'onreadystatechange', {
        configurable: true,
        get() { return getState(this).realOnReadyStateChange; },
        set(fn) { getState(this).realOnReadyStateChange = fn; }
    });

    XMLHttpRequest.prototype.addEventListener = function (type, listener, options) {
        if (type === 'load' || type === 'readystatechange') {
            const st = getState(this);
            (type === 'load' ? st.loadListeners : st.rscListeners).push(listener);
            return;
        }
        return rawAddEventListener.call(this, type, listener, options);
    };
    mark(XMLHttpRequest.prototype.addEventListener, "function addEventListener() { [native code] }");

    function dispatchRealEvent(xhr, evt) {
        const st = getState(xhr);
        if (typeof st.realOnReadyStateChange === 'function') {
            try { st.realOnReadyStateChange.call(xhr, evt); } catch (e) { console.error(e); }
        }
        st.rscListeners.forEach(fn => {
            try { fn.call(xhr, evt); } catch (e) { console.error(e); }
        });

        if (xhr.readyState === 4) {
            if (typeof st.realOnload === 'function') {
                try { st.realOnload.call(xhr, evt); } catch (e) { console.error(e); }
            }
            st.loadListeners.forEach(fn => {
                try { fn.call(xhr, evt); } catch (e) { console.error(e); }
            });
        }
    }

    XMLHttpRequest.prototype.send = function (body) {
        const st = getState(this);

        rawAddEventListener.call(this, 'readystatechange', (evt) => {
            if (this.readyState !== 4) return;

            if (st.isReadStory && !st.readStoryHandled && (this.status === 200 || this.status === 0)) {
                st.readStoryHandled = true;
                try {
                    const rawText = originalResponseTextDesc.get.call(this);
                    const data = JSON.parse(rawText);
                    if (Array.isArray(data.resources)) {
                        const map = {};
                        data.resources.forEach((item) => {
                            if (item && item.md5 && item.resourcePath) {
                                console.log("readStory", item.md5 + '.txt', '->', item.resourcePath);
                                map[item.md5 + '.txt'] = item.resourcePath;
                            }
                        });
                        if (Object.keys(map).length) {
                            sendToExtension({ type: 'STORY_RESOURCE_MAP_UPDATE', map });
                        }
                    }
                } catch (e) {
                    console.warn('[ReadStory] Không parse được response:', e);
                }
                // Không đụng vào response, chỉ "nghe lén" -> để luồng dispatch bình thường xử lý tiếp.
            }

            if (!st.isStoryFile || (this.status !== 200 && this.status !== 0)) {
                dispatchRealEvent(this, evt);
                return;
            }

            if (st.translating || st.translatedText !== null) {
                if (st.translatedText !== null) dispatchRealEvent(this, evt);
                return;
            }

            st.translating = true;

            const rawText = originalResponseTextDesc.get.call(this);

            // Một số file script (vd: synopsis) không chứa lời thoại (name,/msg,/select,)
            // -> bỏ qua, không báo GAME_CHAP_OPENED để tránh nhận nhầm là chap đang chơi.
            if (!hasDialogueContent(rawText)) {
                console.log(`[Story Intercepted] ${st.fileName || ''} — không có lời thoại, bỏ qua dịch`);
                dispatchRealEvent(this, evt);
                return;
            }

            if (st.fileName) {
                sendToExtension({ type: 'GAME_CHAP_OPENED', chap: st.fileName });
                // Cache nguyên văn bản gốc (.txt) của chap này, đúng thứ tự dòng,
                // để export .doc sau này không phải dựa vào translationDict (rời rạc,
                // có thể sai thứ tự hoặc thiếu câu do câu đã được dịch ở chap khác).
                sendToExtension({ type: 'STORY_FILE_RAW_CACHE', fileName: st.fileName, original: rawText });
            }

            if (!is_translated) {
                console.log(`[Story Intercepted] ${st.fileName || ''} — dịch tắt, dùng bản gốc`);
                st.translatedText = rawText;
                dispatchRealEvent(this, evt);
                return;
            }

            console.log(`[Story Intercepted] ${st.fileName || ''} — đang dịch...`);

            processStoryScript(rawText, st.fileName)
                .then((result) => {
                    st.translatedText = result;
                    console.log("Dịch xong:", result.substring(0, 150) + "...");
                    // Cache nguyên văn bản đã dịch (đúng thứ tự dòng) cho chap này,
                    // dùng để export .doc bản tiếng Việt.
                    if (st.fileName) {
                        sendToExtension({ type: 'STORY_FILE_TRANSLATED_CACHE', fileName: st.fileName, translated: result });
                    }
                })
                .catch((err) => {
                    console.error("Lỗi dịch, dùng bản gốc:", err);
                    st.translatedText = rawText;
                })
                .finally(() => {
                    dispatchRealEvent(this, evt);
                });
        });

        return rawSend.call(this, body);
    };
    mark(XMLHttpRequest.prototype.send, "function send() { [native code] }");

    Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
        configurable: true,
        get() {
            const st = getState(this);
            return st.translatedText !== null
                ? st.translatedText
                : originalResponseTextDesc.get.call(this);
        }
    });

    Object.defineProperty(XMLHttpRequest.prototype, 'response', {
        configurable: true,
        get() {
            const st = getState(this);
            return st.translatedText !== null
                ? st.translatedText
                : originalResponseDesc.get.call(this);
        }
    });

    console.log("[Story Translator Hook v2] Sẵn sàng");
})();