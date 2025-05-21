function checkAccessCode() {
  // Check if access code cookie exists
  const accessCodeCookie = document.cookie
    .split('; ')
    .find((row) => row.startsWith('accessCode='));

  if (accessCodeCookie) {
    // Cookie exists, hide access form and show main content
    document.getElementById('access-form').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
    return;
  }

  // Show access form, hide main content
  document.getElementById('access-form').style.display = 'block';
  document.getElementById('main-content').style.display = 'none';
  // Change the text color to white
  document.getElementById('access-code-input').style.color = '#FFFFFF';
  // Ensure input displays as plain text, not password
  document.getElementById('access-code-input').type = 'text';
}

function submitAccessCode() {
  const accessCode = document.getElementById('access-code-input').value;
  if (accessCode === process.env.ACCESS_CODE) {
    // Set cookie that expires in 365 days
    const d = new Date();
    d.setTime(d.getTime() + 365 * 24 * 60 * 60 * 1000);
    document.cookie = `accessCode=true; expires=${d.toUTCString()}; path=/`;

    // Show main content
    document.getElementById('access-form').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';

    // Clear input
    document.getElementById('access-code-input').value = '';
  } else {
    alert('Invalid access code. Please try again.');
  }
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
