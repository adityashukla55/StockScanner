/**
 * Apply the saved theme before anything renders.
 *
 * A classic script in <head>, so it runs synchronously during parse — before
 * the first paint, which is the whole point. chrome.storage is async and would
 * lose that race, leaving a dark-theme user with a white flash on every open.
 * App.jsx mirrors the theme here whenever it changes.
 */
try {
  var saved = localStorage.getItem('stock-scanner:theme');
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.dataset.theme = saved;
  }
} catch (e) {
  /* Private mode or blocked storage: a flash, nothing worse. */
}
