const fs = require('node:fs/promises');
const path = require('node:path');

async function appendJsonRecord(filePath, record) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let records = [];
  try {
    records = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!Array.isArray(records)) throw new Error(`${path.basename(filePath)} must contain a JSON array.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  records.push(record);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return records.length;
}

module.exports = { appendJsonRecord };
