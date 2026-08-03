(function () {
    window.is_translated = 1;

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'GAME_TRANSLATION_STATE_UPDATE') {
            window.is_translated = event.data.enabled ? 1 : 0;
        }
    });

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

        console.log("-> [AutoTranslate]: Hook Cocos2d successfully! (engine-metrics wrap enabled)");
    }

    initCocosHook();
})();