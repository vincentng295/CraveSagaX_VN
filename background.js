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