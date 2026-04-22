// ── HTML page helper for OAuth callback responses ────────────

function renderPage(title, message) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body {
      font-family: -apple-system, sans-serif;
      background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,.25);
    }
    h2 { color: #262626; margin-bottom: 12px; }
    p  { color: #8e8e8e; font-size: 15px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

module.exports = { renderPage };
