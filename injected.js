
window.is_translated = 1;

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GAME_TRANSLATION_STATE_UPDATE') {
        window.is_translated = event.data.enabled ? 1 : 0;
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
            if (translationCache.has(text)) return translationCache.get(text);
            try {
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
                const res = await fetch(url);
                const data = await res.json();
                let translated = data[0].map(item => item[0]).join('');
                translationCache.set(text, translated);
                return translated;
            } catch (e) {
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

        Object.defineProperty(proto, 'string', {
            set: function (val) {
                originalSet.call(this, val);

                if (!window.is_translated || !val || typeof val !== 'string' || !isDialogueText(val)) return;

                if (debounceMap.has(this)) {
                    clearTimeout(debounceMap.get(this));
                }

                const labelInstance = this;

                debounceMap.set(this, setTimeout(async () => {
                    let translatedText = await translateText(val);
                    if (!translatedText || !window.is_translated) return;

                    fixCocosFont(labelInstance);

                    // PASS A: bật wrap engine gốc và gán text để Cocos tự đo chữ —
                    // hook measureText ở trên sẽ "chụp" lại context + font thật
                    // mà nó vừa dùng. (Có thể hiện sai 1 frame, không đáng kể.)
                    labelInstance.enableWrapText = true;
                    if ('_enableWrapText' in labelInstance) labelInstance._enableWrapText = true;
                    originalSet.call(labelInstance, translatedText);

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
                    const wrapped = wrapWithEngineMetrics(lastMeasureCtx, lastMeasureFont, translatedText, maxWidth);

                    labelInstance.enableWrapText = false;
                    if ('_enableWrapText' in labelInstance) labelInstance._enableWrapText = false;
                    originalSet.call(labelInstance, wrapped);

                    if (typeof labelInstance._updateRenderData === 'function') labelInstance._updateRenderData(true);
                    if (typeof labelInstance.setVertsDirty === 'function') labelInstance.setVertsDirty();
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
    async function translateSingleText(text) {
        if (!text || !text.trim()) return text;
        const cleanText = text.replace(/\\,/g, ',');
        if (translateCache.has(cleanText)) return translateCache.get(cleanText);

        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(cleanText)}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`[GT Error ${res.status}] "${cleanText}"`);
                return text;
            }
            const data = await res.json();
            if (data && data[0]) {
                const translated = data[0].map(seg => seg[0]).join('');
                const result = translated.replace(/,/g, '\\,');
                translateCache.set(cleanText, result);
                return result;
            }
        } catch (err) {
            console.error(`[Network Error] "${cleanText}":`, err);
        }
        return text;
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

        const tasks = lines.map(async (line) => {
            if (line.startsWith('msg,')) {
                const match = line.match(MSG_LINE_REGEX);
                if (!match || !match[2] || !match[2].trim()) return line;
                const [, prefix, content, suffix] = match;
                const translated = await translateSingleText(content);
                return `${prefix}${translated}${suffix}`;
            }

            if (line.startsWith('select,')) {
                return await processSelectLine(line);
            }

            return line; // các dòng lệnh khác (clickwait, name, ...) giữ nguyên
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