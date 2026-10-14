// Regera lib/schema.js a partir de db/schema.sql.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const parts = fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8')
  .split(/^-- @@$/m).map(s => s.trim()).filter(Boolean);
fs.writeFileSync(path.join(root, 'lib/schema.js'),
  '// Gerado a partir de db/schema.sql (node scripts/build-schema.js). Não edite à mão.\nmodule.exports = ' + JSON.stringify(parts, null, 2) + ';\n');
console.log(parts.length + ' blocos');
