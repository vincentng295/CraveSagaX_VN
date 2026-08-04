
let is_translated = 1;
let customTranslationDict = {};

// Ký tự vô hình (Zero Width Space, U+200B) dùng làm "cờ đánh dấu": khi tầng
// chặn XHR (IIFE thứ 2 bên dưới) đã dịch sẵn 1 đoạn thoại trong file kịch bản,
// nó sẽ chèn ký tự này vào đầu chuỗi kết quả. Khi Cocos gán chuỗi đó vào
// label.string, initCocosHook() (IIFE thứ 1) nhận diện được cờ này để BỎ QUA
// việc live-translate lại — tránh gọi API dịch 2 lần cho cùng 1 câu, và tránh
// dịch chồng lên bản đã dịch sẵn (dịch tiếng Việt -> tiếng Việt lần nữa dễ ra
// kết quả sai). Đặt ở scope ngoài cùng (không nằm trong IIFE nào) để cả 2 IIFE
// phía dưới cùng tham chiếu tới đúng 1 giá trị.
const TRANSLATED_MARKER = '\u200B';

// ------------------------------------------------------------------
// Bộ đếm "seq" toàn cục — dùng để SẮP XẾP đúng thứ tự THẬT mà các câu thoại
// xuất hiện, KHÔNG phải để hiển thị "thời gian" cho người dùng.
//
// Vấn đề: khi dịch 1 file kịch bản (processStoryScript), nhiều dòng "msg,"
// được dịch SONG SONG (Promise.all, mỗi dòng tự gọi Google Translate API
// riêng). Các API đó trả lời KHÔNG theo đúng thứ tự dòng trong file, nên nếu
// content.js chỉ dựa vào Date.now() tại thời điểm NHẬN được message
// SAVE_NEW_TRANSLATION để làm mốc sắp xếp, thứ tự hiển thị ở trang Options sẽ
// bị xáo trộn theo thứ tự mạng trả lời chứ không theo thứ tự hội thoại.
//
// Giải pháp: chụp lại "seq" NGAY TẠI ĐIỂM BẮT ĐẦU xử lý từng câu — tức là
// đồng bộ, TRƯỚC await đầu tiên — đúng lúc code còn chạy tuần tự theo thứ tự
// dòng trong file kịch bản (xem giải thích tương tự ở currentSpeaker trong
// processStoryScript bên dưới). Giá trị seq này được gửi kèm qua postMessage;
// content.js chỉ việc LƯU LẠI, không tự tính toán gì thêm.
//
// Base khởi tạo = Date.now() để seq luôn tăng dần XUYÊN SUỐT nhiều lần load
// trang (F5, chuyển màn, v.v.) — tránh trường hợp câu mới ở phiên sau bị gán
// seq nhỏ hơn (vì counter reset về 0) rồi bị sort lên TRƯỚC các câu cũ đã lưu
// từ phiên trước.
let __translationSeqCounter = Date.now();
function nextTranslationSeq() {
    __translationSeqCounter += 1;
    return __translationSeqCounter;
}

// customTranslationDict giờ hỗ trợ 2 dạng giá trị cho mỗi key (để tương thích
// ngược với các bản dịch đã thu thập trước đây):
//   - string: bản dịch thuần (không có thông tin nhân vật) — dạng cũ
//   - object { translated, name }: bản dịch kèm tên nhân vật đã nói câu đó
// Hàm này chuẩn hoá cả 2 dạng về 1 chuỗi bản dịch duy nhất, dùng chung ở mọi
// nơi cần đọc dict (live-translate lẫn dịch file kịch bản qua XHR).
function extractTranslatedValue(entry) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof entry.translated === 'string') return entry.translated;
    return null;
}

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GAME_TRANSLATION_STATE_UPDATE') {
        window.is_translated = event.data.enabled ? 1 : 0;
    }
});

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GAME_DICT_UPDATE') {
        window.customTranslationDict = event.data.dict || {};
    }
});

(function () {
    // ------------------------------------------------------------------
    // "Nghe lén" canvas 2D context + font-string mà Cocos dùng nội bộ để
    // rasterize System Font. Vì useSystemFont = true, Cocos chắc chắn gọi
    // measureText() trên 1 canvas 2D nội bộ trước khi vẽ chữ ra texture.
    // Ta chụp lại chính context đó để đo chữ với độ chính xác pixel-perfect,
    // thay vì tự đoán bằng 1 canvas riêng (nguyên nhân gây lệch pixel/xé từ).
    // ------------------------------------------------------------------
    let lastMeasureCtx = null;
    let lastMeasureFont = null;

    (function hookMeasureText() {
        const nativeMeasureText = CanvasRenderingContext2D.prototype.measureText;
        CanvasRenderingContext2D.prototype.measureText = function (text) {
            // Chỉ chụp lại các lệnh đo có vẻ là đo chữ cái (bỏ qua đo icon/số lẻ tẻ)
            if (typeof text === 'string' && /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(text)) {
                lastMeasureCtx = this;
                lastMeasureFont = this.font;
            }
            return nativeMeasureText.call(this, text);
        };
    })();

    const widthCache = new Map(); // key: font + '|' + text  ->  width

    function measureWidth(ctx, font, text) {
        const key = font + '|' + text;
        if (widthCache.has(key)) return widthCache.get(key);
        ctx.font = font;
        const w = ctx.measureText(text).width;
        widthCache.set(key, w);
        return w;
    }

    // Ngắt dòng thủ công dùng chính context/font mà Cocos vừa dùng để đo,
    // đảm bảo khớp 100% với cách engine sẽ render ra.
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
                    // Vẫn vừa dòng, hoặc dòng đang trống (bắt buộc phải nhận từ này)
                    if (candidateWidth <= maxWidth) {
                        currentLine = candidate;
                        continue;
                    }
                }

                if (currentLine && candidateWidth > maxWidth) {
                    outLines.push(currentLine);
                    currentLine = '';
                }

                // Nếu bản thân 1 từ đã dài hơn maxWidth (hiếm gặp với tiếng Việt),
                // mới buộc phải bẻ theo ký tự — nhưng vẫn đo bằng đúng font/context thật.
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
            if (!window.is_translated) return text;
            if (!text || !text.trim()) return text;
            const cleanText = text.trim();
            const seq = nextTranslationSeq(); // chụp thứ tự NGAY tại đây (đồng bộ) — xem giải thích ở đầu file

            // 1. Kiểm tra từ điển Custom Dict trước (đã import hoặc thu thập)
            if (window.customTranslationDict && window.customTranslationDict[cleanText]) {
                const dictValue = extractTranslatedValue(window.customTranslationDict[cleanText]);
                if (dictValue) return dictValue;
            }

            // 2. Kiểm tra bộ nhớ đệm Cache tạm thời
            if (translationCache.has(cleanText)) return translationCache.get(cleanText);

            // 3. Nếu chưa có -> Gọi API Google Translate
            try {
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(cleanText)}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP error ${res.status}`);
                const data = await res.json();
                let translated = data[0].map(item => item[0]).join('');

                // Lưu vào Cache tạm thời
                translationCache.set(cleanText, translated);

                // Lưu vào Dictionary để ghi nhớ lâu dài và sync sang Options
                window.postMessage({
                    type: 'SAVE_NEW_TRANSLATION',
                    original: cleanText,
                    translated: translated,
                    seq
                }, '*');

                return translated;
            } catch (e) {
                // Dịch thất bại: Lưu value trống ""
                window.postMessage({
                    type: 'SAVE_NEW_TRANSLATION',
                    original: cleanText,
                    translated: '',
                    seq
                }, '*');
                return null;
            }
        }

        function fixCocosFont(label) {
            try {
                if ('useSystemFont' in label) label.useSystemFont = true;
                if ('_isSystemFontUsed' in label) label._isSystemFontUsed = true;
                if (label.font) label.font = null;
                if (label._N$file) label._N$file = null;
                if (label._font) label._font = null;

                label.fontFamily = "Arial, sans-serif";

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

        // Fix font + ngắt dòng lại rồi render lại cho 1 label, dùng thẳng
        // `text` truyền vào (text đã là bản dịch cuối cùng, hàm này không tự dịch gì).
        // Dùng chung cho cả nhánh "đã dịch sẵn ở XHR" lẫn nhánh "live-translate" bên dưới.
        function fixAndRewrap(labelInstance, text) {
            fixCocosFont(labelInstance);

            // PASS A: bật wrap engine gốc và gán text để Cocos tự đo chữ —
            // hook measureText ở trên sẽ "chụp" lại context + font thật
            // mà nó vừa dùng. (Có thể hiện sai 1 frame, không đáng kể.)
            labelInstance.enableWrapText = true;
            if ('_enableWrapText' in labelInstance) labelInstance._enableWrapText = true;
            originalSet.call(labelInstance, text);

            if (!lastMeasureCtx || !lastMeasureFont) {
                // Không bắt được context đo (build không dùng canvas 2D để đo
                // system font) — đành để engine tự wrap như cũ.
                if (typeof labelInstance._updateRenderData === 'function') labelInstance._updateRenderData(true);
                if (typeof labelInstance.setVertsDirty === 'function') labelInstance.setVertsDirty();
                return;
            }

            // PASS B: tự ngắt dòng bằng đúng context/font vừa chụp được,
            // rồi tắt wrap tự động của engine và gán text đã có \n sẵn.
            const safetyMargin = 8; // chừa lề nhỏ tránh dính viền
            const maxWidth = (labelInstance.node ? labelInstance.node.width : 650) - safetyMargin;
            const wrapped = wrapWithEngineMetrics(lastMeasureCtx, lastMeasureFont, text, maxWidth);

            labelInstance.enableWrapText = false;
            if ('_enableWrapText' in labelInstance) labelInstance._enableWrapText = false;
            originalSet.call(labelInstance, wrapped);

            if (typeof labelInstance._updateRenderData === 'function') labelInstance._updateRenderData(true);
            if (typeof labelInstance.setVertsDirty === 'function') labelInstance.setVertsDirty();
        }

        Object.defineProperty(proto, 'string', {
            set: function (val) {
                const labelInstance = this;

                // ================== NHÁNH 1: text đã được dịch sẵn ở tầng XHR ==================
                // (có TRANSLATED_MARKER ở đầu) -> bỏ ký tự đánh dấu, set thẳng,
                // KHÔNG gọi API dịch nữa (tránh dịch đè lần 2 lên bản đã dịch sẵn).
                // Vẫn cần fix font + ngắt dòng lại vì đây là bước hiển thị, độc lập
                // với việc nội dung đến từ đâu.
                if (typeof val === 'string' && val.charAt(0) === TRANSLATED_MARKER) {
                    const cleanVal = val.slice(TRANSLATED_MARKER.length);
                    originalSet.call(this, cleanVal);

                    if (debounceMap.has(this)) {
                        clearTimeout(debounceMap.get(this));
                    }
                    debounceMap.set(this, setTimeout(() => {
                        fixAndRewrap(labelInstance, cleanVal);
                    }, 150));
                    return;
                }

                // ================== NHÁNH 2: text thường -> LIVE TRANSLATE ==================
                // (dùng cho các label không đi qua file .txt bị chặn XHR — ví dụ text UI,
                // menu, popup được set trực tiếp bằng JS của game thay vì đọc từ kịch bản.)
                originalSet.call(this, val);

                if (!window.is_translated || !val || typeof val !== 'string' || !isDialogueText(val)) return;

                if (debounceMap.has(this)) {
                    clearTimeout(debounceMap.get(this));
                }

                debounceMap.set(this, setTimeout(async () => {
                    let translatedText = await translateText(val);
                    if (!translatedText || !window.is_translated) return;
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

    // ================== GIỮ LẠI CÁC HÀM GỐC TRƯỚC KHI PATCH ==================
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    const rawAddEventListener = XMLHttpRequest.prototype.addEventListener;

    const originalResponseTextDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
    const originalResponseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
    const originalOnloadDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'onload');
    const originalOnRscDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'onreadystatechange');

    const PREFIX = "https://nutaku-resource-en.cravesaga.johren.games/1.113.0/";
    const SUFFIX = ".txt";

    // WeakMap lưu state riêng cho từng instance XHR (tránh rò rỉ biến toàn cục)
    const stateMap = new WeakMap();
    function getState(xhr) {
        if (!stateMap.has(xhr)) {
            stateMap.set(xhr, {
                isStoryFile: false,
                translatedText: null,
                translating: false,
                realOnload: null,          // callback thật game gán qua .onload =
                realOnReadyStateChange: null,
                loadListeners: [],         // callback gán qua addEventListener('load', ...)
                rscListeners: [],          // callback gán qua addEventListener('readystatechange', ...)
            });
        }
        return stateMap.get(xhr);
    }

    const translateCache = new Map();

    // ================== 1. DỊCH MỘT CÂU ==================
    // speakerName: tên nhân vật đang nói câu này (lấy từ dòng "name," gần nhất
    // phía trước trong file kịch bản), hoặc null nếu là lời dẫn/không rõ nhân vật.
    // Chỉ dùng để LƯU kèm vào dict khi phát hiện câu mới — không ảnh hưởng gì
    // tới bản thân việc dịch.
    async function translateSingleText(text, speakerName = null) {
        if (!text || !text.trim()) return text;
        // Chụp lại "seq" NGAY TẠI ĐÂY — đồng bộ, trước await đầu tiên. Vì
        // processStoryScript gọi hàm này bên trong lines.map(async...), phần
        // thân hàm chạy tới đây vẫn còn đồng bộ và đúng thứ tự dòng trong file,
        // bất kể fetch() bên dưới hoàn thành theo thứ tự nào sau đó.
        const seq = nextTranslationSeq();
        const cleanText = text.replace(/\\,/g, ',');

        // 1. Ưu tiên tra cứu từ Custom Dict
        if (window.customTranslationDict && window.customTranslationDict[cleanText]) {
            const dictValue = extractTranslatedValue(window.customTranslationDict[cleanText]);
            if (dictValue) { // Chỉ sử dụng nếu value không trống
                const customResult = dictValue.replace(/,/g, '\\,');
                return TRANSLATED_MARKER + customResult;
            }
        }

        // 2. Tra cứu Cache tạm thời
        if (translateCache.has(cleanText)) {
            const cached = translateCache.get(cleanText);
            return cached ? (TRANSLATED_MARKER + cached) : text;
        }

        // 3. Gọi API Google Translate
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(cleanText)}`; 
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            
            const data = await res.json();
            if (data && data[0]) {
                const translated = data[0].map(seg => seg[0]).join('');
                const result = translated.replace(/,/g, '\\,');
                
                translateCache.set(cleanText, result); 

                window.postMessage({
                    type: 'SAVE_NEW_TRANSLATION',
                    original: cleanText,
                    translated: translated,
                    speaker: speakerName || undefined,
                    seq
                }, '*');

                return TRANSLATED_MARKER + result; 
            }
        } catch (err) {
            console.error(`[Network Error] "${cleanText}":`, err);
        }

        // DỊCH THẤT BẠI: Vẫn lưu vào Dict với value trống ""
        // Không truyền seq mới nếu key đã từng tồn tại trong dict để giữ nguyên seq cũ ở content.js
        window.postMessage({
            type: 'SAVE_NEW_TRANSLATION',
            original: cleanText,
            translated: '', // Value trống
            speaker: speakerName || undefined,
            seq
        }, '*');

        return text; // Trả về bản gốc để game không bị lỗi hiển thị
    }

    // ================== 2. PARSE + DỊCH TOÀN BỘ SCRIPT ==================
    const MSG_LINE_REGEX = /^(msg,\d+,\s*(?:<size=\d+>)?)((?:\\,|[^<,])*)((?:<\/size>)?,.*)$/;

    // ================== TÁCH CHUỖI THEO DẤU PHẨY "THẬT" (bỏ qua \,) ==================
    function splitUnescapedComma(str) {
        // Khớp từng token: hoặc là "\," (escape) hoặc bất kỳ ký tự nào khác dấu phẩy
        // Lặp lại cho tới khi gặp dấu phẩy thật -> đó là ranh giới field
        const parts = [];
        let current = '';
        for (let i = 0; i < str.length; i++) {
            if (str[i] === '\\' && str[i + 1] === ',') {
                current += '\\,';
                i++; // bỏ qua luôn ký tự ',' đã xử lý
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

    // ================== TRÍCH TÊN NHÂN VẬT TỪ DÒNG "name,..." ==================
    // Dòng "name,<size=32>Schmiel</size>," -> tên nhân vật là "Schmiel".
    // Dòng "name," (rỗng) -> không có nhân vật (lời dẫn game) -> trả về null.
    function extractSpeakerName(line) {
        const fields = splitUnescapedComma(line); // fields[0] === "name"
        const raw = (fields[1] || '').replace(/\\,/g, ',');
        const stripped = raw.replace(/<[^>]*>/g, '').trim();
        return stripped || null;
    }

    // ================== XỬ LÝ DÒNG select,option1,option2,... ==================
    async function processSelectLine(line) {
        const fields = splitUnescapedComma(line); // fields[0] === "select"
        const tasks = fields.map(async (field, idx) => {
            if (idx === 0) return field; // giữ nguyên từ khóa "select"
            if (!field.trim()) return field; // field rỗng (trailing comma) -> giữ nguyên
            return await translateSingleText(field);
        });
        const translated = await Promise.all(tasks);
        return translated.join(',');
    }

    async function processStoryScript(rawScript) {
        const lines = rawScript.split('\n');

        // Theo dõi nhân vật đang thoại xuyên suốt file kịch bản. Array.prototype.map
        // gọi callback cho từng dòng THEO THỨ TỰ, đồng bộ, cho tới khi gặp await đầu
        // tiên trong mỗi lần gọi — nên việc đọc/ghi currentSpeaker ở phần đồng bộ
        // (trước await) của mỗi dòng vẫn đảm bảo đúng thứ tự xuất hiện trong file,
        // dù các bản dịch msg,... phía sau chạy bất đồng bộ song song.
        let currentSpeaker = null;

        const tasks = lines.map(async (line) => {
            if (line.startsWith('name,')) {
                currentSpeaker = extractSpeakerName(line);
                return line;
            }

            if (line.startsWith('msg,')) {
                const match = line.match(MSG_LINE_REGEX);
                if (!match || !match[2] || !match[2].trim()) return line;
                const [, prefix, content, suffix] = match;
                const speakerForThisLine = currentSpeaker; // chụp lại tại thời điểm này
                const translated = await translateSingleText(content, speakerForThisLine);
                return `${prefix}${translated}${suffix}`;
            }

            if (line.startsWith('select,')) {
                return await processSelectLine(line);
            }

            return line; // các dòng lệnh khác (clickwait, ...) giữ nguyên
        });

        return (await Promise.all(tasks)).join('\n');
    }

    // ================== 3. PATCH open() — chỉ đánh dấu URL ==================
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const st = getState(this);
        st.isStoryFile = typeof url === 'string' && url.startsWith(PREFIX) && url.endsWith(SUFFIX);
        return rawOpen.call(this, method, url, ...rest);
    };

    // ================== 4. PATCH onload / onreadystatechange Ở CẤP PROTOTYPE ==================
    // QUAN TRỌNG: đây là điểm khác biệt so với bản trước.
    // Nếu chỉ đọc rồi lưu this.onload trong send(), thì lúc game gán
    // "xhr.onload = fn" TRƯỚC khi send() chạy, trình duyệt đã tự đăng ký fn
    // làm listener thật ngay tại thời điểm gán — việc ta ghi đè property sau đó
    // (trong send()) KHÔNG hủy được đăng ký đó, nên fn vẫn bị gọi tự động với
    // dữ liệu GỐC ngay khi network xong, trước khi bản dịch kịp có.
    // => Phải ghi đè accessor NGAY TỪ ĐẦU, ở prototype, để mọi lần gán
    //    "xhr.onload = fn" đều đi qua setter của ta (chỉ lưu lại, không đăng ký thật).
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

    // Chặn addEventListener('load'/'readystatechange', ...) tương tự,
    // vì một số framework dùng cách này thay vì gán property.
    XMLHttpRequest.prototype.addEventListener = function (type, listener, options) {
        if (type === 'load' || type === 'readystatechange') {
            const st = getState(this);
            (type === 'load' ? st.loadListeners : st.rscListeners).push(listener);
            return; // không đăng ký thật với trình duyệt
        }
        return rawAddEventListener.call(this, type, listener, options);
    };

    // ================== 5. HÀM PHÁT (FORWARD) SỰ KIỆN THẬT CHO GAME ==================
    function dispatchRealEvent(xhr, evt) {
        const st = getState(xhr);
        // Gọi property-style handlers
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

    // ================== 6. PATCH send() — LOGIC HOÃN (DEFER) ==================
    XMLHttpRequest.prototype.send = function (body) {
        const st = getState(this);

        // Đăng ký MỘT listener nội bộ THẬT (raw, không bị chặn) để biết khi nào
        // network thực sự xong — đây là kênh duy nhất ta còn quyền truy cập trực tiếp.
        rawAddEventListener.call(this, 'readystatechange', (evt) => {
            if (this.readyState !== 4) return;

            // Không phải file kịch bản, hoặc lỗi mạng thật -> forward ngay, không dịch
            if (!st.isStoryFile || (this.status !== 200 && this.status !== 0)) {
                dispatchRealEvent(this, evt);
                return;
            }

            if (st.translating || st.translatedText !== null) {
                // Đã dịch xong từ trước (hiếm khi readystatechange bắn > 1 lần ở state 4)
                if (st.translatedText !== null) dispatchRealEvent(this, evt);
                return;
            }

            st.translating = true;
            const rawText = originalResponseTextDesc.get.call(this);

            if (!window.is_translated) {
                console.log(`[Story Intercepted] ${this._xhrUrl || ''} — dịch tắt, dùng bản gốc`);
                st.translatedText = rawText;
                dispatchRealEvent(this, evt);
                return;
            }

            console.log(`[Story Intercepted] ${this._xhrUrl || ''} — đang dịch...`);

            processStoryScript(rawText)
                .then((result) => {
                    st.translatedText = result;
                    console.log("Dịch xong:", result.substring(0, 150) + "...");
                })
                .catch((err) => {
                    console.error("Lỗi dịch, dùng bản gốc:", err);
                    st.translatedText = rawText; // fallback, không được để game treo
                })
                .finally(() => {
                    // CHỈ TỚI ĐÂY mới forward — lúc này this.responseText (được
                    // override bên dưới) đã trả về bản dịch thay vì bản gốc.
                    dispatchRealEvent(this, evt);
                });
        });

        return rawSend.call(this, body);
    };

    // ================== 7. OVERRIDE responseText / response ==================
    // Dùng descriptor GỐC lấy từ trước khi patch để tránh đệ quy vô hạn.
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