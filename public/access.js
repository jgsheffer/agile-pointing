// Access is decided by the server via an httpOnly cookie, so the client only
// asks whether it has access and reacts to the answer.

function showMainContent() {
  document.getElementById('access-form').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  // Pages listen for this to open their socket connection
  window.dispatchEvent(new Event('access-granted'));
}

function showAccessForm() {
  document.getElementById('access-form').style.display = 'block';
  document.getElementById('main-content').style.display = 'none';
  // Change the text color to white
  document.getElementById('access-code-input').style.color = '#FFFFFF';
  // Ensure input displays as plain text, not password
  document.getElementById('access-code-input').type = 'text';
}

// Only follow same-site paths, never "//other-host" style redirects
function getRedirectTarget() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

function checkAccessCode() {
  // Clear the old client-side cookie from before access was enforced server-side
  document.cookie = 'accessCode=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';

  fetch('/access-status')
    .then((response) => response.json())
    .then((data) => {
      if (data.valid) {
        const next = getRedirectTarget();
        if (next) {
          window.location.href = next;
          return;
        }
        showMainContent();
      } else {
        showAccessForm();
      }
    })
    .catch((error) => {
      console.error('Error checking access:', error);
      showAccessForm();
    });
}

function submitAccessCode() {
  const accessCode = document.getElementById('access-code-input').value;

  fetch('/validate-access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessCode }),
  })
    .then((response) => {
      if (response.status === 429) {
        throw new Error('Too many attempts');
      }
      return response.json();
    })
    .then((data) => {
      if (data.valid) {
        // Clear input
        document.getElementById('access-code-input').value = '';

        const next = getRedirectTarget();
        if (next) {
          window.location.href = next;
          return;
        }
        showMainContent();
      } else {
        alert('Invalid access code. Please try again.');
      }
    })
    .catch((error) => {
      console.error('Error:', error);
      alert(
        error.message === 'Too many attempts'
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : 'An error occurred. Please try again.'
      );
    });
}

// Add event listener for Enter key on the input field
function addEnterKeyListener() {
  const inputField = document.getElementById('access-code-input');
  if (inputField) {
    inputField.addEventListener('keypress', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitAccessCode();
      }
    });
  }
}

// Check access code and set up event listeners when page loads
document.addEventListener('DOMContentLoaded', function () {
  checkAccessCode();
  addEnterKeyListener();
});
