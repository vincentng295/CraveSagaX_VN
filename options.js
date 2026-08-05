document.addEventListener('DOMContentLoaded', () => {
    // ==== Dark Mode ====
    const btnThemeToggle = document.getElementById('btn-theme-toggle');

    function applyTheme(isDark) {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        if (btnThemeToggle) {
            btnThemeToggle.innerText = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
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

    const tableBody = document.getElementById('dict-table-body');
    const searchInput = document.getElementById('search-input');
    const chapFilterSelect = document.getElementById('chap-filter-select');
    const chapRemarkInput = document.getElementById('chap-remark-input');
    const totalCountEl = document.getElementById('total-count');
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImport = document.getElementById('file-import');
    const btnClearAll = document.getElementById('btn-clear-all');

    let translationDict = {};
    let chapRemarks = {}; // Lưu Mapping: { "md5name.txt": "Tên Chap Gợi Nhớ" }
    let currentFilteredDict = {};
    let sortMode = 'time-asc';

    function getEntryValue(entry) {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') return entry.translated || '';
        return '';
    }

    function getEntryName(entry) {
        if (entry && typeof entry === 'object') return entry.name || '';
        return '';
    }

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

    function formatTime(unixSeconds) {
        if (!unixSeconds) return '—';
        const d = new Date(unixSeconds * 1000);
        return d.toLocaleString('vi-VN');
    }

    function updateEntryTranslation(key, newTranslated) {
        const entry = translationDict[key];
        if (entry && typeof entry === 'object') {
            translationDict[key] = { ...entry, translated: newTranslated };
        } else {
            translationDict[key] = { translated: newTranslated, name: null, chap: null, time: nowUnix() };
        }
    }

    function nowUnix() {
        return Math.floor(Date.now() / 1000);
    }

    function ensureEntryTime(entry) {
        if (typeof entry === 'string') {
            return { changed: true, entry: { translated: entry, name: null, chap: null, time: nowUnix() } };
        }
        if (entry && typeof entry === 'object') {
            if (typeof entry.time !== 'number') {
                return { changed: true, entry: { ...entry, time: nowUnix() } };
            }
            return { changed: false, entry };
        }
        return { changed: false, entry };
    }

    function migrateMissingTimes() {
        let changed = false;
        Object.keys(translationDict).forEach((key) => {
            const result = ensureEntryTime(translationDict[key]);
            if (result.changed) {
                translationDict[key] = result.entry;
                changed = true;
            }
        });
        return changed;
    }

    async function loadDictionary() {
        // Nạp cả translationDict và chapRemarks
        chrome.storage.local.get({ translationDict: {}, chapRemarks: {} }, async (result) => {
            translationDict = result.translationDict || {};
            chapRemarks = result.chapRemarks || {};

            if (Object.keys(translationDict).length === 0) {
                try {
                    const response = await fetch(chrome.runtime.getURL('pretranslated.json'));
                    translationDict = await response.json();
                    saveDictionary();
                } catch (err) {
                    console.warn("Không tìm thấy pretranslated.json", err);
                }
            }

            const changed = migrateMissingTimes();
            if (changed) {
                saveDictionary();
            }
            populateChapFilterOptions();
            renderTable();
        });
    }

    // Cập nhật danh sách Chap trong Filter Dropdown kèm Remark  
    function populateChapFilterOptions() {
        const selectedChap = chapFilterSelect.value;
        const chapSet = new Set();

        Object.values(translationDict).forEach(entry => {
            const chap = getEntryChap(entry);
            if (chap) chapSet.add(chap);
        });

        const chaps = Array.from(chapSet);

        // Sắp xếp: Ưu tiên có Remark trước (A-Z), không có Remark đứng sau (A-Z theo tên file)
        chaps.sort((a, b) => {
            const remarkA = chapRemarks[a] ? chapRemarks[a].trim() : '';
            const remarkB = chapRemarks[b] ? chapRemarks[b].trim() : '';

            if (remarkA && remarkB) {
                // Cả 2 đều có Remark -> so sánh theo Remark A-Z (hỗ trợ tiếng Việt)
                return remarkA.localeCompare(remarkB, 'vi', { sensitivity: 'base', numeric: true });
            } else if (remarkA) {
                // Chỉ A có Remark -> A đứng trước
                return -1;
            } else if (remarkB) {
                // Chỉ B có Remark -> B đứng trước
                return 1;
            } else {
                // Cả 2 đều không có Remark -> so sánh theo tên file gốc A-Z
                return a.localeCompare(b, 'vi', { sensitivity: 'base', numeric: true });
            }
        });

        chapFilterSelect.innerHTML = '<option value="">Tất cả Chap/File</option>';
        chaps.forEach(chap => {
            const opt = document.createElement('option');
            opt.value = chap;
            
            // Ưu tiên sử dụng Remark để hiển thị trong Select Option
            const displayName = chapRemarks[chap] ? `${chapRemarks[chap]} (${chap})` : chap;
            opt.textContent = displayName;

            if (chap === selectedChap) opt.selected = true;
            chapFilterSelect.appendChild(opt);
        });
    }

    function sortKeys(keys) {
        const sorted = [...keys];
        if (sortMode === 'time-desc') {
            sorted.sort((a, b) => getSortableOrderValue(translationDict[b]) - getSortableOrderValue(translationDict[a]));
        } else if (sortMode === 'time-asc') {
            sorted.sort((a, b) => getSortableOrderValue(translationDict[a]) - getSortableOrderValue(translationDict[b]));
        } else if (sortMode === 'key-asc') {
            sorted.sort((a, b) => a.localeCompare(b));
        }
        return sorted;
    }

    function renderTable() {
        const filterText = searchInput.value.trim().toLowerCase();
        const filterChap = chapFilterSelect.value;

        // Xử lý ẩn/hiện và nạp giá trị cho Ô Remark khi chọn 1 Chap cụ thể
        if (filterChap) {
            chapRemarkInput.style.display = 'inline-block';
            chapRemarkInput.value = chapRemarks[filterChap] || '';
        } else {
            chapRemarkInput.style.display = 'none';
            chapRemarkInput.value = '';
        }

        tableBody.innerHTML = '';
        const keys = sortKeys(Object.keys(translationDict));
        let count = 0;
        currentFilteredDict = {}; // Xóa và cấp lại danh sách lọc

        keys.forEach((key) => {
            const entry = translationDict[key];
            const value = getEntryValue(entry);
            const speakerName = getEntryName(entry);
            const chapName = getEntryChap(entry);
            const entryTime = getEntryTime(entry);

            // Điều kiện lọc
            if (filterChap && chapName !== filterChap) return;
            if (filterText && !key.toLowerCase().includes(filterText) && !value.toLowerCase().includes(filterText) && !speakerName.toLowerCase().includes(filterText)) {
                return;
            }

            // Lưu câu hợp lệ vào filtered object
            currentFilteredDict[key] = entry;
            count++;

            // Ưu tiên hiển thị Remark nếu có ở cột Chap/File
            const displayChapBadge = chapName 
                ? `<span class="chap-badge" title="${escapeHtml(chapName)}">${escapeHtml(chapRemarks[chapName] || chapName)}</span>` 
                : '<span class="speaker-none">—</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${displayChapBadge}</td>
                <td>${speakerName ? `<span class="speaker-badge">${escapeHtml(speakerName)}</span>` : '<span class="speaker-none">—</span>'}</td>
                <td><strong>${escapeHtml(key)}</strong></td>
                <td>
                    <input type="text" class="input-edit" data-key="${escapeHtml(key)}" value="${escapeHtml(value)}">
                </td>
                <td><span class="time-cell">${escapeHtml(formatTime(entryTime))}</span></td>
                <td>
                    <div class="actions">
                        <button class="btn btn-primary btn-save" data-key="${escapeHtml(key)}">Lưu</button>
                        <button class="btn btn-danger btn-delete" data-key="${escapeHtml(key)}">Xóa</button>
                    </div>
                </td>
            `;

            tableBody.appendChild(tr);
        });

        totalCountEl.innerText = `Hiển thị: ${count} / ${keys.length} câu`;

        document.querySelectorAll('.input-edit').forEach(input => {
            input.addEventListener('change', (e) => {
                const origKey = e.target.getAttribute('data-key');
                const newVal = e.target.value.trim();
                if (newVal) {
                    updateEntryTranslation(origKey, newVal);
                    saveDictionary();
                }
            });
        });

        document.querySelectorAll('.btn-save').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.getAttribute('data-key');
                const row = e.target.closest('tr');
                const input = row.querySelector('.input-edit');
                const newVal = input.value.trim();
                if (!newVal) return;

                updateEntryTranslation(key, newVal);
                saveDictionary();

                const originalLabel = e.target.innerText;
                e.target.innerText = '✓ Đã lưu';
                e.target.classList.add('saved');
                setTimeout(() => {
                    e.target.innerText = originalLabel;
                    e.target.classList.remove('saved');
                }, 1200);
            });
        });

        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetKey = e.target.getAttribute('data-key');
                delete translationDict[targetKey];
                saveDictionary();
                populateChapFilterOptions();
                renderTable();
            });
        });
    }

    function saveDictionary() {
        chrome.storage.local.set({ translationDict, chapRemarks });
    }

    // Lắng nghe sự kiện lưu Remark khi nhập vào ô Chap Remark Input
    chapRemarkInput.addEventListener('change', (e) => {
        const filterChap = chapFilterSelect.value;
        if (!filterChap) return;

        const remarkVal = e.target.value.trim();
        if (remarkVal) {
            chapRemarks[filterChap] = remarkVal;
        } else {
            delete chapRemarks[filterChap];
        }
        
        saveDictionary();
        populateChapFilterOptions(); // Cập nhật lại dropdown danh sách Chap
        renderTable(); // Cập nhật lại bảng để hiển thị badge mới
    });

    // Export JSON sẽ tự động lấy Remark (nếu có) để làm tên file xuất ra
    btnExport.addEventListener('click', () => {
        const filterChap = chapFilterSelect.value;
        let fileNameSuffix = '';
        if (filterChap) {
            const remarkName = chapRemarks[filterChap] ? chapRemarks[filterChap].replace(/\s+/g, '_') : filterChap.replace('.txt', '');
            fileNameSuffix = `_${remarkName}`;
        }

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentFilteredDict, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `CraveSagaX_Translation${fileNameSuffix}_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    });

    btnImportTrigger.addEventListener('click', () => fileImport.click());

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    function getFileBaseName(fileName) {
        return fileName.replace(/\.json$/i, '');
    }

    fileImport.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        let successCount = 0;
        let failCount = 0;
        const failedNames = [];

        for (const file of files) {
            try {
                const text = await readFileAsText(file);
                const importedDict = JSON.parse(text);
                if (typeof importedDict === 'object' && importedDict !== null && !Array.isArray(importedDict)) {
                    // Thu thập các Chap/File xuất hiện trong file JSON đang import
                    const chapsInFile = new Set();
                    Object.values(importedDict).forEach((entry) => {
                        const chap = getEntryChap(entry);
                        if (chap) chapsInFile.add(chap);
                    });

                    translationDict = { ...translationDict, ...importedDict };

                    // Tự động đặt Remark theo tên file JSON đã import (chỉ khi Chap đó chưa có Remark)
                    const baseName = getFileBaseName(file.name);
                    chapsInFile.forEach((chap) => {
                        if (!chapRemarks[chap]) {
                            chapRemarks[chap] = baseName;
                        }
                    });

                    successCount++;
                } else {
                    failCount++;
                    failedNames.push(file.name);
                }
            } catch (err) {
                failCount++;
                failedNames.push(file.name);
            }
        }

        if (successCount > 0) {
            migrateMissingTimes();
            saveDictionary();
            populateChapFilterOptions();
            renderTable();
        }

        // Reset input để có thể chọn lại cùng 1 file lần sau nếu cần
        fileImport.value = '';

        let msg = `Đã import thành công ${successCount}/${files.length} file.`;
        if (failCount > 0) {
            msg += `\nCác file lỗi/không đúng định dạng: ${failedNames.join(', ')}`;
        }
        alert(msg);
    });

    searchInput.addEventListener('input', () => renderTable());
    chapFilterSelect.addEventListener('change', () => renderTable());

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            sortMode = e.target.value;
            renderTable();
        });
    }

    btnClearAll.addEventListener('click', () => {
        if (confirm("Bạn có chắc chắn muốn xóa toàn bộ từ điển đã thu thập?")) {
            translationDict = {};
            chapRemarks = {};
            saveDictionary();
            populateChapFilterOptions();
            renderTable();
        }
    });

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    loadDictionary();
});