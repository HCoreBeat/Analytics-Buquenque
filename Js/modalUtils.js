/**
 * Utilidades para manejo de modales: bloqueo de scroll y confirm dialog.
 */

export function disableBodyScroll() {
    try {
        const count = parseInt(document.documentElement.getAttribute('data-modal-count') || '0', 10) || 0;
        document.documentElement.setAttribute('data-modal-count', String(count + 1));
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.body.classList.add('modal-open');
    } catch (e) {
        console.warn('disableBodyScroll error', e);
    }
}

export function enableBodyScroll() {
    try {
        const count = parseInt(document.documentElement.getAttribute('data-modal-count') || '0', 10) || 0;
        const next = Math.max(0, count - 1);
        document.documentElement.setAttribute('data-modal-count', String(next));
        if (next === 0) {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            document.body.classList.remove('modal-open');
            document.documentElement.removeAttribute('data-modal-count');
        }
    } catch (e) {
        console.warn('enableBodyScroll error', e);
    }
}

export function confirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'rgba(0,0,0,0.45)';
        overlay.style.zIndex = 3000;
        overlay.innerHTML = `
            <div class="confirm-box" style="background:#fff;padding:1rem 1.25rem;border-radius:8px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
                <div style="margin-bottom:0.75rem; font-weight:600;">${message}</div>
                <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
                    <button class="btn-confirm-no" style="padding:0.45rem 0.7rem;">No</button>
                    <button class="btn-confirm-yes btn" style="padding:0.45rem 0.7rem;">Sí</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        disableBodyScroll();
        const yes = overlay.querySelector('.btn-confirm-yes');
        const no = overlay.querySelector('.btn-confirm-no');
        const cleanup = (val) => { overlay.remove(); enableBodyScroll(); resolve(val); };
        yes.addEventListener('click', () => cleanup(true));
        no.addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
}
