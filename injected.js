let is_translated = 1;
let customTranslationDict = {};

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
    return text.replace(/[^\s]+/g, TRANSLATED_MARKER + '$&' + TRANSLATED_MARKER);
}

/**
 * Fragment (đoạn Cocos cắt ra từ câu gốc khi tách 2-3 dòng) có marker
 * bên trong => coi như đã dịch, hook không dịch lại.
 */
function isFragmentTranslated(fragmentText) {
    return typeof fragmentText === 'string' && fragmentText.indexOf(TRANSLATED_MARKER) !== -1;
}

/** Bỏ hết marker trước khi hiển thị lên màn hình. */
function stripMarkers(fragmentText) {
    if (typeof fragmentText !== 'string') return fragmentText;
    return fragmentText.replace(TRANSLATED_MARKER_REGEX, '');
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

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GAME_DICT_UPDATE') {
        window.customTranslationDict = event.data.dict || {};
        
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
            if (!window.is_translated) return text;
            if (!text || !text.trim()) return text;
            const cleanText = text.trim();
            const seq = nextTranslationSeq();

            if (window.customTranslationDict && window.customTranslationDict[cleanText]) {
                const dictValue = extractTranslatedValue(window.customTranslationDict[cleanText]);
                if (dictValue) return dictValue;
            }

            if (translationCache.has(cleanText)) return translationCache.get(cleanText);

            try {
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(cleanText)}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP error ${res.status}`);
                const data = await res.json();
                let translated = data[0].map(item => item[0]).join('');

                translationCache.set(cleanText, translated);

                window.postMessage({
                    type: 'SAVE_NEW_TRANSLATION',
                    original: cleanText,
                    translated: translated,
                    seq
                }, '*');

                return translated;
            } catch (e) {
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

                if (isFragmentTranslated(val)) {
                    const cleanVal = stripMarkers(val);
                    originalSet.call(this, cleanVal);

                    if (debounceMap.has(this)) {
                        clearTimeout(debounceMap.get(this));
                    }
                    debounceMap.set(this, setTimeout(() => {
                        fixAndRewrap(labelInstance, cleanVal);
                    }, 150));
                    return;
                }

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

    async function translateSingleText(text, speakerName = null, fileName = null) {
        if (!text || !text.trim()) return text;
        const seq = nextTranslationSeq();
        const cleanText = text.replace(/\\,/g, ',');

        if (window.customTranslationDict && window.customTranslationDict[cleanText]) {
            const dictValue = extractTranslatedValue(window.customTranslationDict[cleanText]);
            if (dictValue) {
                const customResult = escapeUnescapedQuotes(dictValue).replace(/,/g, '\\,');
                return interleaveMarkers(customResult);
            }
        }

        if (translateCache.has(cleanText)) {
            const cached = translateCache.get(cleanText);
            return cached ? interleaveMarkers(cached) : text;
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

                window.postMessage({
                    type: 'SAVE_NEW_TRANSLATION',
                    original: cleanText,
                    translated: translated,
                    speaker: speakerName || undefined,
                    chap: fileName || undefined,
                    seq
                }, '*');

                return interleaveMarkers(result); 
            }
        } catch (err) {
            console.error(`[Network Error] "${cleanText}":`, err);
        }

        window.postMessage({
            type: 'SAVE_NEW_TRANSLATION',
            original: cleanText,
            translated: '',
            speaker: speakerName || undefined,
            chap: fileName || undefined,
            seq
        }, '*');

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

    async function processStoryScript(rawScript, fileName = null) {
        const lines = rawScript.split('\n');
        let currentSpeaker = null;

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
            if (st.fileName && hasDialogueContent(rawText)) {
                window.postMessage({ type: 'GAME_CHAP_OPENED', chap: st.fileName }, '*');
            }

            if (!window.is_translated) {
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