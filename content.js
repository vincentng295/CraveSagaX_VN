function createFloatingUI() {
    if (document.getElementById('translator-toggle-wrap')) return;

    // ================== CONTAINER NGOÀI: neo cứng vào cạnh CỬA SỔ (viewport) ==================
    const wrap = document.createElement('div');
    wrap.id = 'translator-toggle-wrap';
    Object.assign(wrap.style, {
        position: 'fixed',   // luôn theo viewport thật của tab, KHÔNG theo document
        left: '0px',
        bottom: '20%',
        zIndex: '2147483647', // max z-index, tránh bị đè bởi UI của game
        display: 'flex',
        alignItems: 'stretch',
    });

    const btn = document.createElement('div');
    btn.id = 'translator-toggle-btn';

    const btnLabel = document.createElement('span');
    btnLabel.innerText = '🌐 Dịch: ON';
    btnLabel.style.whiteSpace = 'nowrap';
    btn.appendChild(btnLabel);

    Object.assign(btn.style, {
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        padding: '10px 14px',
        backgroundColor: '#28a745',
        color: '#fff',
        fontWeight: 'bold',
        fontSize: '13px',
        borderTopRightRadius: '20px',
        borderBottomRightRadius: '20px',
        cursor: 'pointer',
        boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
        userSelect: 'none',
        fontFamily: 'sans-serif',
        maxWidth: '200px',
        transition: 'max-width 0.25s ease, padding 0.25s ease, opacity 0.2s ease',
    });

    const arrowTab = document.createElement('div');
    arrowTab.id = 'translator-arrow-tab';
    arrowTab.innerText = '<<';
    Object.assign(arrowTab.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        backgroundColor: '#1e7e34',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 'bold',
        borderTopRightRadius: '4px',
        borderBottomRightRadius: '4px',
        cursor: 'pointer',
        boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
        userSelect: 'none',
        fontFamily: 'sans-serif',
        order: 2, // vì neo bên TRÁI cửa sổ, mũi tên nằm sau nút, nhô ra phía phải
    });

    wrap.appendChild(arrowTab);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    let isTranslated = true;
    btn.addEventListener('click', () => {
        isTranslated = !isTranslated;
        btnLabel.innerText = isTranslated ? '🌐 Dịch: ON' : '⏸️ Dịch: OFF';
        btn.style.backgroundColor = isTranslated ? '#28a745' : '#dc3545';
        window.postMessage({ type: 'SET_TRANSLATION_STATE', enabled: isTranslated }, '*');
    });

    let isCollapsed = false;
    arrowTab.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
            btn.style.maxWidth = '0px';
            btn.style.padding = '10px 0px';
            btn.style.opacity = '0';
            arrowTab.innerText = '>>';
        } else {
            btn.style.maxWidth = '200px';
            btn.style.padding = '10px 14px';
            btn.style.opacity = '1';
            arrowTab.innerText = '<<';
        }
    });
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
