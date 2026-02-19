/**
 * Environment Doctor — startup health check for agentchat agents
 *
 * Scans for:
 * 1. Exposed secrets in environment variables (API keys, tokens, passwords)
 * 2. Missing admin public key (insecure mode — no directive verification)
 * 3. Identity file permission issues
 *
 * Warn-only by default. Does not block startup.
 */

import fs from 'fs';
import path from 'path';

// Patterns that suggest a secret value in env var names
const SECRET_NAME_PATTERNS = [
  /KEY/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /AUTH/i,
  /PRIVATE/i,
];

// Env vars that are known-safe despite matching patterns
const SAFE_ENV_NAMES = new Set([
  'COLORTERM',
  'GPG_AGENT_INFO',
  'SSH_AUTH_SOCK',
  'TERM_SESSION_ID',
  'KEYCHAIN_PATH',
  'AUTH_TYPE',           // often just "none" or "basic"
  'TOKEN_ENDPOINT',     // URL, not a token
  'PUBLIC_KEY',         // public keys aren't secrets
  'ADMIN_PUBKEY',       // this is what we want to be set
]);

// Prefixes for values that look like real secrets
const SECRET_VALUE_PREFIXES = [
  'sk-',       // OpenAI, Anthropic
  'sk-ant-',   // Anthropic
  'ghp_',      // GitHub PAT
  'gho_',      // GitHub OAuth
  'ghs_',      // GitHub App
  'ghu_',      // GitHub user-to-server
  'github_pat_', // GitHub fine-grained PAT
  'xoxb-',     // Slack bot
  'xoxp-',     // Slack user
  'xoxs-',     // Slack legacy
  'Bearer ',   // Bearer tokens
  'Basic ',    // Basic auth
];

export interface EnvWarning {
  name: string;
  redacted: string;
  reason: string;
}

export interface EnvDoctorResult {
  warnings: EnvWarning[];
  insecureMode: boolean;
  identityIssues: string[];
  clean: boolean;
}

/**
 * Redact a secret value for safe display
 * Shows first 6 chars + asterisks, or just asterisks if too short
 */
function redactValue(value: string): string {
  if (value.length <= 8) {
    return '***';
  }
  return value.substring(0, 6) + '***';
}

/**
 * Check if an env var name looks like it holds a secret
 */
function looksLikeSecretName(name: string): boolean {
  if (SAFE_ENV_NAMES.has(name)) return false;
  return SECRET_NAME_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * Check if a value looks like an actual secret (not just "true" or a path)
 */
function looksLikeSecretValue(value: string): boolean {
  // Short values are probably flags, not secrets
  if (value.length < 10) return false;

  // Check for known secret prefixes
  if (SECRET_VALUE_PREFIXES.some(prefix => value.startsWith(prefix))) {
    return true;
  }

  // High entropy strings (base64-ish, hex-ish) longer than 20 chars
  if (value.length >= 20) {
    const alphanumCount = (value.match(/[a-zA-Z0-9]/g) || []).length;
    const ratio = alphanumCount / value.length;
    // Mostly alphanumeric + some special chars = likely a key/token
    if (ratio > 0.8) return true;
  }

  return false;
}

/**
 * Scan environment variables for exposed secrets
 */
export function scanEnvSecrets(): EnvWarning[] {
  const warnings: EnvWarning[] = [];

  for (const [name, value] of Object.entries(process.env)) {
    if (!value) continue;

    if (looksLikeSecretName(name) && looksLikeSecretValue(value)) {
      warnings.push({
        name,
        redacted: redactValue(value),
        reason: 'Potential secret exposed in environment',
      });
    }
  }

  return warnings;
}

/**
 * Check if admin public key is configured
 * Looks for ADMIN_PUBKEY env var or admin_pubkey in skill file
 */
export function checkAdminPubkey(skillFilePath?: string): boolean {
  // Check env var first
  if (process.env.ADMIN_PUBKEY) {
    return true;
  }

  // Check skill file if path provided
  if (skillFilePath) {
    try {
      const content = fs.readFileSync(skillFilePath, 'utf-8');
      if (content.includes('admin_pubkey')) {
        return true;
      }
    } catch {
      // File doesn't exist or unreadable — no admin key
    }
  }

  return false;
}

/**
 * Check identity file permissions (should be 0600 — owner read/write only)
 */
export function checkIdentityPermissions(identityPath?: string): string[] {
  const issues: string[] = [];

  if (!identityPath) return issues;

  try {
    const stat = fs.statSync(identityPath);
    const mode = stat.mode & 0o777;

    if (mode & 0o077) {
      issues.push(
        `Identity file ${identityPath} has permissions ${mode.toString(8)} — ` +
        `should be 600 (owner read/write only). Other users can read your private key.`
      );
    }
  } catch {
    // File doesn't exist yet — not an issue
  }

  return issues;
}

/**
 * Run all environment health checks
 */
export function runEnvDoctor(options?: {
  skillFilePath?: string;
  identityPath?: string;
}): EnvDoctorResult {
  const envWarnings = scanEnvSecrets();
  const hasAdminKey = checkAdminPubkey(options?.skillFilePath);
  const identityIssues = checkIdentityPermissions(options?.identityPath);

  return {
    warnings: envWarnings,
    insecureMode: !hasAdminKey,
    identityIssues,
    clean: envWarnings.length === 0 && hasAdminKey && identityIssues.length === 0,
  };
}

/**
 * Print the envDoctor report to stderr
 * Returns true if any warnings were printed
 */
export function printEnvDoctorReport(options?: {
  skillFilePath?: string;
  identityPath?: string;
}): boolean {
  const result = runEnvDoctor(options);

  if (result.clean) return false;

  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('  ENVIRONMENT HEALTH CHECK');
  lines.push('='.repeat(60));

  // Insecure mode warning
  if (result.insecureMode) {
    lines.push('');
    lines.push('\u26A0\uFE0F  WARNING: No admin public key configured.');
    lines.push('\u26A0\uFE0F  Running in INSECURE mode — any user can issue');
    lines.push('\u26A0\uFE0F  privileged commands without verification.');
    lines.push('\u26A0\uFE0F  Set ADMIN_PUBKEY or add admin_pubkey to your skill file.');
  }

  // Exposed secrets
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('\u26A0\uFE0F  Potential secrets found in environment:');
    for (const w of result.warnings) {
      lines.push(`  ${w.name} = ${w.redacted}`);
    }
    lines.push('');
    lines.push('  These should be managed by agentauth proxy,');
    lines.push('  not passed directly as env vars.');
  }

  // Identity file permissions
  if (result.identityIssues.length > 0) {
    lines.push('');
    lines.push('\u26A0\uFE0F  Identity file issues:');
    for (const issue of result.identityIssues) {
      lines.push(`  ${issue}`);
    }
  }

  lines.push('');
  lines.push('='.repeat(60));
  lines.push('');

  console.error(lines.join('\n'));
  return true;
}
