// Script này chạy ở Isolated Context nên CÓ QUYỀN dùng chrome.storage
window.addEventListener('message', (event) => {
    // Chỉ nhận message từ chính trang web hiện tại
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'CRAVE_SAGA_FETCHED_KEYS') {
        const keysList = event.data.keys;
        const autoClose = event.data.autoClose;

        chrome.storage.local.set({ fetchedApiKeys: keysList }, () => {
            console.log('[GetAPIKey Bridge] Đã nhận và lưu thành công', keysList.length, 'API Keys vào chrome.storage:', keysList);
            
            if (autoClose && keysList.length > 0) {
                console.log('[GetAPIKey Bridge] auto_close=1 phát hiện, tự động đóng tab...');
                window.close();
            }
        });
    }
});