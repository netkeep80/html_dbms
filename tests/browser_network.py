"""External test policy: block Service Worker registration without Playwright's
unguarded navigator.serviceWorker getter in opaque sandbox origins (v1.56.0).
All callers retain independent network and pageerror monitoring.
"""
def block_service_workers(context, unexpected):
    context.on('serviceworker', lambda worker: unexpected.append(worker.url))
    context.add_init_script(script="""(() => {
        let worker;
        try { worker = navigator.serviceWorker; }
        catch (error) {
            if (error.name === 'SecurityError' && self.origin === 'null') return;
            throw error;
        }
        if (worker) worker.register = async () => {
            throw new Error('Unexpected Service Worker registration in acceptance test');
        };
    })();""")
