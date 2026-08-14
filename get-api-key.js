(function () {
    'use strict';

    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._url = url;
        return rawOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
        this.addEventListener('load', function () {
            if (this._url && this._url.includes('ListCloudApiKeys')) {
                try {
                    const responseText = this.responseText;
                    const apiKeyRegex = /AIzaSy[A-Za-z0-9_-]{33}/g;
                    const matchedKeys = responseText.match(apiKeyRegex);

                    if (matchedKeys && matchedKeys.length > 0) {
                        const uniqueKeys = [...new Set(matchedKeys)].map((key, index) => ({
                            name: `API Key ${index + 1}`,
                            key: key
                        }));

                        const urlParams = new URLSearchParams(window.location.search);
                        const autoClose = urlParams.get('auto_close') === '1';

                        // Bắn data ra ngoài qua window message
                        window.postMessage({
                            type: 'CRAVE_SAGA_FETCHED_KEYS',
                            keys: uniqueKeys,
                            autoClose: autoClose
                        }, '*');
                    }
                } catch (e) {
                    console.error('[GetAPIKey] Lỗi xử lý responseText:', e);
                }
            }
        });
        return rawSend.call(this, body);
    };

    console.log('[GetAPIKey MAIN] Script hook XHR đã sẵn sàng.');
})();