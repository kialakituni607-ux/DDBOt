const isProduction = import.meta.env.PROD;

if (isProduction) {
    // ── Block keyboard shortcuts for DevTools panels ────────────────────────
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        // F12 — opens DevTools
        if (e.key === 'F12') { e.preventDefault(); e.stopImmediatePropagation(); return; }

        if (ctrl && shift) {
            switch (e.key.toUpperCase()) {
                case 'I': // Elements / Inspector
                case 'J': // Console
                case 'C': // Inspector picker
                case 'K': // Firefox Console
                case 'E': // Network
                case 'M': // Memory / Responsive
                case 'P': // Performance
                case 'S': // Style editor (Firefox)
                case 'U': // View source
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
            }
        }

        // Ctrl+U — view source
        if (ctrl && e.key.toUpperCase() === 'U') {
            e.preventDefault();
            e.stopImmediatePropagation();
        }

        // Ctrl+S — save page
        if (ctrl && e.key.toUpperCase() === 'S') {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);

    // ── Disable right-click context menu ────────────────────────────────────
    document.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    // ── Freeze Debugger / Sources panel ─────────────────────────────────────
    // When the Sources/Debugger panel is open with "Pause on exceptions" or
    // when a user tries to set breakpoints, this loop continuously triggers
    // the debugger statement, making the panel unusable.
    const freezeDebugger = new Function('debugger');
    setInterval(freezeDebugger, 50);

    // ── Detect DevTools open via timing attack ───────────────────────────────
    // When DevTools is open, toString() of a watched object triggers a getter
    // which takes measurably longer. If detected, we clear the page content.
    let devtoolsOpen = false;
    const element = new Image();
    Object.defineProperty(element, 'id', {
        get() {
            devtoolsOpen = true;
        },
    });

    setInterval(() => {
        devtoolsOpen = false;
        console.log(element); // triggers the getter — console is already silenced
        if (devtoolsOpen) {
            // DevTools is open — blank every panel by flooding with empty output
            document.title = 'TRADEMASTERS';
        }
    }, 1000);

    // ── Block window size-based DevTools detection fallback ─────────────────
    // When DevTools is docked, the window inner size shrinks noticeably.
    const threshold = 160;
    setInterval(() => {
        const widthDiff  = window.outerWidth  - window.innerWidth;
        const heightDiff = window.outerHeight - window.innerHeight;
        if (widthDiff > threshold || heightDiff > threshold) {
            // DevTools panel is docked — freeze the debugger
            freezeDebugger();
        }
    }, 500);
}
