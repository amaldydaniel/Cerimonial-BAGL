/**
 * Cerimonial BAGL - Notificações e Alertas Visuais
 */
window.CerimonialToast = (function () {
  let toastTimeout = null;

  function show(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = msg;

    if (toastIcon) {
      if (type === 'error') {
        toastIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`;
        toastIcon.className = 'w-5 h-5 text-rose-400 flex-shrink-0';
        toast.className = 'fixed bottom-6 right-6 z-50 bg-rose-950 text-white text-xs sm:text-sm px-4 py-3 rounded-xl shadow-2xl border border-rose-700 flex items-center gap-2 transform translate-y-0 opacity-100 transition-all duration-300';
      } else if (type === 'warning') {
        toastIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>`;
        toastIcon.className = 'w-5 h-5 text-amber-400 flex-shrink-0';
        toast.className = 'fixed bottom-6 right-6 z-50 bg-[#0B1D3A] text-white text-xs sm:text-sm px-4 py-3 rounded-xl shadow-2xl border border-amber-500/60 flex items-center gap-2 transform translate-y-0 opacity-100 transition-all duration-300';
      } else {
        toastIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>`;
        toastIcon.className = 'w-5 h-5 text-emerald-400 flex-shrink-0';
        toast.className = 'fixed bottom-6 right-6 z-50 bg-[#0B1D3A] text-white text-xs sm:text-sm px-4 py-3 rounded-xl shadow-2xl border border-[#1C4179] flex items-center gap-2 transform translate-y-0 opacity-100 transition-all duration-300';
      }
    } else {
      toast.classList.remove('translate-y-20', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    }

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.add('translate-y-20', 'opacity-0');
      toast.classList.remove('translate-y-0', 'opacity-100');
    }, type === 'error' ? 4500 : 2600);
  }

  return { show };
})();

window.showToast = function (msg, type = 'success') {
  window.CerimonialToast.show(msg, type);
};
