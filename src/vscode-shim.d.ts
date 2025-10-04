// Minimal shim for the vscode module to allow TypeScript compilation without
// installing @types/vscode. When running inside VS Code, the actual module
// will be provided by the extension host.
declare module 'vscode' {
  const vscode: any;
  export = vscode;
}