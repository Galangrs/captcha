(function (window) {
    const CDN_BASE = '__APP_DATA__/cdn';

    class SecureCaptcha {
        constructor(config) {
            this.config = config; // Store full config
            this.siteKey = config.siteKey;
            this.containerId = config.containerId; // Optional if element is passed
            this.element = config.element;         // Direct DOM reference
            this.callback = config.callback;
        }

        init() {
            console.log('SecureCaptcha: Initializing...');
            let container = this.element;

            if (!container && this.containerId) {
                container = document.getElementById(this.containerId);
            }

            if (!container) {
                console.error('SecureCaptcha: Container not found');
                return;
            }

            // Create iframe
            const iframe = document.createElement('iframe');

            // Build URL parameters
            const params = new URLSearchParams({
                // origin: encodeURIComponent(window.location.href), // Optional
                ua: encodeURIComponent(navigator.userAgent),
                ts: Date.now()
            });

            // Pass explicit style overrides if present
            if (this.config.style) {
                if (this.config.style.padding) params.append('padding', this.config.style.padding);
                if (this.config.style.gap) params.append('gap', this.config.style.gap);
            }

            // Pass theme
            if (this.config.theme) params.append('theme', this.config.theme);

            iframe.src = `${CDN_BASE}/render.html?${params.toString()}`;

            // Style the iframe
            // Fixed dimensions for Cloudflare-like layout
            iframe.style.width = '300px';
            iframe.style.height = '65px';
            iframe.style.border = 'none';
            iframe.style.overflow = 'hidden';
            iframe.setAttribute('scrolling', 'no');
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');

            // Post configuration when loaded
            iframe.onload = () => {
                iframe.contentWindow.postMessage(JSON.stringify({
                    type: 'CAPTCHA_INIT',
                    siteKey: this.siteKey,
                    origin: window.location.href,
                    autoVerify: this.config.autoVerify,
                    forceChallenge: this.config.forceChallenge,
                    timeout: this.config.timeout || 120000
                }), '*');
            };

            // Clear container and append iframe
            container.innerHTML = '';
            container.appendChild(iframe);

            // setup message listener
            this._setupMessageListener();
        }

        _setupMessageListener() {
            window.addEventListener('message', (event) => {
                // Verify origin (loose check for localhost)
                if (event.origin !== '__APP_DATA__') return;

                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'captcha-response') {
                        if (data.token) {
                            console.log('SecureCaptcha: Solved!', data.token);
                            if (this.callback) this.callback(data.token);
                        } else if (data.error) {
                            console.error('SecureCaptcha: Error', data.error);
                        }
                    }
                } catch (e) {
                    // Ignore non-JSON messages
                }
            });
        }
    }

    // Expose to window
    window.SecureCaptcha = SecureCaptcha;

    // New Global API: frameRender
    window.frameRender = function (siteKey, callback, options = {}) {
        console.log('SecureCaptcha: frameRender called for key', siteKey);
        const container = document.querySelector('[for="captcha-samdues"]');
        if (!container) {
            console.error('SecureCaptcha: Element with for="captcha-samdues" not found!');
            return;
        }

        const captcha = new SecureCaptcha({
            siteKey: siteKey,
            containerId: null,
            element: container,
            callback: callback,
            style: options.style, // Pass style options { padding: '...', gap: '...' }
            theme: options.theme, // Pass theme 'dark' or 'light'
            autoVerify: options.autoVerify,
            forceChallenge: options.forceChallenge,
            timeout: options.timeout
        });
        captcha.init();
    };

})(window);
