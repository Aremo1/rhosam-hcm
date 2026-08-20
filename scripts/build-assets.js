/**
 * Build static assets for the web app from the original Apps Script HTML files.
 * Currently only needed for logo.js, because Logo.html embeds a base64 image that
 * is impractical to edit by hand. styles.css and app.js are maintained directly
 * under public/ and do NOT need regeneration.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcLogo = path.join(root, '..', 'AppScriptProject', 'Logo.html');
const dstLogo = path.join(root, 'public', 'logo.js');

function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No <script> block found in Logo.html');
  return m[1].trim();
}

if (!fs.existsSync(srcLogo)) {
  console.log('AppScriptProject/Logo.html not found - skipping logo generation (app will run without a logo).');
  process.exit(0);
}

const js = '// Generated from AppScriptProject/Logo.html by scripts/build-assets.js\n' + extractScript(fs.readFileSync(srcLogo, 'utf8')) + '\n';
fs.writeFileSync(dstLogo, js);
console.log('Wrote public/logo.js (' + js.length + ' bytes)');
