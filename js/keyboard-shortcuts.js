/* Option produces symbols on macOS; shortcut routing uses physical key codes. */
(() => {
  const mac = /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const optionKey = event => {
    if (event.getModifierState?.('AltGraph')) return '';
    const code = event.code || '';
    return /^Digit[0-9]$/.test(code) ? code.slice(5) : /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : event.key.toLowerCase();
  };
  window.KeyboardShortcuts = { mac, optionKey, primary:mac ? 'Cmd' : 'Ctrl', navigation:mac ? 'Option' : 'Alt' };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('kbd').forEach(key => {
      if (key.textContent === 'Alt') key.textContent = mac ? '⌥ Option' : 'Alt';
      if (key.dataset.shortcutPrimary !== undefined) key.textContent = mac ? '⌘ Cmd' : 'Ctrl';
    });
    if (mac) {
      document.querySelectorAll('[title]').forEach(el => el.title = el.title.replace(/Alt\+/g,'Option+').replace(/Ctrl\/Cmd\+/g,'Cmd+'));
      document.querySelectorAll('.fc-import-shortcut,#planJsonStatus').forEach(el => el.textContent = el.textContent.replace(/Ctrl\/Cmd\+/g,'Cmd+'));
    }
  });
})();
