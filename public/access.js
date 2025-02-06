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
  // Add this line to set the text color
  document.getElementById('access-code-input').style.color = '#000000';
}
function submitAccessCode() {
  const accessCode = document.getElementById('access-code-input').value;
  if (accessCode === 'Agile25!') {
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

// Check access code when page loads
document.addEventListener('DOMContentLoaded', checkAccessCode);
