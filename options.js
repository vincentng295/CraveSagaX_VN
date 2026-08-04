document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('dict-table-body');
    const searchInput = document.getElementById('search-input');
    const chapFilterSelect = document.getElementById('chap-filter-select');
    const totalCountEl = document.getElementById('total-count');
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImport = document.getElementById('file-import');
    const btnClearAll = document.getElementById('btn-clear-all');

    let translationDict = {};
    let currentFilteredDict = {}; // Lưu giữ kết quả đã filter để Export JSON
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
        chrome.storage.local.get({ translationDict: {} }, async (result) => {
            translationDict = result.translationDict || {};

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

    // Cập nhật danh sách Chap trong Filter Dropdown
    function populateChapFilterOptions() {
        const selectedChap = chapFilterSelect.value;
        const chapSet = new Set();

        Object.values(translationDict).forEach(entry => {
            const chap = getEntryChap(entry);
            if (chap) chapSet.add(chap);
        });

        chapFilterSelect.innerHTML = '<option value="">Tất cả Chap/File</option>';
        Array.from(chapSet).sort().forEach(chap => {
            const opt = document.createElement('option');
            opt.value = chap;
            opt.textContent = chap;
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

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${chapName ? `<span class="chap-badge">${escapeHtml(chapName)}</span>` : '<span class="speaker-none">—</span>'}</td>
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
        chrome.storage.local.set({ translationDict });
    }

    // Export CHỈ xuất các item trong currentFilteredDict
    btnExport.addEventListener('click', () => {
        const filterChap = chapFilterSelect.value;
        const fileNameSuffix = filterChap ? `_${filterChap.replace('.txt', '')}` : '';
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentFilteredDict, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `CraveSagaX_Translation${fileNameSuffix}_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    });

    btnImportTrigger.addEventListener('click', () => fileImport.click());

    fileImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedDict = JSON.parse(event.target.result);
                if (typeof importedDict === 'object' && !Array.isArray(importedDict)) {
                    translationDict = { ...translationDict, ...importedDict };
                    migrateMissingTimes();
                    saveDictionary();
                    populateChapFilterOptions();
                    renderTable();
                    alert("Import từ điển thành công!");
                } else {
                    alert("File JSON không đúng định dạng Dictionary!");
                }
            } catch (err) {
                alert("Lỗi đọc file JSON!");
            }
        };
        reader.readAsText(file);
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