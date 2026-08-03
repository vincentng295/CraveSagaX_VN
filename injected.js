(function () {
    window.is_translated = 1;

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'GAME_TRANSLATION_STATE_UPDATE') {
            window.is_translated = event.data.enabled ? 1 : 0;
        }
    });

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

        // Cấu hình Native Auto-Wrap chuẩn của Cocos Creator
        function fixCocosWrapAndFont(label) {
            try {
                // 1. Chuyển sang System Font để hiển thị chuẩn tiếng Việt
                if ('useSystemFont' in label) label.useSystemFont = true;
                if ('_isSystemFontUsed' in label) label._isSystemFontUsed = true;
                if (label.font) label.font = null;
                if (label._N$file) label._N$file = null;
                if (label._font) label._font = null;

                label.fontFamily = "Arial, sans-serif";

                // 2. Bật chế độ WrapText tự động của Cocos Engine
                label.enableWrapText = true;
                if ('_enableWrapText' in label) label._enableWrapText = true;

                // 3. Đặt Overflow mode = RESIZE_HEIGHT (1) để tự dãn chiều cao theo dòng
                // 0: NONE, 1: RESIZE_HEIGHT, 2: CLAMP, 3: SHRINK
                if (cc.Label.Overflow) {
                    label.overflow = cc.Label.Overflow.RESIZE_HEIGHT;
                } else {
                    label.overflow = 1;
                }

                // 4. Mở rộng khung chứa nếu khung quá nhỏ (đảm bảo đủ chỗ chứa chữ tiếng Việt)
                if (label.node) {
                    // Nếu width quá hẹp (< 500px), set độ rộng hộp thoại lớn hơn
                    if (label.node.width < 500) {
                        label.node.width = 650; 
                    }
                }

                // Force Cập nhật render
                if (typeof label._updateRenderData === 'function') label._updateRenderData(true);
                if (typeof label.setVertsDirty === 'function') label.setVertsDirty();
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
                    
                    if (translatedText && window.is_translated) {
                        fixCocosWrapAndFont(labelInstance);
                        // Gán thẳng văn bản đã dịch, để Engine Cocos tự ngắt từ (word-wrap) theo width của Node
                        originalSet.call(labelInstance, translatedText);
                    }
                }, 150));
            },
            get: originalDescriptor.get,
            configurable: true
        });

        console.log("-> [AutoTranslate]: Hook Cocos2d successfully!");
    }

    initCocosHook();
})();