import * as path from 'path';

export type SourceFramework =
  | 'html'
  | 'next-app'
  | 'next-pages'
  | 'next-component'
  | 'react'
  | 'script'
  | 'unknown';

export interface SourceContext {
  filePath?: string;
  framework: SourceFramework;
  isNextJs: boolean;
  isJsxLike: boolean;
  isHtml: boolean;
}

function normalize(filePath?: string): string {
  return (filePath ?? '').split(path.sep).join('/');
}

export function detectSourceContext(filePath: string | undefined, text: string): SourceContext {
  const normalizedPath = normalize(filePath);
  const extension = path.extname(normalizedPath).toLowerCase();
  const isHtml = extension === '.html' || extension === '.htm';
  const isJsxLike = extension === '.jsx' || extension === '.tsx';

  if (isHtml) {
    return { filePath, framework: 'html', isNextJs: false, isJsxLike: false, isHtml: true };
  }

  const hasNextImport =
    /from\s+["']next(?:\/|["'])/.test(text) ||
    /require\s*\(\s*["']next(?:\/|["'])/.test(text) ||
    text.includes('next/head') ||
    text.includes('next/image') ||
    text.includes('next/script');

  const inAppDirectory = /(?:^|\/)app\//.test(normalizedPath);
  const inPagesDirectory = /(?:^|\/)pages\//.test(normalizedPath);
  const isAppRouteFile = inAppDirectory && /\/(?:page|layout|template|loading|error|not-found|head)\.(?:[jt]sx?)$/.test(normalizedPath);

  if (isAppRouteFile) {
    return { filePath, framework: 'next-app', isNextJs: true, isJsxLike, isHtml: false };
  }

  if (inPagesDirectory && isJsxLike) {
    return { filePath, framework: 'next-pages', isNextJs: true, isJsxLike: true, isHtml: false };
  }

  if (hasNextImport && (isJsxLike || extension === '.js' || extension === '.ts')) {
    return { filePath, framework: 'next-component', isNextJs: true, isJsxLike, isHtml: false };
  }

  const isReact =
    isJsxLike ||
    text.includes('from "react"') ||
    text.includes("from 'react'") ||
    /import\s+React\b/.test(text);

  if (isReact) {
    return { filePath, framework: 'react', isNextJs: false, isJsxLike, isHtml: false };
  }

  if (extension === '.js' || extension === '.ts' || extension === '.mjs' || extension === '.cjs') {
    return { filePath, framework: 'script', isNextJs: false, isJsxLike: false, isHtml: false };
  }

  return { filePath, framework: 'unknown', isNextJs: false, isJsxLike, isHtml: false };
}
