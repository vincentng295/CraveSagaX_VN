console_log = console.log.bind(console);
console_warn = console.warn.bind(console);
console_error = console.error.bind(console);

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

// Resolve URL tương đối (vd "/assets/img.png", "img.png", "../a/b.json")
// thành URL tuyệt đối theo document hiện tại, để dùng làm key cache thống
// nhất (tránh việc "assets/a.png" và "https://domain.com/x/assets/a.png"
// bị coi là 2 tài nguyên khác nhau khi thực ra là cùng 1 request).
function resolveUrl(url) {
    try {
        return new URL(url, document.baseURI).href;
    } catch (e) {
        return url;
    }
}

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
            try { fn(e); } catch (err) { console_error(err); }
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

// ==== Fake Crave Saga X 1.0 ====
let fakeCrave2Enabled = false;
const FAKE_CRAVE2_URL_MAP = [
    {
        suffix: '/14/14405b629.png',
        target: 'https://raw.githubusercontent.com/vincentng295/CraveSagaX_VN/refs/heads/main/docs/static/14405b629.png'
    },
    {
        suffix: '/b3db2a3f53545c43293c4cf37127ea6e.mp3',
        target: 'https://raw.githubusercontent.com/vincentng295/CraveSagaX_VN/refs/heads/main/docs/static/66b547ae746547882f273ac378271f54.mp3'
    }
];

function applyFakeCrave2Rewrite(url) {
    if (!fakeCrave2Enabled || typeof url !== 'string') return url;
    for (const entry of FAKE_CRAVE2_URL_MAP) {
        if (url.endsWith(entry.suffix)) return entry.target;
    }
    return url;
}

const _nativeToString = Function.prototype.toString;
const __fakeNativeMap = new WeakMap();

function mark(fn, nativeSrc) {
    if (typeof fn !== 'function') return fn;
    __fakeNativeMap.set(fn, nativeSrc || `function ${fn.name || ''}() { [native code] }`);
    return fn;
}

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

// Escape any real newline (\r\n, \n, \r) coming back from the translation engine
// (dict / Gemma / Google Translate) into the literal "\n" text sequence the script
// uses for in-dialogue line breaks — same idea as comma -> "\," escaping. Without
// this, a translation engine that emits an actual line break splits one CSV record
// into two physical lines and corrupts the script.
function escapeRawNewlines(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n');
}

// Chuẩn hóa bản dịch tiếng Việt trước khi ghép vào script:
//  1) Escape mọi newline THẬT (\r\n, \n, \r) -> literal "\n" (phòng hờ, tránh vỡ dòng CSV)
//  2) Bỏ hết literal "\n" (không giữ line-break trong lời thoại) -> thay bằng khoảng trắng
//  3) Dấu phẩy "," -> "、" để không xung đột với dấu phẩy phân tách field CSV của script
//     (nhờ vậy không cần escape "," -> "\," như trước nữa)
//  4) Dấu ngoặc kép " -> ’’ (tránh xung đột dấu quote với các quy tắc khác của script)
function sanitizeAndFormatTranslation(text) {
    if (typeof text !== 'string') return text;
    text = escapeRawNewlines(text);
    text = text.replace(/\\n/g, ' ');
    text = text.replace(/,/g, '﹐');
    text = text.replace(/"/g, '’’');
    return text;
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
        console_warn('[Gemma] Thiếu API Key, bỏ qua dịch lô.');
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
        console_error('[Gemma] Lỗi khi dịch theo lô:', err);
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
        console_log("-> [AutoTranslate]: Đã cập nhật từ điển!");
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

        console_log("-> [AutoTranslate]: Hook Cocos2d successfully!");
    }

    initCocosHook();
})();

/**
 * ==== FAST CACHE — tự quản lý cache tài nguyên, không phụ thuộc disk cache trình duyệt ====
 * IndexedDB lưu Blob (ảnh) hoặc {data, responseType} (XHR text/arraybuffer) theo key = URL.
 */
let fastCacheEnabled = true;
const FAST_CACHE_DB_NAME = 'CraveSagaFastCacheDB';
const FAST_CACHE_STORE = 'resources';
let __fastCacheDbPromise = null;

function openFastCacheDb() {
    if (__fastCacheDbPromise) return __fastCacheDbPromise;
    __fastCacheDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(FAST_CACHE_DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(FAST_CACHE_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return __fastCacheDbPromise;
}

async function fastCacheGetRaw(key) {
    const db = await openFastCacheDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FAST_CACHE_STORE, 'readonly');
        const req = tx.objectStore(FAST_CACHE_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function fastCachePutRaw(key, value) {
    const db = await openFastCacheDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FAST_CACHE_STORE, 'readwrite');
        tx.objectStore(FAST_CACHE_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

const fastCacheGetBlob = (url) => fastCacheGetRaw(url).then(v => (v && v.blob) ? v.blob : null);
const fastCachePutBlob = (url, blob) => fastCachePutRaw(url, { blob, ts: Date.now() });
const fastCacheGetXhr = (url) => fastCacheGetRaw(url).then(v => (v && v.data !== undefined) ? v : null);
const fastCachePutXhr = (url, data, responseType) => fastCachePutRaw(url, { data, responseType, ts: Date.now() });

async function fastCacheClear() {
    const db = await openFastCacheDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FAST_CACHE_STORE, 'readwrite');
        tx.objectStore(FAST_CACHE_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function fastCacheGetAllEntries() {
    const db = await openFastCacheDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FAST_CACHE_STORE, 'readonly');
        const store = tx.objectStore(FAST_CACHE_STORE);
        const keysReq = store.getAllKeys();
        const valuesReq = store.getAll();
        let keys = null, values = null;
        function maybeResolve() {
            if (keys !== null && values !== null) {
                resolve(keys.map((k, i) => ({ url: k, value: values[i] })));
            }
        }
        keysReq.onsuccess = () => { keys = keysReq.result; maybeResolve(); };
        valuesReq.onsuccess = () => { values = valuesReq.result; maybeResolve(); };
        keysReq.onerror = () => reject(keysReq.error);
        valuesReq.onerror = () => reject(valuesReq.error);
    });
}

/**
 * ==== ZIP tối giản (chỉ method Store, không nén) ====
 * Không cần thư viện ngoài. Đủ dùng vì mục tiêu là backup/restore 1-1,
 * không cần tối ưu dung lượng.
 */
function crc32(bytes) {
    let crc = ~0;
    for (let i = 0; i < bytes.length; i++) {
        crc ^= bytes[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
        }
    }
    return (~crc) >>> 0;
}

function strToBytes(str) {
    return new TextEncoder().encode(str);
}

async function valueToBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (typeof data === 'string') return strToBytes(data);
    // Trường hợp hiếm (vd responseType 'json' đã được parse sẵn thành object).
    return strToBytes(JSON.stringify(data));
}

// Quy ước path trong zip: "./domain.com/path/to/media.jpg" (bỏ query string).
function urlToZipPath(urlStr) {
    try {
        const u = new URL(urlStr);
        let pathPart = u.pathname && u.pathname !== '/' ? u.pathname : '/index';
        return `./${u.hostname}${pathPart}`;
    } catch (e) {
        return `./_invalid/${encodeURIComponent(urlStr)}`;
    }
}

function zipPathToUrl(path) {
    const clean = path.replace(/^\.\//, '').replace(/^\/+/, '');
    return 'https://' + clean;
}

function isImageUrl(url) {
    return /\.(png|jpe?g|webp)(\?.*)?$/i.test(url);
}
function isBinaryAssetUrl(url) {
    return /\.(mp3|mp4|ogg|m4a|ttf)(\?.*)?$/i.test(url);
}

async function buildZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    for (const entry of entries) {
        const nameBytes = strToBytes(entry.path);
        const data = entry.bytes;
        const crc = crc32(data);

        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true);
        lh.setUint16(4, 20, true);
        lh.setUint16(6, 0, true);
        lh.setUint16(8, 0, true); // method = store
        lh.setUint16(10, dosTime, true);
        lh.setUint16(12, dosDate, true);
        lh.setUint32(14, crc, true);
        lh.setUint32(18, data.length, true);
        lh.setUint32(22, data.length, true);
        lh.setUint16(26, nameBytes.length, true);
        lh.setUint16(28, 0, true);
        localParts.push(new Uint8Array(lh.buffer), nameBytes, data);

        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true);
        ch.setUint16(4, 20, true);
        ch.setUint16(6, 20, true);
        ch.setUint16(8, 0, true);
        ch.setUint16(10, 0, true);
        ch.setUint16(12, dosTime, true);
        ch.setUint16(14, dosDate, true);
        ch.setUint32(16, crc, true);
        ch.setUint32(20, data.length, true);
        ch.setUint32(24, data.length, true);
        ch.setUint16(28, nameBytes.length, true);
        ch.setUint16(30, 0, true);
        ch.setUint16(32, 0, true);
        ch.setUint16(34, 0, true);
        ch.setUint16(36, 0, true);
        ch.setUint32(38, 0, true);
        ch.setUint32(42, offset, true);
        centralParts.push(new Uint8Array(ch.buffer), nameBytes);

        offset += 30 + nameBytes.length + data.length;
    }

    const centralDirOffset = offset;
    const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);

    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, centralDirOffset, true);
    eocd.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

function parseZip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) throw new Error('Không phải file ZIP hợp lệ (không tìm thấy EOCD).');

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);

    const centralEntries = [];
    let p = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Central directory không hợp lệ.');
        const method = view.getUint16(p + 10, true);
        const compSize = view.getUint32(p + 20, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const localHeaderOffset = view.getUint32(p + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
        centralEntries.push({ name, method, compSize, localHeaderOffset });
        p += 46 + nameLen + extraLen + commentLen;
    }

    return centralEntries.map((e) => {
        const lp = e.localHeaderOffset;
        if (view.getUint32(lp, true) !== 0x04034b50) throw new Error('Local file header không hợp lệ: ' + e.name);
        const lNameLen = view.getUint16(lp + 26, true);
        const lExtraLen = view.getUint16(lp + 28, true);
        const dataStart = lp + 30 + lNameLen + lExtraLen;

        if (e.method !== 0) {
            console_warn('[FastCache Import] Bỏ qua entry bị nén (chỉ hỗ trợ Store):', e.name);
            return { path: e.name, bytes: null };
        }
        return { path: e.name, bytes: bytes.slice(dataStart, dataStart + e.compSize) };
    });
}

async function fastCacheExportZip() {
    const all = await fastCacheGetAllEntries();
    if (all.length === 0) {
        // Frame này (theo origin hiện tại) không có gì trong cache — trả về
        // null thay vì file zip rỗng, để không tự động tải xuống 1 file
        // rỗng gây nhầm lẫn (đặc biệt khi extension chạy trên nhiều frame
        // cùng lúc: trang chủ + iframe CDN, mỗi frame có IndexedDB riêng).
        return null;
    }

    const usedPaths = new Set();
    const zipEntries = [];

    for (const { url, value } of all) {
        let bytes;
        if (value.blob) {
            bytes = new Uint8Array(await value.blob.arrayBuffer());
        } else if (value.data !== undefined) {
            bytes = await valueToBytes(value.data);
        } else {
            continue;
        }

        let path = urlToZipPath(url);
        if (usedPaths.has(path)) {
            // Trùng path (thường do khác query string, path đã bỏ query) ->
            // thêm hậu tố ngắn từ CRC32 của URL gốc để không ghi đè mất dữ liệu.
            const suffix = '~' + crc32(strToBytes(url)).toString(16);
            const dot = path.lastIndexOf('.');
            path = dot > -1 ? path.slice(0, dot) + suffix + path.slice(dot) : path + suffix;
        }
        usedPaths.add(path);
        zipEntries.push({ path, bytes });
    }

    console_log(`[FastCache] Chuẩn bị xuất ${zipEntries.length} tài nguyên (origin: ${location.origin}).`);
    return buildZip(zipEntries);
}

async function fastCacheImportZip(arrayBuffer) {
    const entries = parseZip(arrayBuffer);
    let imported = 0, skipped = 0;

    for (const entry of entries) {
        if (!entry.bytes) { skipped++; continue; }
        const url = zipPathToUrl(entry.path);
        try {
            if (isImageUrl(url)) {
                await fastCachePutBlob(url, new Blob([entry.bytes]));
            } else if (isBinaryAssetUrl(url)) {
                await fastCachePutXhr(url, entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength), 'arraybuffer');
            } else {
                await fastCachePutXhr(url, new TextDecoder('utf-8').decode(entry.bytes), 'text');
            }
            imported++;
        } catch (e) {
            console_warn('[FastCache Import] Lỗi ghi entry:', entry.path, e);
            skipped++;
        }
    }

    return { imported, skipped, total: entries.length };
}

onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_FASTCACHE_EXPORT') {
        fastCacheExportZip()
            .then((blob) => {
                if (!blob) return; // Frame này không có cache -> im lặng, không báo lỗi
                sendToExtension({ type: 'FASTCACHE_EXPORT_DONE', blob });
            })
            .catch((e) => {
                console_error('[FastCache] Lỗi xuất cache:', e);
                sendToExtension({ type: 'FASTCACHE_EXPORT_ERROR', message: String(e) });
            });
    }
});

onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_FASTCACHE_IMPORT') {
        fastCacheImportZip(event.data.arrayBuffer)
            .then((result) => sendToExtension({ type: 'FASTCACHE_IMPORT_DONE', result }))
            .catch((e) => {
                console_error('[FastCache] Lỗi nhập cache:', e);
                sendToExtension({ type: 'FASTCACHE_IMPORT_ERROR', message: String(e) });
            });
    }
});

onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_FASTCACHE_UPDATE') {
        fastCacheEnabled = !!event.data.enabled;
    }
});
onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_FAKE2_UPDATE') {
        fakeCrave2Enabled = !!event.data.enabled;
    }
});
onExtensionMessage((event) => {
    if (event.data && event.data.type === 'GAME_FASTCACHE_CLEAR') {
        fastCacheClear()
            .then(() => sendToExtension({ type: 'FASTCACHE_CLEAR_DONE' }))
            .catch((e) => console_error('[FastCache] Lỗi xóa cache:', e));
    }
});

/**
 * ==== Hook ảnh (Image.src) ====
 * Chặn trước khi Image tạo network request thật: nếu đã có trong IDB -> gán
 * luôn blob URL (không đụng mạng). Nếu chưa có -> tự fetch(), lưu Blob vào
 * IDB, rồi gán blob URL cho <img> (thay vì để trình duyệt tự tải qua src).
 */
(function hookImageFastCache() {
    const imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (!imgSrcDesc || !imgSrcDesc.set) return;

    function isCacheableImageUrl(url) {
        return /\.(png|jpe?g|webp)(\?.*)?$/i.test(url);
    }

    async function loadImageThroughFastCache(img, url) {
        const resolvedUrl = resolveUrl(url);
        try {
            const cachedBlob = await fastCacheGetBlob(resolvedUrl);
            if (cachedBlob) {
                console_log('[FastCache] Dùng cache ảnh:', url);
                imgSrcDesc.set.call(img, URL.createObjectURL(cachedBlob));
                return;
            }
        } catch (e) {
            console_warn('[FastCache] Lỗi đọc cache ảnh, tải mạng bình thường:', e);
        }

        try {
            const resp = await fetch(resolvedUrl, { credentials: 'omit' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const blob = await resp.blob();
            fastCachePutBlob(resolvedUrl, blob).catch(() => {});
            //console_log('[FastCache] Tải và cache ảnh:', resolvedUrl);
            imgSrcDesc.set.call(img, URL.createObjectURL(blob));
        } catch (e) {
            // CORS bị chặn hoặc lỗi mạng -> fallback tải trực tiếp, KHÔNG qua cache
            imgSrcDesc.set.call(img, url);
        }
    }

    Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        get() { return imgSrcDesc.get.call(this); },
        set(url) {
            if (typeof url === 'string') {
                url = applyFakeCrave2Rewrite(url);
            }
            if (!fastCacheEnabled || typeof url !== 'string' ||
                url.startsWith('blob:') || url.startsWith('data:') ||
                !isCacheableImageUrl(url)) {
                return imgSrcDesc.set.call(this, url);
            }
            loadImageThroughFastCache(this, url);
        }
    });
    mark(HTMLImageElement.prototype.__lookupSetter__('src'), "function set src() { [native code] }");
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
                method: null,
                url: null,
                fastCachedResponse: undefined,
                fakeReadyState: undefined,
                fakeStatus: undefined,
                hasRangeHeader: false,
            });
        }
        return stateMap.get(xhr);
    }

    // ==== Fast Cache cho XHR GET tài nguyên tĩnh (json/plist/atlas/audio/font...) ====
    // Không đụng file .txt story (đã có luồng dịch riêng) và không đụng API động /readStory.
    const FASTCACHE_XHR_EXT_REGEX = /\.(json|plist|atlas|fnt|mp3|mp4|ogg|m4a|ttf)(\?.*)?$/i;

    // Một số audio được tải theo kiểu Range (streaming từng đoạn) -> server trả về
    // 206 Partial Content, tức KHÔNG PHẢI toàn bộ file. Nếu cache nhầm đoạn này,
    // lần sau phát lại từ cache sẽ bị thiếu/lỗi. Nên phát hiện header "Range" và
    // loại các request này khỏi luồng fast-cache (để tải/đi thẳng như bình thường).
    const rawSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (typeof name === 'string' && name.toLowerCase() === 'range') {
            getState(this).hasRangeHeader = true;
        }
        return rawSetRequestHeader.call(this, name, value);
    };
    mark(XMLHttpRequest.prototype.setRequestHeader, "function setRequestHeader() { [native code] }");

    function isFastCacheableXhr(st) {
        return fastCacheEnabled
            && st.method === 'GET'
            && typeof st.url === 'string'
            && !st.isStoryFile
            && !st.isReadStory
            && !st.hasRangeHeader
            && FASTCACHE_XHR_EXT_REGEX.test(st.url);
    }

    const originalReadyStateDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'readyState');
    const originalStatusDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'status');

    Object.defineProperty(XMLHttpRequest.prototype, 'readyState', {
        configurable: true,
        get() {
            const st = getState(this);
            return st.fakeReadyState !== undefined ? st.fakeReadyState : originalReadyStateDesc.get.call(this);
        }
    });

    Object.defineProperty(XMLHttpRequest.prototype, 'status', {
        configurable: true,
        get() {
            const st = getState(this);
            return st.fakeStatus !== undefined ? st.fakeStatus : originalStatusDesc.get.call(this);
        }
    });

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
                const customResult = sanitizeAndFormatTranslation(dictValue);
                return interleaveMarkers(customResult);
            }
        }

        if (translateEngine === 'gemma' && currentGemmaBatchResults && currentGemmaBatchResults.has(cleanText)) {
            const translated = currentGemmaBatchResults.get(cleanText);
            if (translated) {
                const result = sanitizeAndFormatTranslation(translated);
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
                const result = sanitizeAndFormatTranslation(translated);
                
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
            console_error(`[Network Error] "${cleanText}":`, err);
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

    const MSG_LINE_REGEX = /^(msg,\d+,\s*(?:<size=\d+>)?)((?:\\,|[^<,])*)((?:<\/size>)?,.*?)(\r?)$/;

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
            console_log(`[Gemma] Gộp ${uniqueItems.length} câu chưa dịch của "${fileName || ''}" vào 1 request...`);
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
                const [, prefix, content, suffix, cr] = match;
                const speakerForThisLine = currentSpeaker;
                const translated = await translateSingleText(content, speakerForThisLine, fileName);
                return `${prefix}${translated}${suffix}${cr}`;
            }

            if (line.startsWith('select,')) {
                return await processSelectLine(line, fileName);
            }

            return line;
        });

        return (await Promise.all(tasks)).join('\n');
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
        st.method = method;
        // Fake Crave Saga X 2.0: tráo URL tài nguyên (nhạc/nền) sang bản JP
        // trước khi resolve/cache key, để mọi logic bên dưới (fast cache,
        // request thật) đều thấy URL đã bị tráo.
        if (typeof url === 'string') {
            url = applyFakeCrave2Rewrite(url);
        }
        // Cache key luôn dùng URL tuyệt đối (resolve theo document hiện tại)
        // để tránh cùng 1 tài nguyên bị coi là 2 key khác nhau khi game gọi
        // bằng đường dẫn tương đối ở những nơi khác nhau.
        st.url = typeof url === 'string' ? resolveUrl(url) : url;
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
            try { st.realOnReadyStateChange.call(xhr, evt); } catch (e) { console_error(e); }
        }
        st.rscListeners.forEach(fn => {
            try { fn.call(xhr, evt); } catch (e) { console_error(e); }
        });

        if (xhr.readyState === 4) {
            if (typeof st.realOnload === 'function') {
                try { st.realOnload.call(xhr, evt); } catch (e) { console_error(e); }
            }
            st.loadListeners.forEach(fn => {
                try { fn.call(xhr, evt); } catch (e) { console_error(e); }
            });
        }
    }

    async function handleFastCacheSend(xhr, st, body) {
        try {
            const cached = await fastCacheGetXhr(st.url);
            if (cached) {
                st.fastCachedResponse = cached.data;
                st.fakeStatus = 200;
                st.fakeReadyState = 4;
                setTimeout(() => dispatchRealEvent(xhr, { type: 'readystatechange', target: xhr }), 0);
                console_log('[FastCache] Cache hit XHR:', st.url);
                return;
            }
        } catch (e) {
            console_warn('[FastCache] Lỗi đọc cache XHR, tải mạng bình thường:', e);
        }

        // Cache miss -> tải mạng thật, đồng thời "nghe lén" response để lưu cache cho lần sau.
        // QUAN TRỌNG: đây là listener readystatechange DUY NHẤT của request này (vì send()
        // đã return sớm, không chạy qua nhánh bridge mặc định bên dưới) nên bắt buộc phải tự
        // gọi dispatchRealEvent ở đây — nếu không, callback/onload thật của game sẽ không bao
        // giờ được gọi và request coi như "treo" mãi mãi (đây là nguyên nhân game không load).
        rawAddEventListener.call(xhr, 'readystatechange', function onFastCacheCapture(evt) {
            if (xhr.readyState !== 4) return;

            if (xhr.status === 200 || xhr.status === 0) {
                try {
                    const rt = xhr.responseType || 'text';
                    let raw = (rt === 'text' || rt === '')
                        ? originalResponseTextDesc.get.call(xhr)
                        : originalResponseDesc.get.call(xhr);
                    // QUAN TRỌNG: clone ngay (đồng bộ) ArrayBuffer trước khi forward event cho game.
                    // Nếu không, game có thể transfer/detach buffer gốc (vd: postMessage transferable,
                    // decodeAudioData, Worker...) trước khi transaction IndexedDB kịp put() (vì
                    // fastCachePutRaw phải await openFastCacheDb() trước), gây lỗi
                    // "DataCloneError: ArrayBuffer is detached and could not be cloned".
                    if (raw instanceof ArrayBuffer) {
                        raw = raw.slice(0);
                    }
                    fastCachePutXhr(st.url, raw, rt)
                        .then(() => console_log('[FastCache] Đã cache:', st.url))
                        .catch((e) => console_warn('[FastCache] Lỗi ghi IndexedDB:', st.url, e));
                } catch (e) {
                    console_warn('[FastCache] Lỗi lưu cache XHR:', st.url, e);
                }
            } else {
                console_log('[FastCache] Bỏ qua cache (status ' + xhr.status + '):', st.url);
            }

            // Luôn forward về game dù thành công hay lỗi, để không bao giờ "treo" request.
            dispatchRealEvent(xhr, evt);
        });

        rawSend.call(xhr, body);
    }

    XMLHttpRequest.prototype.send = function (body) {
        const st = getState(this);

        if (isFastCacheableXhr(st)) {
            handleFastCacheSend(this, st, body);
            return;
        }

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
                                console_log("readStory", item.md5 + '.txt', '->', item.resourcePath);
                                map[item.md5 + '.txt'] = item.resourcePath;
                            }
                        });
                        if (Object.keys(map).length) {
                            sendToExtension({ type: 'STORY_RESOURCE_MAP_UPDATE', map });
                        }
                    }
                } catch (e) {
                    console_warn('[ReadStory] Không parse được response:', e);
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
                console_log(`[Story Intercepted] ${st.fileName || ''} — không có lời thoại, bỏ qua dịch`);
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
                console_log(`[Story Intercepted] ${st.fileName || ''} — dịch tắt, dùng bản gốc`);
                st.translatedText = rawText;
                dispatchRealEvent(this, evt);
                return;
            }

            console_log(`[Story Intercepted] ${st.fileName || ''} — đang dịch...`);

            processStoryScript(rawText, st.fileName)
                .then((result) => {
                    st.translatedText = result;
                    console_log("Dịch xong:", result.substring(0, 150) + "...");
                    // Cache nguyên văn bản đã dịch (đúng thứ tự dòng) cho chap này,
                    // dùng để export .doc bản tiếng Việt.
                    if (st.fileName) {
                        sendToExtension({ type: 'STORY_FILE_TRANSLATED_CACHE', fileName: st.fileName, translated: result });
                    }
                })
                .catch((err) => {
                    console_error("Lỗi dịch, dùng bản gốc:", err);
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
            if (st.translatedText !== null) return st.translatedText;
            if (st.fastCachedResponse !== undefined) return st.fastCachedResponse;
            return originalResponseTextDesc.get.call(this);
        }
    });

    Object.defineProperty(XMLHttpRequest.prototype, 'response', {
        configurable: true,
        get() {
            const st = getState(this);
            if (st.translatedText !== null) return st.translatedText;
            if (st.fastCachedResponse !== undefined) return st.fastCachedResponse;
            return originalResponseDesc.get.call(this);
        }
    });

    console_log("[Story Translator Hook v2] Sẵn sàng");
})();