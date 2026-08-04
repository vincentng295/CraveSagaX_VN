chrome.runtime.onInstalled.addListener(async (details) => {
    // Chỉ nạp dữ liệu khi cài mới extension (install)
    if (details.reason === 'install') {
        try {
            const response = await fetch(chrome.runtime.getURL('pretranslated.json'));
            const pretranslatedDict = await response.json();

            chrome.storage.local.get({ translationDict: {} }, (result) => {
                // Ưu tiên bản dịch có sẵn trong pretranslated.json
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