if (import.meta.env.PROD) {

    // ── KEYBOARD SHORTCUTS: block everything that opens DevTools ────────────
    document.addEventListener('keydown', e => {
        const ctrl  = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const key   = e.key.toUpperCase();

        const blocked =
            e.key === 'F12'                          || // DevTools toggle
            (ctrl && shift && key === 'I')           || // Inspector
            (ctrl && shift && key === 'J')           || // Console
            (ctrl && shift && key === 'C')           || // Picker
            (ctrl && shift && key === 'K')           || // Firefox console
            (ctrl && shift && key === 'E')           || // Network
            (ctrl && shift && key === 'M')           || // Memory/responsive
            (ctrl && shift && key === 'P')           || // Performance / command palette
            (ctrl && shift && key === 'S')           || // Style editor
            (ctrl && key === 'U')                    || // View source
            (ctrl && key === 'S')                    || // Save page
            (e.key === 'F5' && ctrl);                   // Hard refresh with devtools

        if (blocked) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);

    // ── SOURCES / DEBUGGER: freeze the panel with a continuous trap ─────────
    const trap = new Function('debugger');
    setInterval(trap, 50);

    // ── NETWORK TAB: continuously wipe recorded requests and timings ─────────
    setInterval(() => {
        try { performance.clearResourceTimings();      } catch {}
        try { performance.clearMarks();                } catch {}
        try { performance.clearMeasures();             } catch {}
        try { (performance as any).clearFrameTimings?.(); } catch {}
    }, 200);

    // ── PERFORMANCE TAB: suppress PerformanceObserver data ──────────────────
    try {
        const noop = () => {};
        (window as any)._perfObserverOverride = new PerformanceObserver(noop);
        (window as any)._perfObserverOverride.observe({ entryTypes: ['resource', 'navigation', 'longtask', 'paint', 'measure', 'mark'] });
    } catch {}

    // ── MEMORY TAB: no-op — can't clear heap snapshots, but freeze sources
    // keeps users from running any memory profiling scripts manually.

    // ── DETECT DEVTOOLS OPEN (image id getter trick) ─────────────────────────
    let devOpen = false;
    const probe = new Image();
    Object.defineProperty(probe, 'id', { get() { devOpen = true; } });

    setInterval(() => {
        devOpen = false;
        // eslint-disable-next-line no-console
        (window.console as any)._orig_log?.(probe);
        if (devOpen) {
            // Keep clearing to ensure Network/Performance stay blank
            try { performance.clearResourceTimings(); } catch {}
            try { performance.clearMarks();           } catch {}
        }
    }, 500);
}
