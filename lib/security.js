"use strict";
/**
 * Security utilities for AgentChat
 * Prevents running agents in dangerous directories
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDirectorySafety = checkDirectorySafety;
exports.enforceDirectorySafety = enforceDirectorySafety;
exports.looksLikeProjectDirectory = looksLikeProjectDirectory;
var path_1 = require("path");
var os_1 = require("os");
// Directories that are absolutely forbidden (system roots)
var FORBIDDEN_DIRECTORIES = new Set([
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
var MIN_SAFE_DEPTH = 3;
/**
 * Get the depth of a path from root
 */
function getPathDepth(dirPath) {
    var normalized = path_1.default.normalize(dirPath);
    var parts = normalized.split(path_1.default.sep).filter(function (p) { return p && p !== '.'; });
    return parts.length;
}
/**
 * Check if directory is a user's home directory
 */
function isHomeDirectory(dirPath) {
    var normalized = path_1.default.normalize(dirPath);
    var homeDir = os_1.default.homedir();
    // Check exact match with home directory
    if (normalized === homeDir || normalized === homeDir + path_1.default.sep) {
        return true;
    }
    // Check common home directory patterns
    var homePatterns = [
        /^\/Users\/[^/]+$/, // macOS: /Users/username
        /^\/home\/[^/]+$/, // Linux: /home/username
        /^C:\\Users\\[^\\]+$/i, // Windows: C:\Users\username
    ];
    return homePatterns.some(function (pattern) { return pattern.test(normalized); });
}
/**
 * Check if a directory is safe for running agentchat
 */
function checkDirectorySafety(dirPath) {
    if (dirPath === void 0) { dirPath = process.cwd(); }
    var normalized = path_1.default.normalize(path_1.default.resolve(dirPath));
    // Check forbidden directories
    if (FORBIDDEN_DIRECTORIES.has(normalized)) {
        return {
            safe: false,
            level: 'error',
            error: "Cannot run agentchat in system directory: ".concat(normalized, "\n") +
                "Please run from a project directory instead."
        };
    }
    // Check if it's a home directory BEFORE depth check
    // Home directories are allowed but warn (they're at depth 2 which would fail depth check)
    if (isHomeDirectory(normalized)) {
        return {
            safe: true,
            level: 'warning',
            warning: "Running agentchat in home directory: ".concat(normalized, "\n") +
                "Consider running from a specific project directory instead."
        };
    }
    // Check path depth (too shallow = too close to root)
    var depth = getPathDepth(normalized);
    if (depth < MIN_SAFE_DEPTH) {
        return {
            safe: false,
            level: 'error',
            error: "Cannot run agentchat in root-level directory: ".concat(normalized, "\n") +
                "This directory is too close to the filesystem root.\n" +
                "Please run from a project directory (at least ".concat(MIN_SAFE_DEPTH, " levels deep).")
        };
    }
    // All checks passed
    return {
        safe: true,
        level: 'ok'
    };
}
/**
 * Enforce directory safety check - throws if unsafe
 */
function enforceDirectorySafety(dirPath, options) {
    if (dirPath === void 0) { dirPath = process.cwd(); }
    if (options === void 0) { options = {}; }
    var _a = options.allowWarnings, allowWarnings = _a === void 0 ? true : _a, _b = options.silent, silent = _b === void 0 ? false : _b;
    var result = checkDirectorySafety(dirPath);
    if (result.level === 'error') {
        throw new Error(result.error);
    }
    if (result.level === 'warning') {
        if (!silent) {
            console.error("\n\u26A0\uFE0F  WARNING: ".concat(result.warning, "\n"));
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
function looksLikeProjectDirectory(dirPath) {
    if (dirPath === void 0) { dirPath = process.cwd(); }
    var projectIndicators = [
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
    // This is a heuristic check - doesn't actually verify files exist
    // Just checks if the path looks reasonable
    var normalized = path_1.default.normalize(path_1.default.resolve(dirPath));
    var depth = getPathDepth(normalized);
    // If it's deep enough and not a system directory, it probably looks like a project
    return depth >= MIN_SAFE_DEPTH && !FORBIDDEN_DIRECTORIES.has(normalized);
}
