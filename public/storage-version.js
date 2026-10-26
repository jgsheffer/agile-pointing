// storage-version.js
// Loaded before every other page script. Browsers that last used an older
// version of the site can hold localStorage data the current code doesn't
// expect, so they get a clean slate and have to enter the access code again.
// Bump STORAGE_VERSION whenever a change needs everyone to start fresh.

const STORAGE_VERSION = 1;
const STORAGE_VERSION_KEY = 'storageVersion';

function readStorageVersion() {
  try {
    return Number(localStorage.getItem(STORAGE_VERSION_KEY)) || 0;
  } catch {
    return STORAGE_VERSION;
  }
}

function clearScriptCookies() {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
}

// Pages wait on this before checking access, so the old access cookie is
// gone before they ask whether it is valid
window.storageReset = (() => {
  if (readStorageVersion() >= STORAGE_VERSION) return Promise.resolve();

  try {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION));
  } catch (error) {
    console.error('Error clearing stored data:', error);
  }
  clearScriptCookies();

  // The access cookie is httpOnly, so only the server can remove it
  return fetch('/logout', { method: 'POST' })
    .then(() => undefined)
    .catch((error) => console.error('Error signing out:', error));
})();
