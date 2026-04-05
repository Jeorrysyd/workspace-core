/**
 * Shared UI utilities — used by Content, Dialogue, and other modules
 */
const shared = {
  /**
   * Escape HTML to prevent XSS
   */
  escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  },

  /**
   * Add a chat-style message to a container
   * @param {HTMLElement} container - The messages container
   * @param {string} role - 'ai' or 'user'
   * @param {string} text - Message content
   * @param {object} [options] - Optional: { label, avatarText }
   * @returns {HTMLElement} The created message element
   */

  /**
   * Scroll a container to bottom
   */
  scrollToBottom(container) {
    if (container) container.scrollTop = container.scrollHeight;
  },

  /**
   * Format ISO date string to relative/short display
   */
  formatDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
};
