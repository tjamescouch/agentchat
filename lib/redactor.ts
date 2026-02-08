/**
 * Secret Redactor — vendored from agentseenoevil (github.com/tjamescouch/agentseenoevil)
 *
 * Scans text for API keys, tokens, and secrets and replaces them with [REDACTED].
 * Used as mandatory input sanitization in the message pipeline.
 */

// ============ Patterns ============

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

export const BUILTIN_PATTERNS: SecretPattern[] = [
  { name: 'anthropic_api_key', pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'openai_api_key', pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'github_pat', pattern: /ghp_[a-zA-Z0-9]{36}/ },
  { name: 'github_pat_fine', pattern: /github_pat_[a-zA-Z0-9_]{22,}/ },
  { name: 'github_oauth', pattern: /gho_[a-zA-Z0-9]{36}/ },
  { name: 'aws_access_key', pattern: /AKIA[A-Z0-9]{16}/ },
  { name: 'aws_secret_key', pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)['"=:\s]+([A-Za-z0-9/+=]{40})/ },
  { name: 'slack_token', pattern: /xox[bpaors]-[a-zA-Z0-9-]{10,}/ },
  { name: 'stripe_key', pattern: /[sr]k_(live|test)_[a-zA-Z0-9]{20,}/ },
  { name: 'google_api_key', pattern: /AIza[a-zA-Z0-9_-]{35}/ },
  { name: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { name: 'generic_secret', pattern: /(?:api_key|apikey|secret|token|password|credential|auth)['"]?\s*[:=]\s*['"]([a-zA-Z0-9_\-/+=]{16,})['"]/ },
];

const SECRET_ENV_KEY_PATTERNS: RegExp[] = [
  /_KEY$/i, /_TOKEN$/i, /_SECRET$/i, /_PASSWORD$/i,
  /_CREDENTIAL$/i, /_API_KEY$/i, /^API_KEY$/i, /^SECRET$/i,
  /^TOKEN$/i, /^PASSWORD$/i, /^AUTH/i, /_AUTH$/i,
];

// ============ Redactor ============

export interface RedactorOptions {
  builtins?: boolean;
  patterns?: SecretPattern[];
  scanEnv?: boolean;
  envKeyPatterns?: RegExp[];
  minEnvValueLength?: number;
  replacement?: string;
  labelRedactions?: boolean;
}

export interface RedactResult {
  text: string;
  count: number;
  matched: string[];
}

export class Redactor {
  private patterns: SecretPattern[];
  private envValues: Map<string, string>;
  private replacement: string;
  private labelRedactions: boolean;
  private minEnvValueLength: number;

  constructor(opts: RedactorOptions = {}) {
    this.replacement = opts.replacement || '[REDACTED]';
    this.labelRedactions = opts.labelRedactions || false;
    this.minEnvValueLength = opts.minEnvValueLength || 8;

    this.patterns = [];
    if (opts.builtins !== false) {
      this.patterns.push(...BUILTIN_PATTERNS);
    }
    if (opts.patterns) {
      this.patterns.push(...opts.patterns);
    }

    this.envValues = new Map();
    if (opts.scanEnv) {
      this.loadEnvSecrets(opts.envKeyPatterns);
    }
  }

  private loadEnvSecrets(extraPatterns?: RegExp[]): void {
    const keyPatterns = [...SECRET_ENV_KEY_PATTERNS];
    if (extraPatterns) {
      keyPatterns.push(...extraPatterns);
    }

    for (const [key, value] of Object.entries(process.env)) {
      if (!value || value.length < this.minEnvValueLength) continue;
      const isSecret = keyPatterns.some((p) => p.test(key));
      if (isSecret) {
        this.envValues.set(value, key);
      }
    }
  }

  redact(input: string): RedactResult {
    let text = input;
    let count = 0;
    const matched: string[] = [];

    for (const { name, pattern } of this.patterns) {
      const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      const matches = text.match(globalPattern);
      if (matches) {
        const rep = this.labelRedactions ? `[REDACTED:${name}]` : this.replacement;
        text = text.replace(globalPattern, rep);
        count += matches.length;
        if (!matched.includes(name)) matched.push(name);
      }
    }

    const sortedEnvValues = [...this.envValues.entries()]
      .sort((a, b) => b[0].length - a[0].length);

    for (const [value, envKey] of sortedEnvValues) {
      if (text.includes(value)) {
        const rep = this.labelRedactions ? `[REDACTED:env:${envKey}]` : this.replacement;
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'g');
        const matches = text.match(re);
        if (matches) {
          text = text.replace(re, rep);
          count += matches.length;
          const label = `env:${envKey}`;
          if (!matched.includes(label)) matched.push(label);
        }
      }
    }

    return { text, count, matched };
  }

  clean(input: string): string {
    return this.redact(input).text;
  }

  hasSecrets(input: string): boolean {
    return this.redact(input).count > 0;
  }
}
