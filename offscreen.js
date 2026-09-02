// Chạy trong offscreen document — được background.js tạo ra khi cần quay.
// Vì service worker (MV3) không giữ được stream/MediaRecorder sống lâu, và
// popup thì đóng là mất mọi state, nên toàn bộ việc ghi hình phải nằm ở đây:
// offscreen document tồn tại độc lập, không bị ảnh hưởng khi đóng popup.

let recorder = null;
let recordedChunks = [];
let recordStartTime = null;
let recAudioCtx = null;
let recCapturedStream = null;

function pickSupportedMimeType() {
    const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
    ];
    for (const c of candidates) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return null;
}

async function startRecording(streamId) {
    if (recorder && recorder.state !== 'inactive') {
        return { ok: false, error: 'Đang quay rồi.' };
    }
    if (!streamId) {
        return { ok: false, error: 'Thiếu streamId để bắt tab.' };
    }

    try {
        // Lấy đúng video + audio "đầu ra" thật của tab (kể cả game phát âm
        // thanh qua Web Audio nội bộ, không cần thẻ <audio>/<video> nào).
        recCapturedStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            }
        });

        // Chrome sẽ "câm" tab gốc ngay khi audio bị tabCapture bắt đi, nên
        // phải tự nối lại vào loa ở đây để người dùng vẫn nghe được game
        // trong lúc quay.
        recAudioCtx = new AudioContext();
        const src = recAudioCtx.createMediaStreamSource(recCapturedStream);
        src.connect(recAudioCtx.destination);

        recordedChunks = [];
        const mimeType = pickSupportedMimeType();
        recorder = mimeType
            ? new MediaRecorder(recCapturedStream, { mimeType })
            : new MediaRecorder(recCapturedStream);

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };

        // Dùng chung 1 hàm "chốt file" cho cả onstop (dừng bình thường) lẫn
        // onerror (MediaRecorder gặp lỗi giữa chừng) — trước đây chỉ có onstop
        // xử lý lưu file + dọn dẹp, nên nếu recorder rơi vào lỗi (ví dụ do tab
        // bị Chrome thu hồi quyền capture đột ngột) thì: không có file nào
        // được lưu, VÀ track/stream cũng không được dọn dẹp -> biểu tượng
        // "đang quay" của Chrome kẹt lại mãi dù không quay gì nữa.
        function finalizeRecording() {
            try {
                if (recordedChunks.length > 0) {
                    // QUAN TRỌNG: offscreen document KHÔNG có quyền truy cập
                    // chrome.downloads (API này không được cấp cho offscreen
                    // document) — gọi chrome.downloads.download() ở đây sẽ
                    // ném lỗi "Cannot read properties of undefined (reading
                    // 'download')" ngay lập tức, khiến không có file nào được
                    // lưu. Thay vào đó, dùng thẻ <a download> để trình duyệt
                    // tự tải file — cách này không cần quyền "downloads" và
                    // hoạt động bình thường trong mọi loại document (kể cả
                    // offscreen document), tương tự cách content.js đang làm.
                    const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'video/webm' });
                    const url = URL.createObjectURL(blob);
                    const ts = new Date().toISOString().replace(/[:.]/g, '-');

                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `cravesagax-recording-${ts}.webm`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                } else {
                    console.warn('[Record] Không có dữ liệu nào được ghi, bỏ qua việc lưu file.');
                }
            } catch (e) {
                console.error('[Record] Lỗi khi lưu file:', e.message || e);
            } finally {
                // Luôn dọn dẹp track/stream dù có lưu được file hay không,
                // để biểu tượng "đang quay" của Chrome tắt đi ngay lập tức.
                recordedChunks = [];
                cleanupCaptureResources();
            }
        }

        recorder.onstop = finalizeRecording;

        recorder.onerror = (e) => {
            console.error('[Record] MediaRecorder gặp lỗi:', e.error || e);
            // MediaRecorder tự chuyển sang 'inactive' khi lỗi nhưng KHÔNG luôn
            // bắn sự kiện 'stop' sau đó -> phải tự gọi finalizeRecording() ở
            // đây để không bị kẹt track/stream lại.
            if (recorder && recorder.state === 'inactive') {
                finalizeRecording();
            }
        };

        // Nếu track bị dừng từ bên ngoài (vd người dùng bấm nút "Stop sharing"
        // do chính Chrome hiển thị, hoặc tab bị đóng/reload), track sẽ tự
        // "ended" nhưng MediaRecorder không phải lúc nào cũng tự dừng theo kịp
        // thời -> chủ động dừng recorder khi track chính kết thúc.
        const [videoTrack] = recCapturedStream.getVideoTracks();
        if (videoTrack) {
            videoTrack.addEventListener('ended', () => {
                if (recorder && recorder.state !== 'inactive') {
                    recorder.stop();
                } else {
                    // recorder đã inactive từ trước nhưng track vẫn chưa được
                    // dọn (trường hợp hiếm) -> dọn thẳng để tắt biểu tượng quay.
                    cleanupCaptureResources();
                }
            });
        }

        recorder.start(1000); // chốt dữ liệu mỗi 1s, tránh mất hết nếu có sự cố giữa chừng
        recordStartTime = Date.now();
        return { ok: true, startTime: recordStartTime };
    } catch (e) {
        cleanupCaptureResources();
        return { ok: false, error: e.message || String(e) };
    }
}

function cleanupCaptureResources() {
    if (recCapturedStream) {
        recCapturedStream.getTracks().forEach((t) => t.stop());
        recCapturedStream = null;
    }
    if (recAudioCtx) {
        recAudioCtx.close().catch(() => {});
        recAudioCtx = null;
    }
}

function stopRecording() {
    if (!recorder || recorder.state === 'inactive') {
        // Recorder đã dừng từ trước (do lỗi/track bị thu hồi) nhưng có thể
        // track/stream chưa kịp dọn -> dọn nốt ở đây để đảm bảo biểu tượng
        // "đang quay" luôn tắt, thay vì trả lỗi khiến popup kẹt ở trạng thái
        // "Đang quay" mãi mãi dù thực tế không còn quay gì cả.
        cleanupCaptureResources();
        recordStartTime = null;
        return { ok: true, alreadyStopped: true };
    }
    recorder.stop(); // onstop lo phần lưu file + dọn dẹp
    recordStartTime = null;
    return { ok: true };
}

function getStatus() {
    const recording = !!(recorder && recorder.state !== 'inactive');
    return { recording, startTime: recording ? recordStartTime : null };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== 'offscreen') return;

    if (message.type === 'RECORD_START') {
        startRecording(message.streamId).then(sendResponse);
        return true; // async response
    }
    if (message.type === 'RECORD_STOP') {
        sendResponse(stopRecording());
        return false;
    }
    if (message.type === 'RECORD_STATUS') {
        sendResponse(getStatus());
        return false;
    }
});
