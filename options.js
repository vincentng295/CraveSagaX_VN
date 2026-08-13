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
    const btnSearch = document.getElementById('btn-search');
    const chapFilterSelect = document.getElementById('chap-filter-select');
    const chapRemarkInput = document.getElementById('chap-remark-input');
    const totalCountEl = document.getElementById('total-count');
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImport = document.getElementById('file-import');
    const btnClearAll = document.getElementById('btn-clear-all');
    const btnSyncRemote = document.getElementById('btn-sync-remote');
    const loadMoreSentinel = document.getElementById('load-more-sentinel');
    const btnRetranslateGemma = document.getElementById('btn-retranslate-gemma');
    const gemmaRetranslateStatus = document.getElementById('gemma-retranslate-status');

    const REMOTE_PRETRANSLATED_URL = 'https://raw.githubusercontent.com/vincentng295/CraveSagaX_VN/refs/heads/main/pretranslated.json';

    // ==== Dịch lại bằng Gemma (theo Chap đang filter) ====
    // Options page chạy trong extension context (không phải MAIN world như injected.js)
    // nên được hưởng CORS bypass từ host_permissions -> gọi fetch() trực tiếp tới
    // generativelanguage.googleapis.com, không cần relay qua content.js.
    const GEMINI_MODEL_ID = 'gemma-4-31b-it';
    const GEMMA_RETRANSLATE_CHUNK_SIZE = 200;
    const GEMINI_SYSTEM_INSTRUCTION = "Bạn là AI chuyên chỉnh sửa bản dịch game **Crave Saga** (có nội dung NSFW).\n" +
        "Crave Saga X là tựa game nhập vai chiến thuật theo lượt (turn-based) dành cho người lớn (BL/yaoi), lấy bối cảnh tại Vesteria — một thế giới song song giả tưởng nơi chỉ có nam giới sinh sống, chịu sự chi phối giữa các thiên thần và ác quỷ. Người chơi vào vai \"Master\" thực hiện hành trình cứu thế giới. Vesteria là một thế giới song song độc nhất chỉ có các chàng trai thuộc nhiều chủng tộc khác nhau sinh sống. Nơi đây chịu sự kiểm soát của phe thiên thần (muốn dẫn dắt nhân loại đến utopia) và phe ác quỷ (thỏa mãn tham vọng và sự đồi trụy). Nhân vật chính được tái sinh tại Vesteria bởi Thần Sáng tạo và Vua Thần nguyên thủy Arche để bắt đầu hành trình phiêu lưu và cứu rỗi.\n" +
        "Vesteria không có phụ nữ, chỉ có đàn ông.\n\n" +
        "Nhiệm vụ của bạn:\n" +
        "Nhận vào một mảng JSON các object {\"original\": \"...\", \"name\": \"...\"} — trong đó \"original\" là câu thoại tiếng Anh cần dịch, \"name\" là tên nhân vật đang nói câu đó (có thể null/rỗng nếu là dòng lựa chọn hoặc không xác định). " +
        "Hãy DÙNG \"name\" để hiểu khẩu khí, giới tính, vai vế của nhân vật đó (đây là game BL toàn nam giới) rồi dịch \"original\" sang tiếng Việt tự nhiên, mượt mà, đúng ngữ cảnh game hơn.\n\n" +
        "### Quy tắc bắt buộc\n" +
        "- Ưu tiên tự nhiên, dễ đọc như người Việt viết, không máy móc.\n" +
        "- Giữ đúng ý nghĩa gốc, không thêm bớt thông tin.\n" +
        "- Với tên riêng, thuật ngữ game thì giữ nguyên hoặc dịch theo chuẩn game: Master → Master, Soulmate → Soulmate, Sacred → Sacred, Raid → Raid, Player Rank → Hạng người chơi / Rank, Login → Đăng nhập.\n" +
        "- Các câu nhiệm vụ / thành tựu nên ngắn gọn, có cảm giác \"quest game\".\n" +
        "- Các câu thoại thì giữ khẩu khí riêng của từng nhân vật (thân mật, thô, lịch sự…) dựa theo \"name\" đi kèm.\n\n" +
        "### Phong cách\n" +
        "- Tránh dịch word-by-word.\n" +
        "- Tránh câu quá cứng hoặc quá \"Google dịch\".\n" +
        "- Ưu tiên ngắn gọn, rõ ràng, tự nhiên.\n\n" +
        "### Định dạng output\n" +
        "Trả về ĐÚNG một JSON object dạng {\"response\": [{\"original\": \"...\", \"translated\": \"...\"}, ...]}, giữ nguyên từng \"original\" y hệt input (không đổi \"name\" ra output), điền \"translated\", không giải thích, không thêm text nào khác ngoài JSON.";

    let translationDict = {};
    let chapRemarks = {}; // Lưu Mapping: { "md5name.txt": "Tên Chap Gợi Nhớ" }
    let currentFilteredDict = {};
    let sortMode = 'time-asc';

    // ==== Lazy load (phân trang khi cuộn) ====
    const PAGE_SIZE = 100;
    let appliedFilterText = ''; // Chỉ áp dụng khi bấm nút Tìm / Enter, không lọc live theo từng ký tự gõ
    let filteredKeys = [];
    let renderedCount = 0;

    const lazyLoadObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting && renderedCount < filteredKeys.length) {
                renderNextBatch();
            }
        });
    }, { root: null, rootMargin: '200px', threshold: 0 });

    if (loadMoreSentinel) {
        lazyLoadObserver.observe(loadMoreSentinel);
    }

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

    function buildRowHtml(key, entry) {
        const value = getEntryValue(entry);
        const speakerName = getEntryName(entry);
        const chapName = getEntryChap(entry);
        const entryTime = getEntryTime(entry);

        // Ưu tiên hiển thị Remark nếu có ở cột Chap/File
        const displayChapBadge = chapName
            ? `<span class="chap-badge" title="${escapeHtml(chapName)}">${escapeHtml(chapRemarks[chapName] || chapName)}</span>`
            : '<span class="speaker-none">—</span>';

        return `
            <td>${displayChapBadge}</td>
            <td>${speakerName ? `<span class="speaker-badge">${escapeHtml(speakerName)}</span>` : '<span class="speaker-none">—</span>'}</td>
            <td><strong>${escapeHtml(key)}</strong></td>
            <td class="cell-textarea">
                <textarea class="input-edit" data-key="${escapeHtml(key)}" rows="1">${escapeHtml(value)}</textarea>
            </td>
            <td><span class="time-cell">${escapeHtml(formatTime(entryTime))}</span></td>
            <td>
                <div class="actions">
                    <button class="btn btn-primary btn-save" data-key="${escapeHtml(key)}">Lưu</button>
                    <button class="btn btn-danger btn-delete" data-key="${escapeHtml(key)}">Xóa</button>
                </div>
            </td>
        `;
    }

    // Chỉ render thêm 1 "trang" (PAGE_SIZE dòng) tiếp theo vào bảng, thay vì render toàn bộ.
    // Được gọi lần đầu bởi renderTable(), sau đó tự động gọi tiếp khi người dùng cuộn tới sentinel.
    function renderNextBatch() {
        const nextKeys = filteredKeys.slice(renderedCount, renderedCount + PAGE_SIZE);
        const fragment = document.createDocumentFragment();

        nextKeys.forEach((key) => {
            const entry = translationDict[key];
            const tr = document.createElement('tr');
            tr.innerHTML = buildRowHtml(key, entry);
            fragment.appendChild(tr);
        });

        tableBody.appendChild(fragment);
        renderedCount += nextKeys.length;

        totalCountEl.innerText = `Hiển thị: ${renderedCount} / ${filteredKeys.length} câu`;

        if (loadMoreSentinel) {
            loadMoreSentinel.style.display = renderedCount < filteredKeys.length ? 'block' : 'none';
        }
    }

    // Tính lại danh sách key thỏa điều kiện lọc, reset phân trang và render trang đầu tiên.
    function renderTable() {
        const filterChap = chapFilterSelect.value;

        // Xử lý ẩn/hiện và nạp giá trị cho Ô Remark khi chọn 1 Chap cụ thể
        if (filterChap) {
            chapRemarkInput.style.display = 'inline-block';
            chapRemarkInput.value = chapRemarks[filterChap] || '';
            if (btnRetranslateGemma) btnRetranslateGemma.style.display = '';
        } else {
            chapRemarkInput.style.display = 'none';
            chapRemarkInput.value = '';
            if (btnRetranslateGemma) btnRetranslateGemma.style.display = 'none';
        }

        const keys = sortKeys(Object.keys(translationDict));
        currentFilteredDict = {}; // Xóa và cấp lại danh sách lọc (dùng cho Export)

        filteredKeys = keys.filter((key) => {
            const entry = translationDict[key];
            const value = getEntryValue(entry);
            const speakerName = getEntryName(entry);
            const chapName = getEntryChap(entry);

            if (filterChap && chapName !== filterChap) return false;
            if (appliedFilterText
                && !key.toLowerCase().includes(appliedFilterText)
                && !value.toLowerCase().includes(appliedFilterText)
                && !speakerName.toLowerCase().includes(appliedFilterText)) {
                return false;
            }

            currentFilteredDict[key] = entry;
            return true;
        });

        tableBody.innerHTML = '';
        renderedCount = 0;
        renderNextBatch();
    }

    // Áp dụng ô tìm kiếm: chỉ lọc khi bấm nút Tìm hoặc nhấn Enter, không lọc live theo từng ký tự gõ.
    function applySearchFilter() {
        appliedFilterText = searchInput.value.trim().toLowerCase();
        renderTable();
    }

    // Event delegation cho các thao tác trong bảng (sửa/lưu/xóa) — gắn 1 lần duy nhất,
    // hoạt động với mọi dòng kể cả những dòng được lazy-load thêm sau này.
    tableBody.addEventListener('change', (e) => {
        const input = e.target.closest('.input-edit');
        if (!input) return;
        const origKey = input.getAttribute('data-key');
        const newVal = input.value.trim();
        if (newVal) {
            updateEntryTranslation(origKey, newVal);
            saveDictionary();
        }
    });

    tableBody.addEventListener('click', (e) => {
        const saveBtn = e.target.closest('.btn-save');
        if (saveBtn) {
            const key = saveBtn.getAttribute('data-key');
            const row = saveBtn.closest('tr');
            const input = row.querySelector('.input-edit');
            const newVal = input.value.trim();
            if (!newVal) return;

            updateEntryTranslation(key, newVal);
            saveDictionary();

            const originalLabel = saveBtn.innerText;
            saveBtn.innerText = '✓ Đã lưu';
            saveBtn.classList.add('saved');
            setTimeout(() => {
                saveBtn.innerText = originalLabel;
                saveBtn.classList.remove('saved');
            }, 1200);
            return;
        }

        const deleteBtn = e.target.closest('.btn-delete');
        if (deleteBtn) {
            const targetKey = deleteBtn.getAttribute('data-key');
            delete translationDict[targetKey];
            saveDictionary();
            populateChapFilterOptions();
            renderTable();
        }
    });

    function saveDictionary() {
        chrome.storage.local.set({ translationDict, chapRemarks });
    }

    function chunkArray(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }

    // Số câu thoại tối đa mỗi lượt (turn) gửi lên Gemma trong 1 "phiên" dịch. Thay vì
    // nhồi cả lô (vd. 200 câu) vào 1 request duy nhất, ta tách thành từng lô nhỏ 40
    // câu và gửi nối tiếp dưới dạng nhiều turn trong CÙNG một conversation (turn sau
    // kèm theo toàn bộ turn trước làm lịch sử) — giảm độ trễ/khả năng timeout của 1
    // request quá lớn, đồng thời model vẫn giữ ngữ cảnh xuyên suốt nhờ thấy lại các
    // cặp user/model của những lô trước. Gemma hỗ trợ tới ~256k token nên hầu như
    // không có nguy cơ vượt giới hạn context dù nối nhiều lượt.
    const GEMMA_DIALOG_CHUNK_SIZE = 100;

    function buildDialogChunks(items, size) {
        const chunks = [];
        for (let i = 0; i < items.length; i += size) {
            chunks.push(items.slice(i, i + size));
        }
        return chunks;
    }

    // Gửi 1 turn (kèm nguyên lịch sử "contents" trước đó) tới Gemma qua
    // streamGenerateContent (SSE) và trả về rawText đã gộp từ các chunk stream.
    // Dùng SSE thay vì generateContent thường: generateContent giữ kết nối im lặng
    // tới khi có response hoàn chỉnh, dễ bị coi là treo và tự huỷ ("Failed to
    // fetch"), trong khi streamGenerateContent trả dữ liệu ngay khi có chunk đầu
    // tiên nên connection luôn "sống".
    const GEMMA_MAX_RETRIES = 3;
    const GEMMA_RETRY_DELAY_MS = 30000; // 30s

    function sleepMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // Kiểm tra 1 lỗi có phải do HTTP 429 (quota/rate-limit) hay không, để quyết
    // định có nên tự động thử lại hay không (lỗi khác như API Key sai, 400...
    // thì retry cũng vô ích nên không retry).
    function isRateLimitError(err) {
        return !!err && /HTTP 429/.test(err.message || String(err));
    }

    async function sendGemmaTurnOnce(contents, apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents,
                generationConfig: {
                    temperature: 0.35,
                    responseMimeType: 'application/json',
                    thinkingConfig: { thinkingLevel: 'MINIMAL' }
                }
            })
        });

        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${errBody}`);
        }

        if (!res.body) {
            throw new Error('Trình duyệt không hỗ trợ đọc response dạng stream.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let rawText = '';

        function consumeSseEvent(eventBlock) {
            const lines = eventBlock.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const jsonStr = trimmed.slice(5).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;

                let chunkData;
                try {
                    chunkData = JSON.parse(jsonStr);
                } catch (e) {
                    continue; // bỏ qua chunk JSON lỗi/không trọn vẹn
                }

                const parts = chunkData?.candidates?.[0]?.content?.parts || [];
                for (const p of parts) {
                    if (!p.thought && p.text) rawText += p.text;
                }
            }
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let sepIndex;
            while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
                const eventBlock = buffer.slice(0, sepIndex);
                buffer = buffer.slice(sepIndex + 2);
                consumeSseEvent(eventBlock);
            }
        }
        if (buffer.trim()) consumeSseEvent(buffer);

        return rawText;
    }

    // Gọi sendGemmaTurnOnce, tự động thử lại nếu gặp lỗi 429 (quota exceeded):
    // chờ 30s rồi thử lại, tối đa 3 lần thử (1 lần đầu + 2 lần retry).
    async function sendGemmaTurn(contents, apiKey, onRetryNotice) {
        let lastErr;
        for (let attempt = 1; attempt <= GEMMA_MAX_RETRIES; attempt++) {
            try {
                return await sendGemmaTurnOnce(contents, apiKey);
            } catch (err) {
                lastErr = err;
                const isLastAttempt = attempt >= GEMMA_MAX_RETRIES;
                if (!isRateLimitError(err) || isLastAttempt) {
                    throw err;
                }
                console.warn(`[Gemma] HTTP 429, thử lại sau 30s (lần ${attempt}/${GEMMA_MAX_RETRIES})...`);
                if (typeof onRetryNotice === 'function') {
                    onRetryNotice(attempt, GEMMA_MAX_RETRIES);
                }
                await sleepMs(GEMMA_RETRY_DELAY_MS);
            }
        }
        throw lastErr;
    }

    function parseGemmaRawText(rawText) {
        const jsonStart = rawText.indexOf('{');
        const jsonEnd = rawText.lastIndexOf('}');
        const jsonSlice = (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart)
            ? rawText.slice(jsonStart, jsonEnd + 1)
            : rawText;

        const parsed = JSON.parse(jsonSlice);
        return Array.isArray(parsed) ? parsed : (parsed.response || []);
    }

    // Gọi Gemma/Gemini API trực tiếp cho 1 lô câu thoại, trả về map { original: translated }.
    // Bên trong tự tách "items" thành các turn 40 câu, gửi nối tiếp trong cùng 1
    // conversation (xem GEMMA_DIALOG_CHUNK_SIZE ở trên) thay vì gửi 1 request duy nhất.
    async function callGemmaBatchDirect(items, apiKey, onRetryNotice) {
        if (!items.length) return {};

        const chunks = buildDialogChunks(items, GEMMA_DIALOG_CHUNK_SIZE);
        const contents = [];
        const map = {};

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const inputJson = JSON.stringify(chunk.map((it) => ({ original: it.text, name: it.speaker || null })));

            const userText = (i === 0)
                ? `${GEMINI_SYSTEM_INSTRUCTION}\n\nInput:\n${inputJson}`
                : `Dịch tiếp danh sách câu thoại sau, giữ đúng phong cách, giọng văn và quy tắc đã áp dụng ở các lượt trước:\n\nInput:\n${inputJson}`;

            contents.push({ role: 'user', parts: [{ text: userText }] });

            const rawText = await sendGemmaTurn(contents, apiKey, onRetryNotice);
            const responseItems = parseGemmaRawText(rawText);

            responseItems.forEach((item) => {
                if (item && typeof item.original === 'string' && typeof item.translated === 'string') {
                    map[item.original] = item.translated;
                }
            });

            // Đưa câu trả lời của model vào lịch sử để turn kế tiếp giữ ngữ cảnh.
            contents.push({ role: 'model', parts: [{ text: rawText }] });
        }

        return map;
    }

    // Dịch lại toàn bộ câu thoại đang hiển thị (theo Chap + tìm kiếm đang filter) bằng Gemma,
    // ghi đè lên bản dịch cũ nếu Gemma trả về kết quả cho câu đó.
    async function retranslateFilteredWithGemma() {
        const filterChap = chapFilterSelect.value;
        if (!filterChap) return;

        const keys = Object.keys(currentFilteredDict);
        if (keys.length === 0) {
            alert('Không có câu thoại nào trong chap này để dịch lại.');
            return;
        }

        const { geminiApiKey } = await new Promise((resolve) => {
            chrome.storage.local.get({ geminiApiKey: '' }, resolve);
        });

        if (!geminiApiKey) {
            alert('Vui lòng nhập Gemini API Key ở mục "Công cụ dịch" phía trên trước khi dịch lại bằng Gemma.');
            return;
        }

        const chapLabel = chapRemarks[filterChap] || filterChap;
        if (!confirm(`Dịch lại ${keys.length} câu thoại trong chap "${chapLabel}" bằng Gemma?\nBản dịch cũ (nếu có) sẽ bị ghi đè.`)) {
            return;
        }

        const items = keys.map((key) => ({
            key,
            text: key,
            speaker: getEntryName(currentFilteredDict[key])
        }));

        const originalLabel = btnRetranslateGemma.innerText;
        btnRetranslateGemma.disabled = true;
        gemmaRetranslateStatus.style.display = 'block';

        let translatedCount = 0;

        btnRetranslateGemma.innerText = `⏳ Đang dịch...`;
        gemmaRetranslateStatus.innerText = `Đang gửi ${items.length} câu tới Gemma...`;

        try {
            const map = await callGemmaBatchDirect(items, geminiApiKey, (attempt, max) => {
                gemmaRetranslateStatus.innerText = `Gemma bị giới hạn quota (429), thử lại sau 30s (lần ${attempt}/${max})...`;
            });
            items.forEach((it) => {
                const translated = map[it.text];
                if (translated && translated.trim()) {
                    updateEntryTranslation(it.key, translated.trim());
                    translatedCount++;
                }
            });
            saveDictionary();
            alert(`Đã dịch xong ${translatedCount}/${items.length} câu thoại trong chap "${chapLabel}".`);
        } catch (err) {
            console.error('[Gemma] Lỗi khi dịch lại lô:', err);
            alert(`Lỗi khi dịch lại bằng Gemma: ${err.message || err}`);
        }

        btnRetranslateGemma.disabled = false;
        btnRetranslateGemma.innerText = originalLabel;
        gemmaRetranslateStatus.style.display = 'none';
        gemmaRetranslateStatus.innerText = '';

        renderTable();
    }

    if (btnRetranslateGemma) {
        btnRetranslateGemma.addEventListener('click', () => {
            retranslateFilteredWithGemma();
        });
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

    if (btnSyncRemote) {
        btnSyncRemote.addEventListener('click', async () => {
            const originalLabel = btnSyncRemote.innerText;
            btnSyncRemote.disabled = true;
            btnSyncRemote.innerText = '⏳ Đang đồng bộ...';

            try {
                const response = await fetch(REMOTE_PRETRANSLATED_URL, { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const remoteDict = await response.json();

                if (typeof remoteDict !== 'object' || remoteDict === null || Array.isArray(remoteDict)) {
                    throw new Error('Dữ liệu remote không hợp lệ');
                }

                let addedCount = 0;
                let updatedCount = 0;

                Object.keys(remoteDict).forEach((key) => {
                    const remoteEntry = remoteDict[key];
                    const remoteTranslated = getEntryValue(remoteEntry);
                    const existingEntry = translationDict[key];

                    if (!existingEntry) {
                        translationDict[key] = (typeof remoteEntry === 'object' && remoteEntry !== null)
                            ? { time: nowUnix(), ...remoteEntry }
                            : { translated: remoteTranslated, name: null, chap: null, time: nowUnix() };
                        addedCount++;
                        return;
                    }

                    const existingTranslated = getEntryValue(existingEntry);
                    if ((!existingTranslated || !existingTranslated.trim()) && remoteTranslated && remoteTranslated.trim()) {
                        updateEntryTranslation(key, remoteTranslated);
                        updatedCount++;
                    }
                });

                migrateMissingTimes();
                saveDictionary();
                populateChapFilterOptions();
                renderTable();

                btnSyncRemote.innerText = '✓ Đã đồng bộ';
                alert(`Đồng bộ thành công!\nThêm mới: ${addedCount} câu\nBổ sung bản dịch còn thiếu: ${updatedCount} câu`);
            } catch (err) {
                console.error('Lỗi khi đồng bộ pretranslated.json:', err);
                btnSyncRemote.innerText = '✗ Lỗi';
                alert('Đồng bộ thất bại. Vui lòng kiểm tra kết nối mạng và thử lại.');
            } finally {
                setTimeout(() => {
                    btnSyncRemote.innerText = originalLabel;
                    btnSyncRemote.disabled = false;
                }, 1500);
            }
        });
    }

    if (btnSearch) {
        btnSearch.addEventListener('click', () => applySearchFilter());
    }
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applySearchFilter();
        }
    });
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