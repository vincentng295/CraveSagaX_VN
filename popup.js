document.addEventListener('DOMContentLoaded', () => {
    // ==== Dark Mode ====
    const btnThemeToggle = document.getElementById('btn-theme-toggle');

    function applyTheme(isDark) {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        if (btnThemeToggle) {
            btnThemeToggle.innerText = isDark ? '☀️' : '🌙';
        }
    }

    chrome.storage.local.get({ darkMode: false }, (result) => {
        applyTheme(result.darkMode);
    });

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const newIsDark = !isDark;
            applyTheme(newIsDark);
            chrome.storage.local.set({ darkMode: newIsDark });
        });
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.darkMode) {
            applyTheme(changes.darkMode.newValue);
        }
    });

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
    const btnExportDoc = document.getElementById('btn-export-doc');

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
                    if (btnExportDoc) btnExportDoc.style.display = 'none';
                    chapEmptyMsg.style.display = 'block';
                    return;
                }

                chapEmptyMsg.style.display = 'none';
                chapRemarkRow.style.display = 'flex';
                currentChapFileEl.textContent = latestChap;
                currentChapFileEl.title = latestChap;
                currentChapRemarkInput.value = chapRemarks[latestChap] || '';
                if (btnExportDoc) btnExportDoc.style.display = 'block';
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

// ==== Đồng bộ bản dịch mới từ GitHub (remote pretranslated.json) ====
const REMOTE_PRETRANSLATED_URL = 'https://raw.githubusercontent.com/vincentng295/CraveSagaX_VN/refs/heads/main/pretranslated.json';

function getEntryValueForSync(entry) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') return entry.translated || '';
    return '';
}

document.getElementById('btn-sync-remote')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const labelSpan = btn.querySelector('span');
    const originalText = labelSpan.innerText;
    btn.disabled = true;
    labelSpan.innerText = '⏳ Đang đồng bộ...';

    try {
        const response = await fetch(REMOTE_PRETRANSLATED_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const remoteDict = await response.json();

        if (typeof remoteDict !== 'object' || remoteDict === null || Array.isArray(remoteDict)) {
            throw new Error('Dữ liệu remote không hợp lệ');
        }

        chrome.storage.local.get({ translationDict: {} }, (result) => {
            const translationDict = result.translationDict || {};
            let addedCount = 0;
            let updatedCount = 0;

            Object.keys(remoteDict).forEach((key) => {
                const remoteEntry = remoteDict[key];
                const remoteTranslated = getEntryValueForSync(remoteEntry);
                const existingEntry = translationDict[key];

                if (!existingEntry) {
                    translationDict[key] = (typeof remoteEntry === 'object' && remoteEntry !== null)
                        ? { time: Math.floor(Date.now() / 1000), ...remoteEntry }
                        : { translated: remoteTranslated, name: null, chap: null, time: Math.floor(Date.now() / 1000) };
                    addedCount++;
                    return;
                }

                const existingTranslated = getEntryValueForSync(existingEntry);
                if ((!existingTranslated || !existingTranslated.trim()) && remoteTranslated && remoteTranslated.trim()) {
                    if (typeof existingEntry === 'string') {
                        translationDict[key] = { translated: remoteTranslated, name: null, chap: null, time: Math.floor(Date.now() / 1000) };
                    } else {
                        translationDict[key] = { ...existingEntry, translated: remoteTranslated };
                    }
                    updatedCount++;
                }
            });

            chrome.storage.local.set({ translationDict }, () => {
                labelSpan.innerText = '✓ Đã đồng bộ';
                alert(`Đồng bộ thành công!\nThêm mới: ${addedCount} câu\nBổ sung bản dịch còn thiếu: ${updatedCount} câu`);
                setTimeout(() => {
                    labelSpan.innerText = originalText;
                    btn.disabled = false;
                }, 1500);
            });
        });
    } catch (err) {
        console.error('Lỗi khi đồng bộ pretranslated.json:', err);
        labelSpan.innerText = '✗ Lỗi';
        alert('Đồng bộ thất bại. Vui lòng kiểm tra kết nối mạng và thử lại.');
        setTimeout(() => {
            labelSpan.innerText = originalText;
            btn.disabled = false;
        }, 1500);
    }
});

const qrImage = document.getElementById('donation-qr');
if (qrImage) {
  qrImage.src = chrome.runtime.getURL('images/donation-qr.png');
}

document.getElementById('btn-get-api-key').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://aistudio.google.com/app/api-keys?auto_close=1' });
});

// ==== Export hội thoại của chap đang chơi ra .doc (EN + VI nếu đã dịch) ====
// Dựa vào storyFileCache (toàn văn .txt gốc/đã dịch, cache đúng thứ tự dòng khi
// injected.js chặn XHR), KHÔNG dùng translationDict vì dict lưu theo câu rời rạc,
// không giữ thứ tự và có thể thiếu câu (câu trùng đã được ghi nhận ở 1 chap khác).

const FEFF_REGEX_EXPORT = /\uFEFF/g;
const MSG_LINE_REGEX_EXPORT = /^(msg,\d+,\s*(?:<size=\d+>)?)((?:\\,|[^<,])*)((?:<\/size>)?,.*)$/;

function splitUnescapedCommaExport(str) {
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

function cleanDisplayTextExport(text) {
    return (text || '')
        .replace(FEFF_REGEX_EXPORT, '')   // bỏ marker "đã dịch" (zero-width)
        .replace(/\\,/g, ',')             // un-escape dấu phẩy
        .trim();
}

function extractSpeakerNameExport(line) {
    const fields = splitUnescapedCommaExport(line);
    const raw = (fields[1] || '').replace(/<[^>]*>/g, '');
    return cleanDisplayTextExport(raw) || null;
}

// Parse toàn văn 1 file .txt kịch bản game thành danh sách thoại theo đúng thứ tự.
function parseStoryScriptForExport(rawText) {
    if (!rawText) return [];
    const lines = rawText.split('\n');
    let currentSpeaker = null;
    const entries = [];

    lines.forEach((rawLine) => {
        const line = rawLine.replace(/\r$/, '');
        if (line.startsWith('name,')) {
            currentSpeaker = extractSpeakerNameExport(line);
            return;
        }
        if (line.startsWith('msg,')) {
            const match = line.match(MSG_LINE_REGEX_EXPORT);
            if (!match || !match[2] || !match[2].trim()) return;
            const text = cleanDisplayTextExport(match[2]);
            if (text) entries.push({ speaker: currentSpeaker, text });
            return;
        }
        if (line.startsWith('select,')) {
            const fields = splitUnescapedCommaExport(line);
            const options = fields.slice(1).map(cleanDisplayTextExport).filter(Boolean);
            if (options.length) {
                entries.push({ speaker: null, text: `[Lựa chọn] ${options.join('  /  ')}` });
            }
        }
    });

    return entries;
}

function escapeHtmlExport(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Sinh file .doc (Word đọc được) từ danh sách dòng thoại dạng "Tên: nội dung".
function buildWordDocBlob(title, dialogueLines) {
    const bodyHtml = dialogueLines
        .map((line) => `<p style="margin:0 0 8px 0; font-family:Calibri, Arial, sans-serif; font-size:12pt;">${escapeHtmlExport(line)}</p>`)
        .join('\n');

    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtmlExport(title)}</title></head>
<body>
<h2 style="font-family:Calibri, Arial, sans-serif;">${escapeHtmlExport(title)}</h2>
${bodyHtml}
</body>
</html>`;

    return new Blob(['\ufeff', html], { type: 'application/msword' });
}

function downloadBlobExport(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

document.getElementById('btn-export-doc')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const originalLabel = btn.innerText;

    chrome.storage.local.get({ storyFileCache: {}, currentChap: null, chapRemarks: {} }, (result) => {
        const currentChap = result.currentChap && result.currentChap.chap;
        if (!currentChap) {
            alert('Không xác định được chap đang chơi.');
            return;
        }

        const cache = result.storyFileCache || {};
        const entry = cache[currentChap];

        if (!entry || !entry.original) {
            alert('Chưa có dữ liệu gốc của chap này trong cache.\nHãy mở lại chap đó trong game rồi thử xuất lại.');
            return;
        }

        const remark = (result.chapRemarks || {})[currentChap];
        const baseName = (remark || currentChap.replace(/\.txt$/i, '')).replace(/[\\/:*?"<>|]/g, '_');

        const enEntries = parseStoryScriptForExport(entry.original);
        if (enEntries.length === 0) {
            alert('Không tìm thấy hội thoại nào trong chap này.');
            return;
        }
        const enLines = enEntries.map((it) => (it.speaker ? `${it.speaker}: ${it.text}` : it.text));
        downloadBlobExport(buildWordDocBlob(`${currentChap} (English)`, enLines), `${baseName}_EN.doc`);

        if (entry.translated) {
            const viEntries = parseStoryScriptForExport(entry.translated);
            const viLines = viEntries.map((it) => (it.speaker ? `${it.speaker}: ${it.text}` : it.text));
            downloadBlobExport(buildWordDocBlob(`${currentChap} (Tiếng Việt)`, viLines), `${baseName}_VI.doc`);
        }

        btn.innerText = '✓ Đã xuất file';
        setTimeout(() => { btn.innerText = originalLabel; }, 1500);
    });
});

const fastcacheToggle = document.getElementById('fastcache-toggle');
if (fastcacheToggle) {
    chrome.storage.local.get({ fastCacheEnabled: true }, (result) => {
        fastcacheToggle.checked = result.fastCacheEnabled;
    });
    fastcacheToggle.addEventListener('change', () => {
        chrome.storage.local.set({ fastCacheEnabled: fastcacheToggle.checked });
    });
}

document.getElementById('btn-clear-fastcache')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_FAST_CACHE' });
    });
});