document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('dict-table-body');
    const searchInput = document.getElementById('search-input');
    const totalCountEl = document.getElementById('total-count');
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImport = document.getElementById('file-import');
    const btnClearAll = document.getElementById('btn-clear-all');

    let translationDict = {};
    let sortMode = 'time-desc'; // 'time-desc' | 'time-asc' | 'key-asc'

    // Dict entry giờ hỗ trợ 2 dạng (tương thích ngược với dữ liệu cũ):
    //   - string: bản dịch thuần, không rõ nhân vật, không có time
    //   - object { translated, name, time }: bản dịch kèm tên nhân vật + thời điểm
    //     thu thập (unix giây). "time" có thể vắng mặt ở dữ liệu cũ hơn.
    function getEntryValue(entry) {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') return entry.translated || '';
        return '';
    }

    function getEntryName(entry) {
        if (entry && typeof entry === 'object') return entry.name || '';
        return '';
    }

    function getEntryTime(entry) {
        if (entry && typeof entry === 'object' && typeof entry.time === 'number') return entry.time;
        return 0; // dữ liệu cũ chưa có time -> coi như cũ nhất, sẽ được ép time khi migrate
    }

    // "seq" là mốc thứ tự THẬT do injected.js chụp lại tại thời điểm câu thoại
    // được xử lý (đồng bộ, đúng thứ tự xuất hiện trong file kịch bản) — không
    // bị xáo trộn như "time" khi nhiều câu được dịch song song và các request
    // Google Translate trả lời không theo đúng thứ tự. Dữ liệu cũ (thu thập
    // trước khi có seq) sẽ không có trường này.
    function getEntrySeq(entry) {
        if (entry && typeof entry === 'object' && typeof entry.seq === 'number') return entry.seq;
        return null;
    }

    // Giá trị dùng để SO SÁNH khi sort theo thời gian: ưu tiên "seq" nếu có
    // (chính xác theo đúng thứ tự thoại); nếu không (dữ liệu cũ) thì mới rơi
    // về "time" (giây) — nhân 1000 để tạm quy về cùng đơn vị mili-giây với seq.
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

    // Cập nhật bản dịch cho 1 key, GIỮ NGUYÊN tên nhân vật + time nếu entry đang có
    function updateEntryTranslation(key, newTranslated) {
        const entry = translationDict[key];
        if (entry && typeof entry === 'object') {
            translationDict[key] = { ...entry, translated: newTranslated };
        } else {
            // entry dạng string cũ -> chuẩn hoá về object, ép time hiện tại luôn
            translationDict[key] = { translated: newTranslated, name: null, time: nowUnix() };
        }
    }

    function nowUnix() {
        return Math.floor(Date.now() / 1000);
    }

    // Chuẩn hoá 1 entry: nếu thiếu "time" -> ép thành unix hiện tại (và chuyển
    // entry dạng string cũ thành object để có chỗ chứa time). Trả về entry mới
    // và cờ cho biết có thay đổi hay không, để chỉ ghi lại storage khi cần.
    function ensureEntryTime(entry) {
        if (typeof entry === 'string') {
            return { changed: true, entry: { translated: entry, name: null, time: nowUnix() } };
        }
        if (entry && typeof entry === 'object') {
            if (typeof entry.time !== 'number') {
                return { changed: true, entry: { ...entry, time: nowUnix() } };
            }
            return { changed: false, entry };
        }
        return { changed: false, entry };
    }

    // Duyệt toàn bộ dict, ép "time" cho các entry còn thiếu. Trả về true nếu có
    // thay đổi (để gọi saveDictionary() sau khi migrate).
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

    // Load dữ liệu từ chrome.storage.local
    function loadDictionary() {
        chrome.storage.local.get({ translationDict: {} }, (result) => {
            translationDict = result.translationDict;
            const changed = migrateMissingTimes();
            if (changed) {
                saveDictionary(); // lưu lại ngay các time vừa được ép
            }
            renderTable();
        });
    }

    // Sắp xếp danh sách key theo sortMode hiện tại
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

    // Render bảng danh sách
    function renderTable(filter = '') {
        tableBody.innerHTML = '';
        const keys = sortKeys(Object.keys(translationDict));
        let count = 0;

        keys.forEach((key) => {
            const entry = translationDict[key];
            const value = getEntryValue(entry);
            const speakerName = getEntryName(entry);
            const entryTime = getEntryTime(entry);
            if (filter && !key.toLowerCase().includes(filter) && !value.toLowerCase().includes(filter) && !speakerName.toLowerCase().includes(filter)) {
                return;
            }

            count++;
            const tr = document.createElement('tr');

            tr.innerHTML = `
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

        totalCountEl.innerText = `Tổng số câu: ${count} / ${keys.length}`;

        // Lắng nghe sự kiện sửa input (tự động lưu khi rời khỏi ô nhập)
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

        // Lắng nghe sự kiện bấm nút "Lưu" — lưu ngay bản dịch hiện tại của dòng đó
        document.querySelectorAll('.btn-save').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.getAttribute('data-key');
                const row = e.target.closest('tr');
                const input = row.querySelector('.input-edit');
                const newVal = input.value.trim();
                if (!newVal) return;

                updateEntryTranslation(key, newVal);
                saveDictionary();

                // Phản hồi trực quan ngắn để người dùng biết đã lưu
                const originalLabel = e.target.innerText;
                e.target.innerText = '✓ Đã lưu';
                e.target.classList.add('saved');
                setTimeout(() => {
                    e.target.innerText = originalLabel;
                    e.target.classList.remove('saved');
                }, 1200);
            });
        });

        // Lắng nghe sự kiện xóa
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetKey = e.target.getAttribute('data-key');
                delete translationDict[targetKey];
                saveDictionary();
                renderTable(searchInput.value.trim().toLowerCase());
            });
        });
    }

    function saveDictionary() {
        chrome.storage.local.set({ translationDict }, () => {
            // Thông báo cập nhật thành công nếu cần
        });
    }

    // Export dữ liệu dạng JSON
    btnExport.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(translationDict, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `CraveSagaX_Translation_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    });

    // Import dữ liệu từ JSON
    btnImportTrigger.addEventListener('click', () => fileImport.click());

    fileImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedDict = JSON.parse(event.target.result);
                if (typeof importedDict === 'object' && !Array.isArray(importedDict)) {
                    // Merge dữ liệu mới vào dữ liệu cũ
                    translationDict = { ...translationDict, ...importedDict };
                    migrateMissingTimes(); // ép time cho entry import thiếu time
                    saveDictionary();
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

    // Tìm kiếm
    searchInput.addEventListener('input', (e) => {
        renderTable(e.target.value.trim().toLowerCase());
    });

    // Sắp xếp
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            sortMode = e.target.value;
            renderTable(searchInput.value.trim().toLowerCase());
        });
    }

    // Xóa tất cả
    btnClearAll.addEventListener('click', () => {
        if (confirm("Bạn có chắc chắn muốn xóa toàn bộ từ điển đã thu thập?")) {
            translationDict = {};
            saveDictionary();
            renderTable();
        }
    });

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    loadDictionary();
});