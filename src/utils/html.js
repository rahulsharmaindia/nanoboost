// ── HTML page helper for OAuth callback responses & legal pages ──

function renderPage(title, content) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} - Instagram Insights</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1A1035, #6C3CE1);
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      color: #333;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 40px;
      max-width: 720px;
      margin: 0 auto;
      box-shadow: 0 20px 60px rgba(0,0,0,.25);
    }
    h1 { color: #1A1035; margin-bottom: 8px; font-size: 28px; }
    h2 { color: #6C3CE1; margin-top: 28px; margin-bottom: 12px; font-size: 18px; }
    p  { color: #555; font-size: 15px; line-height: 1.6; }
    ul { color: #555; font-size: 15px; line-height: 1.8; padding-left: 20px; }
    li { margin-bottom: 4px; }
    a  { color: #6C3CE1; }
    em { color: #888; }
    strong { color: #333; }
  </style>
</head>
<body>
  <div class="card">
    ${content}
  </div>
</body>
</html>`;
}

module.exports = { renderPage };
