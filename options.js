document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('dict-table-body');
    const searchInput = document.getElementById('search-input');
    const totalCountEl = document.getElementById('total-count');
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImport = document.getElementById('file-import');
    const btnClearAll = document.getElementById('btn-clear-all');

    let translationDict = {};

    // Dict entry giờ hỗ trợ 2 dạng (tương thích ngược với dữ liệu cũ):
    //   - string: bản dịch thuần, không rõ nhân vật
    //   - object { translated, name }: bản dịch kèm tên nhân vật đã thoại câu đó
    function getEntryValue(entry) {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') return entry.translated || '';
        return '';
    }

    function getEntryName(entry) {
        if (entry && typeof entry === 'object') return entry.name || '';
        return '';
    }

    // Cập nhật bản dịch cho 1 key, GIỮ NGUYÊN tên nhân vật nếu entry đang có
    function updateEntryTranslation(key, newTranslated) {
        const entry = translationDict[key];
        if (entry && typeof entry === 'object') {
            translationDict[key] = { ...entry, translated: newTranslated };
        } else {
            translationDict[key] = newTranslated;
        }
    }

    // Load dữ liệu từ chrome.storage.local
    function loadDictionary() {
        chrome.storage.local.get({ translationDict: {} }, (result) => {
            translationDict = result.translationDict;
            renderTable();
        });
    }

    // Render bảng danh sách
    function renderTable(filter = '') {
        tableBody.innerHTML = '';
        const keys = Object.keys(translationDict);
        let count = 0;

        keys.forEach((key) => {
            const entry = translationDict[key];
            const value = getEntryValue(entry);
            const speakerName = getEntryName(entry);
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