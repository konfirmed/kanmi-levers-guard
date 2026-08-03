const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const sourceDirectory = path.join(repositoryRoot, 'packages', 'core', 'dist');
const targetDirectory = path.join(repositoryRoot, 'out', 'node_modules', '@kanmi', 'core');

fs.rmSync(targetDirectory, { recursive: true, force: true });
fs.mkdirSync(path.join(targetDirectory, 'dist'), { recursive: true });

for (const fileName of fs.readdirSync(sourceDirectory)) {
  if (fileName.endsWith('.js')) {
    fs.copyFileSync(
      path.join(sourceDirectory, fileName),
      path.join(targetDirectory, 'dist', fileName)
    );
  }
}

fs.copyFileSync(
  path.join(repositoryRoot, 'packages', 'core', 'package.json'),
  path.join(targetDirectory, 'package.json')
);