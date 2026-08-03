
function createFloatingUI() {
    if (document.getElementById('translator-toggle-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'translator-toggle-btn';
    btn.innerText = '🌐 Dịch: ON';
    
    Object.assign(btn.style, {
        position: 'fixed',
        left: '10px',
        bottom: '10px',
        zIndex: '999999',
        padding: '10px 14px',
        backgroundColor: '#28a745',
        color: '#fff',
        fontWeight: 'bold',
        fontSize: '13px',
        borderRadius: '20px',
        cursor: 'pointer',
        boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
        userSelect: 'none',
        fontFamily: 'sans-serif',
        transition: 'all 0.2s ease'
    });

    let isTranslated = true;

    btn.addEventListener('click', () => {
        isTranslated = !isTranslated;
        btn.innerText = isTranslated ? '🌐 Dịch: ON' : '⏸️ Dịch: OFF';
        btn.style.backgroundColor = isTranslated ? '#28a745' : '#dc3545';

        // Gửi trạng thái tới tất cả iframe
        window.postMessage({ type: 'SET_TRANSLATION_STATE', enabled: isTranslated }, '*');
    });

    document.body.appendChild(btn);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingUI);
} else {
    createFloatingUI();
}

// Chuyển tiếp Message từ Top Window vào Main World
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SET_TRANSLATION_STATE') {
        window.postMessage({ type: 'GAME_TRANSLATION_STATE_UPDATE', enabled: event.data.enabled }, '*');
    }
});
