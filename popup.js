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

    // ==== Chap / File vừa chơi mới nhất + Remark ====
    const currentChapFileEl = document.getElementById('current-chap-file');
    const chapRemarkRow = document.getElementById('chap-remark-row');
    const chapEmptyMsg = document.getElementById('chap-empty-msg');
    const currentChapRemarkInput = document.getElementById('current-chap-remark');
    const btnChapSave = document.getElementById('btn-chap-save');

    let latestChap = null;

    function getEntryChap(entry) {
        if (entry && typeof entry === 'object') return entry.chap || '';
        return '';
    }

    function getEntryTime(entry) {
        if (entry && typeof entry === 'object' && typeof entry.time === 'number') return entry.time;
        return 0;
    }

    function getEntrySeq(entry) {
        if (entry && typeof entry === 'object' && typeof entry.seq === 'number') return entry.seq;
        return null;
    }

    function getSortableOrderValue(entry) {
        const seq = getEntrySeq(entry);
        if (seq !== null) return seq;
        return getEntryTime(entry) * 1000;
    }

    function findLatestChap(translationDict) {
        let bestChap = null;
        let bestOrder = -Infinity;

        Object.values(translationDict).forEach((entry) => {
            const chap = getEntryChap(entry);
            if (!chap) return;
            const order = getSortableOrderValue(entry);
            if (order >= bestOrder) {
                bestOrder = order;
                bestChap = chap;
            }
        });

        return bestChap;
    }

    function loadLatestChap() {
        chrome.storage.local.get(
            { translationDict: {}, chapRemarks: {}, currentChap: null },
            (result) => {
                const translationDict = result.translationDict || {};
                const chapRemarks = result.chapRemarks || {};

                // Ưu tiên currentChap: được cập nhật ngay khi game load 1 file chap,
                // nên phản ánh đúng chap đang mở kể cả khi mở lại chap cũ đã dịch xong.
                // Fallback về suy luận từ translationDict cho version cũ chưa có currentChap.
                latestChap = (result.currentChap && result.currentChap.chap)
                    ? result.currentChap.chap
                    : findLatestChap(translationDict);

                if (!latestChap) {
                    currentChapFileEl.textContent = '—';
                    chapRemarkRow.style.display = 'none';
                    chapEmptyMsg.style.display = 'block';
                    return;
                }

                chapEmptyMsg.style.display = 'none';
                chapRemarkRow.style.display = 'flex';
                currentChapFileEl.textContent = latestChap;
                currentChapFileEl.title = latestChap;
                currentChapRemarkInput.value = chapRemarks[latestChap] || '';
            }
        );
    }

    function saveLatestChapRemark() {
        if (!latestChap) return;

        chrome.storage.local.get({ chapRemarks: {} }, (result) => {
            const chapRemarks = result.chapRemarks || {};
            const remarkVal = currentChapRemarkInput.value.trim();

            if (remarkVal) {
                chapRemarks[latestChap] = remarkVal;
            } else {
                delete chapRemarks[latestChap];
            }

            chrome.storage.local.set({ chapRemarks }, () => {
                const originalText = btnChapSave.innerText;
                btnChapSave.innerText = '✓ Đã lưu';
                btnChapSave.classList.add('saved');
                setTimeout(() => {
                    btnChapSave.innerText = originalText;
                    btnChapSave.classList.remove('saved');
                }, 1200);
            });
        });
    }

    if (btnChapSave) {
        btnChapSave.addEventListener('click', saveLatestChapRemark);
    }
    if (currentChapRemarkInput) {
        currentChapRemarkInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveLatestChapRemark();
        });
    }

    loadLatestChap();

    // Cập nhật lại nếu dữ liệu translationDict/chapRemarks thay đổi trong khi popup đang mở
    // (ví dụ người dùng đang chơi game ở tab khác cùng lúc)
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && (changes.translationDict || changes.chapRemarks || changes.currentChap)) {
            loadLatestChap();
        }
    });
});

document.getElementById('btn-open-options')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

const qrImage = document.getElementById('donation-qr');
if (qrImage) {
  qrImage.src = chrome.runtime.getURL('images/donation-qr.png');
}