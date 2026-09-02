const REMOTE_PRETRANSLATED_URL = 'https://raw.githubusercontent.com/vincentng295/CraveSagaX_VN/refs/heads/main/pretranslated.json';

async function loadPretranslatedDict() {
    // Ưu tiên fetch bản dịch mới nhất từ GitHub
    try {
        const response = await fetch(REMOTE_PRETRANSLATED_URL, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const dict = await response.json();
        console.log('Đã nạp pretranslated.json từ GitHub (remote).');
        return dict;
    } catch (error) {
        console.warn('Không thể nạp pretranslated.json từ GitHub, dùng bản local:', error);
        // Fallback: dùng file pretranslated.json đóng gói sẵn trong extension
        const response = await fetch(chrome.runtime.getURL('pretranslated.json'));
        const dict = await response.json();
        console.log('Đã nạp pretranslated.json từ local (fallback).');
        return dict;
    }
}

chrome.runtime.onInstalled.addListener(async (details) => {
    // Chỉ nạp dữ liệu khi cài mới extension (install)
    if (details.reason === 'install') {
        try {
            const pretranslatedDict = await loadPretranslatedDict();

            chrome.storage.local.get({ translationDict: {} }, (result) => {
                // Ưu tiên bản dịch có sẵn trong pretranslated.json (remote hoặc local),
                // giữ lại các bản dịch người dùng đã tự thêm trong translationDict
                const mergedDict = { ...pretranslatedDict, ...result.translationDict };
                chrome.storage.local.set({ translationDict: mergedDict }, () => {
                    console.log('Đã nạp thành công pretranslated.json lần đầu tiên!');
                });
            });
        } catch (error) {
            console.error('Lỗi khi nạp pretranslated.json:', error);
        }
    }
});

// ==== Quay canvas kèm âm thanh: quản lý offscreen document + relay lệnh ====
// Service worker MV3 không giữ được stream/MediaRecorder sống lâu (bị hủy khi
// idle), nên việc ghi hình thực sự diễn ra trong 1 offscreen document (xem
// offscreen.js). Ở đây chỉ lo tạo/dùng lại offscreen document và chuyển tiếp
// lệnh Start/Stop/Status từ popup sang đó.

const OFFSCREEN_URL = 'offscreen.html';
let creatingOffscreenPromise = null;

async function hasOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    return contexts.length > 0;
}

async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) return;

    if (creatingOffscreenPromise) {
        await creatingOffscreenPromise;
        return;
    }

    creatingOffscreenPromise = chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['USER_MEDIA'],
        justification: 'Ghi hình + âm thanh của tab game để xuất file .webm.'
    });

    try {
        await creatingOffscreenPromise;
    } finally {
        creatingOffscreenPromise = null;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !['RECORD_START', 'RECORD_STOP', 'RECORD_STATUS'].includes(message.type)) {
        return; // không phải message của tính năng quay hình, bỏ qua
    }

    (async () => {
        try {
            if (message.type === 'RECORD_STATUS') {
                // Nếu offscreen document chưa tồn tại thì chắc chắn chưa quay gì cả.
                if (!(await hasOffscreenDocument())) {
                    sendResponse({ recording: false, startTime: null });
                    return;
                }
            } else {
                await ensureOffscreenDocument();
            }

            chrome.runtime.sendMessage(
                { target: 'offscreen', type: message.type, streamId: message.streamId },
                (response) => sendResponse(response)
            );
        } catch (e) {
            sendResponse({ ok: false, error: e.message || String(e) });
        }
    })();

    return true; // sẽ trả lời bất đồng bộ
});