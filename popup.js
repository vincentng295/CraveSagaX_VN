document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('translate-toggle');
    const statusText = document.getElementById('status-text');

    // Khôi phục trạng thái Toggle từ Storage
    chrome.storage.local.get({ translateEnabled: true }, (result) => {
        toggle.checked = result.translateEnabled;
        updateStatusText(result.translateEnabled);
    });

    // Lắng nghe thay đổi Toggle
    toggle.addEventListener('change', () => {
        const isEnabled = toggle.checked;
        updateStatusText(isEnabled);

        chrome.storage.local.set({ translateEnabled: isEnabled });

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'SET_TRANSLATION_STATE',
                    enabled: isEnabled
                });
            }
        });
    });

    function updateStatusText(enabled) {
        statusText.innerText = enabled ? 'Tự động dịch: ON' : 'Tự động dịch: OFF';
    }

    // Xử lý nút Copy thông tin Donation
    const setupCopy = (btnId, textId) => {
        const btn = document.getElementById(btnId);
        const text = document.getElementById(textId).innerText;

        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(text).then(() => {
                const originalText = btn.innerText;
                btn.innerText = 'OK!';
                setTimeout(() => {
                    btn.innerText = originalText;
                }, 1500);
            });
        });
    };

    setupCopy('btn-copy-stk', 'stk');
    setupCopy('btn-copy-memo', 'memo');
});

document.getElementById('btn-open-options')?.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage().catch(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
});