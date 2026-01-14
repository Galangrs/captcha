(function () {
    const API_BASE = 'http://localhost:3000/api/v1';

    // State (in closure)
    let siteKey = null;
    let origin = null;
    let sessionToken = null;
    let dynamicEndpoints = null;
    let sessionKeyHex = null;
    let csrfToken = null;
    let mouseTrace = [];
    let interactionType = 'mouse';
    let isVerifying = false;
    let isLocked = false;
    let expiryTimer = null;
    let autoVerify = false;
    let forceChallenge = false;
    let timeoutDuration = 120000;

    // Security: Prevent global token injection
    Object.defineProperty(window, 'sessionToken', {
        set: function (val) {
            securityLockout('Injection Attempt');
        },
        get: function () { return null; }, // Hide real token
        configurable: false
    });

    function securityLockout(reason) {
        if (isLocked) return;
        isLocked = true;
        const widget = document.getElementById('widget-root');
        if (widget) widget.classList.add('locked');
        setResetState('Security Violation');
        console.warn('Security Lockout:', reason);
        // Report to server if needed
    }

    // --- Anti-Scraping / Extension Detection ---
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            // Check for typical extension-injected attributes
            if (mutation.type === 'attributes') {
                const attr = mutation.attributeName;
                if (attr.startsWith('data-extension') || attr.includes('grammarly') || attr.includes('dashlane')) {
                    securityLockout('Extension Detected');
                }
            }
            // Check for injected nodes (scripts, iframes from extensions)
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach(node => {
                    if (node.tagName === 'IFRAME' || node.tagName === 'SCRIPT') {
                        // Be strict or lenient depending on needs. Here we are strict.
                        // securityLockout('DOM Injection');
                    }
                });
            }
        });
    });

    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });

    if (navigator.webdriver) {
        // securityLockout('Automated Browser'); 
        // Note: Many legit headless browsers might trip this, use with caution or fallback to hard captcha
    }

    // --- Encryption Utilities (Unchanged) ---
    const EncryptionUtils = {
        async importKey(keyHex) {
            const keyBuffer = new Uint8Array(keyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            return await window.crypto.subtle.importKey(
                'raw', keyBuffer, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
            );
        },
        async encrypt(data, keyHex) {
            const key = await this.importKey(keyHex);
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encodedData = new TextEncoder().encode(JSON.stringify(data));
            const encryptedContent = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv }, key, encodedData
            );
            const encryptedBytes = new Uint8Array(encryptedContent);
            const tag = encryptedBytes.slice(encryptedBytes.length - 16);
            const content = encryptedBytes.slice(0, encryptedBytes.length - 16);
            const toHex = b => Array.from(b).map(n => n.toString(16).padStart(2, '0')).join('');
            return `${toHex(iv)}:${toHex(content)}:${toHex(tag)}`;
        },
        async decrypt(encryptedStr, keyHex) {
            const [ivHex, contentHex, tagHex] = encryptedStr.split(':');
            const key = await this.importKey(keyHex);
            const fromHex = h => new Uint8Array(h.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const encryptedBytes = new Uint8Array(contentHex.length / 2 + tagHex.length / 2);
            encryptedBytes.set(fromHex(contentHex));
            encryptedBytes.set(fromHex(tagHex), contentHex.length / 2);
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: fromHex(ivHex) }, key, encryptedBytes
            );
            return JSON.parse(new TextDecoder().decode(decryptedBuffer));
        },
        async getTimeBasedKey() {
            const minute = Math.floor(Date.now() / 60000);
            const secretSalt = 'SECURE_CAPTCHA_ROTATING_SALT_V1';
            const encoder = new TextEncoder();
            const data = encoder.encode(secretSalt + minute);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
    };

    // --- UI Controllers ---

    function setStatus(msg, type = 'normal') {
        const el = document.getElementById('status-msg');
        el.innerText = msg;
        if (msg) {
            el.classList.add('show-status');
        } else {
            el.classList.remove('show-status');
        }
    }

    function showMathChallenge(question) {
        document.getElementById('checkbox-container').style.display = 'none';
        const mathDiv = document.getElementById('math-challenge');
        mathDiv.style.display = 'flex';
        document.getElementById('math-question').innerText = question;

        // Unbind main click to prevent accidental triggers (simplified)
        const clickTarget = document.getElementById('click-target');
        // We handle clicks on the button specifically now
    }

    function setLoadingState(isLoading) {
        const check = document.getElementById('custom-check');
        const label = document.getElementById('check-label');
        if (!check) return;

        if (isLoading) {
            check.classList.add('loading');
            check.classList.remove('success');
            label.classList.add('shimmer');
            isVerifying = true;
        } else {
            check.classList.remove('loading');
            label.classList.remove('shimmer');
            isVerifying = false;
        }
    }

    function setSuccessState() {
        // Restore checkbox view if we were in math mode
        document.getElementById('math-challenge').style.display = 'none';
        document.getElementById('checkbox-container').style.display = 'flex';

        const check = document.getElementById('custom-check');
        const label = document.getElementById('check-label');

        check.classList.remove('loading');
        check.classList.add('success');
        label.classList.remove('shimmer');

        label.innerText = 'Success!'; // Or "You are verified"
        label.style.color = 'var(--text-color)';
        setStatus('');
    }

    function setResetState(msg) {
        const check = document.getElementById('custom-check');
        const label = document.getElementById('check-label');

        const wasSuccess = check.classList.contains('success');

        check.classList.remove('loading');
        check.classList.remove('success');
        label.classList.remove('shimmer');

        if (wasSuccess || msg === 'Session expired') {
            check.classList.add('error-shake');
            setTimeout(() => {
                check.classList.remove('error-shake');
            }, 400);
        }

        label.innerText = 'Verify you are human';
        setStatus(msg || 'Verification failed');
        isVerifying = false;
    }

    // --- Logic ---

    let lastLogTime = 0;
    const LOG_INTERVAL = 30; // Throttle: 30ms

    document.addEventListener('mousemove', (e) => {
        if (isLocked) return;
        // Basic trusted event check
        if (!e.isTrusted) {
            interactionType = 'bot_script';
        }
        if (interactionType !== 'mouse' && interactionType !== 'touch') interactionType = 'mouse';

        const now = Date.now();
        if (now - lastLogTime > LOG_INTERVAL) {
            mouseTrace.push({ x: e.clientX, y: e.clientY, t: now });
            lastLogTime = now;
        }
    });

    async function initSession() {
        if (isLocked) return;
        try {
            const timeKey = await EncryptionUtils.getTimeBasedKey();
            const initPayload = { siteKey, origin };
            const encryptedInit = await EncryptionUtils.encrypt(initPayload, timeKey);

            const res = await fetch(`${API_BASE}/captcha/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payload: encryptedInit })
            });

            if (!res.ok) throw new Error();
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Init rejected');

            dynamicEndpoints = data.data.endpoints;
            sessionKeyHex = data.data.key;
            csrfToken = data.data.csrfToken;

            // Load Challenge
            const challengeUrl = 'http://localhost:3000' + dynamicEndpoints.challenge;
            const payload = {
                siteKey, action: 'render',
                fingerprint: 'fp_' + Math.random().toString(36).substr(2) + Date.now().toString(36),
                data: { url: origin, ua: navigator.userAgent },
                forceChallenge: forceChallenge
            };

            const encrypted = await EncryptionUtils.encrypt(payload, sessionKeyHex);
            const challengeRes = await fetch(challengeUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({ payload: encrypted })
            });

            const wrapper = await challengeRes.json();
            let result = wrapper.encrypted ? await EncryptionUtils.decrypt(wrapper.payload, sessionKeyHex) : wrapper;

            if (result.success) {
                sessionToken = result.data.challengeId;

                if (result.data.type === 'math' && result.data.payload && result.data.payload.question) {
                    showMathChallenge(result.data.payload.question);
                } else {
                    // If autoVerify is enabled and it's NOT a math challenge (which needs input), try to verify
                    if (autoVerify) {
                        // Small delay to simulate "check"
                        setTimeout(() => handleVerify(), 500);
                    }
                }
            } else {
                throw new Error();
            }

        } catch (err) {
            setResetState('Error loading challenge');
        }
    }

    async function handleVerify(answer = null) {
        if (isVerifying || isLocked) return;

        // Final Check: Token must be set internally
        if (!sessionToken) {
            return setResetState('Reload required');
        }

        // Check for Minimize/Background execution
        if (document.hidden || document.visibilityState === 'hidden') {
            return securityLockout('Background execution detected');
        }

        // Check if document has focus (real user click gives focus)
        if (!document.hasFocus()) {
            return securityLockout('Window not focused');
        }

        setLoadingState(true);

        try {
            const verifyUrl = 'http://localhost:3000' + dynamicEndpoints.verify;
            const payload = {
                sessionToken: sessionToken, // Internal variable
                mouseTrace,
                interactionType
            };

            if (answer) {
                payload.answer = answer;
            }

            const encrypted = await EncryptionUtils.encrypt(payload, sessionKeyHex);
            const res = await fetch(verifyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({ payload: encrypted })
            });

            const wrapper = await res.json();
            let result = wrapper.encrypted ? await EncryptionUtils.decrypt(wrapper.payload, sessionKeyHex) : wrapper;

            if (result.success) {
                setSuccessState();
                // Start 2-minute timer to force re-verification
                if (expiryTimer) clearTimeout(expiryTimer);
                expiryTimer = setTimeout(() => {
                    setResetState('Session expired');
                    sessionToken = null; // Invalidate internal token
                }, timeoutDuration);

                setTimeout(() => {
                    window.parent.postMessage(JSON.stringify({
                        type: 'captcha-response',
                        token: result.data.token,
                        error: null
                    }), '*');
                }, 600);
            } else {
                setResetState('Verification failed');
                mouseTrace = [];
            }

        } catch (err) {
            setResetState('Connection error');
        }
    }

    // --- Theme & Color Customization ---
    window.applyCustomColors = function (colors) {
        if (!colors) return;

        const root = document.documentElement;

        if (colors.primary) {
            root.style.setProperty('--primary-color', colors.primary);
            root.style.setProperty('--primary-glow', `color-mix(in srgb, ${colors.primary}, transparent 85%)`);
        }
        if (colors.bg) root.style.setProperty('--widget-bg', colors.bg);
        if (colors.text) root.style.setProperty('--text-color', colors.text);
        if (colors.border) root.style.setProperty('--border-color', colors.border);
    }

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        // Theme check
        const urlParams = new URLSearchParams(window.location.search);
        const theme = urlParams.get('theme');
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        }

        // Custom Color via URL (simple hex or name)
        const primaryColor = urlParams.get('primary');
        if (primaryColor) {
            window.applyCustomColors({ primary: primaryColor });
        }

        // Bind Click Listener
        const clickTarget = document.getElementById('click-target');
        if (clickTarget) {
            clickTarget.addEventListener('click', (e) => {
                // If Math challenge is visible, ignore generic clicks unless on button
                if (document.getElementById('math-challenge').style.display !== 'none') return;

                if (isVerifying || isLocked) return;
                if (!e.isTrusted) {
                    interactionType = 'system_flagged';
                    securityLockout('Untrusted Event');
                    return;
                }
                handleVerify();
            });
        }

        // Bind Math Submit
        const mathBtn = document.getElementById('math-submit');
        if (mathBtn) {
            mathBtn.addEventListener('click', (e) => {
                const answer = document.getElementById('math-answer').value;
                if (!answer) return;
                handleVerify(answer);
            });
        }
    })

    window.addEventListener('message', (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'CAPTCHA_INIT') {
                siteKey = data.siteKey;
                origin = data.origin;
                if (data.theme) {
                    if (data.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
                    else document.documentElement.removeAttribute('data-theme');
                }
                if (data.customColors) {
                    window.applyCustomColors(data.customColors);
                }
                autoVerify = data.autoVerify;
                forceChallenge = data.forceChallenge;
                if (data.timeout) timeoutDuration = data.timeout;

                if (siteKey && origin) initSession();
            }
        } catch (e) { }
    });

})();
