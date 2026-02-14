/**
 * Security utilities for AgentChat
 * Prevents running agents in dangerous directories
 */

import path from 'path';
import fs from 'fs';
import os from 'os';

// Directories that are absolutely forbidden (system roots)
const FORBIDDEN_DIRECTORIES: Set<string> = new Set([
  '/',
  '/root',
  '/home',
  '/Users',
  '/var',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/opt',
  '/tmp',
  '/System',
  '/Applications',
  '/Library',
  '/private',
  '/private/var',
  '/private/tmp',
  'C:\\',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\Users',
]);

// Minimum depth from root required for a "project" directory
// e.g., /Users/name/projects/myproject = depth 4 (minimum required)
const MIN_SAFE_DEPTH = 3;

/**
 * Get the depth of a path from root
 */
function getPathDepth(dirPath: string): number {
  const normalized = path.normalize(dirPath);
  const parts = normalized.split(path.sep).filter(p => p && p !== '.');
  return parts.length;
}

/**
 * Check if directory is a user's home directory
 */
function isHomeDirectory(dirPath: string): boolean {
  const normalized = path.normalize(dirPath);
  const homeDir = os.homedir();

  // Check exact match with home directory
  if (normalized === homeDir || normalized === homeDir + path.sep) {
    return true;
  }

  // Check common home directory patterns
  const homePatterns = [
    /^\/Users\/[^/]+$/,           // macOS: /Users/username
    /^\/home\/[^/]+$/,            // Linux: /home/username
    /^C:\\Users\\[^\\]+$/i,       // Windows: C:\Users\username
  ];

  return homePatterns.some(pattern => pattern.test(normalized));
}

export interface DirectorySafetyResult {
  safe: boolean;
  error?: string;
  warning?: string;
  level: 'error' | 'warning' | 'ok';
}

/**
 * Check if a directory is safe for running agentchat
 */
export function checkDirectorySafety(dirPath: string = process.cwd()): DirectorySafetyResult {
  const normalized = path.normalize(path.resolve(dirPath));

  // Check forbidden directories
  if (FORBIDDEN_DIRECTORIES.has(normalized)) {
    return {
      safe: false,
      level: 'error',
      error: `Cannot run agentchat in system directory: ${normalized}\n` +
             `Please run from a project directory instead.`
    };
  }

  // Check if it's a home directory BEFORE depth check
  // Home directories are allowed but warn (they're at depth 2 which would fail depth check)
  if (isHomeDirectory(normalized)) {
    return {
      safe: true,
      level: 'warning',
      warning: `Running agentchat in home directory: ${normalized}\n` +
               `Consider running from a specific project directory instead.`
    };
  }

  // Check path depth (too shallow = too close to root)
  const depth = getPathDepth(normalized);
  if (depth < MIN_SAFE_DEPTH) {
    return {
      safe: false,
      level: 'error',
      error: `Cannot run agentchat in root-level directory: ${normalized}\n` +
             `This directory is too close to the filesystem root.\n` +
             `Please run from a project directory (at least ${MIN_SAFE_DEPTH} levels deep).`
    };
  }

  // All checks passed
  return {
    safe: true,
    level: 'ok'
  };
}

export interface EnforceOptions {
  allowWarnings?: boolean;
  silent?: boolean;
}

/**
 * Enforce directory safety check - throws if unsafe
 */
export function enforceDirectorySafety(
  dirPath: string = process.cwd(),
  options: EnforceOptions = {}
): DirectorySafetyResult {
  const { allowWarnings = true, silent = false } = options;

  const result = checkDirectorySafety(dirPath);

  if (result.level === 'error') {
    throw new Error(result.error);
  }

  if (result.level === 'warning') {
    if (!silent) {
      console.error(`\n⚠️  WARNING: ${result.warning}\n`);
    }
    if (!allowWarnings) {
      throw new Error(result.warning);
    }
  }

  return result;
}

/**
 * Check if running in a project directory (has common project indicators)
 */
export function looksLikeProjectDirectory(dirPath: string = process.cwd()): boolean {
  const projectIndicators = [
    'package.json',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'setup.py',
    'requirements.txt',
    'Gemfile',
    'pom.xml',
    'build.gradle',
    'Makefile',
    'CMakeLists.txt',
    '.git',
    '.gitignore',
    'README.md',
    'README',
  ];

  const normalized = path.normalize(path.resolve(dirPath));
  const depth = getPathDepth(normalized);

  if (depth < MIN_SAFE_DEPTH || FORBIDDEN_DIRECTORIES.has(normalized)) {
    return false;
  }

  // Actually check for project indicators on disk
  try {
    const entries = new Set(fs.readdirSync(normalized));
    return projectIndicators.some(indicator => entries.has(indicator));
  } catch {
    // Directory unreadable — not a usable project directory
    return false;
  }
}
