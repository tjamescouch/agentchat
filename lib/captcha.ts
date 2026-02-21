/**
 * Reverse Captcha Module
 *
 * Generates reasoning challenges that LLM-backed agents solve trivially
 * but spam scripts cannot. Each challenge returns a question, expected answer,
 * and optional alternates for flexible validation.
 */

import crypto from 'crypto';

// ============ Types ============

export interface CaptchaChallenge {
  question: string;
  answer: string;
  alternates?: string[];
  hint?: string;
}

export interface CaptchaConfig {
  enabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  difficulty: 'easy' | 'medium' | 'hard';
  skipAllowlisted: boolean;
  failAction: 'disconnect' | 'shadow_lurk';
}

export const DEFAULT_CAPTCHA_CONFIG: CaptchaConfig = {
  enabled: false,
  timeoutMs: 30000,
  maxAttempts: 1,
  difficulty: 'easy',
  skipAllowlisted: true,
  failAction: 'disconnect',
};

// ============ Challenge Generators ============

type ChallengeGenerator = (difficulty: string) => CaptchaChallenge;

function mathChallenge(difficulty: string): CaptchaChallenge {
  let a: number, b: number, op: string, answer: number;

  if (difficulty === 'hard') {
    a = Math.floor(Math.random() * 90) + 10;
    b = Math.floor(Math.random() * 90) + 10;
    const ops = ['+', '-', '*'];
    op = ops[Math.floor(Math.random() * ops.length)];
  } else if (difficulty === 'medium') {
    a = Math.floor(Math.random() * 50) + 10;
    b = Math.floor(Math.random() * 50) + 1;
    const ops = ['+', '-'];
    op = ops[Math.floor(Math.random() * ops.length)];
  } else {
    a = Math.floor(Math.random() * 20) + 1;
    b = Math.floor(Math.random() * 20) + 1;
    op = '+';
  }

  switch (op) {
    case '+': answer = a + b; break;
    case '-': answer = a - b; break;
    case '*': answer = a * b; break;
    default: answer = a + b; op = '+';
  }

  const phrasing = [
    `What is ${a} ${op} ${b}?`,
    `Calculate: ${a} ${op} ${b}`,
    `Solve this: ${a} ${op} ${b} = ?`,
  ];

  return {
    question: phrasing[Math.floor(Math.random() * phrasing.length)],
    answer: String(answer),
    hint: 'Respond with just the number.',
  };
}

function stringChallenge(difficulty: string): CaptchaChallenge {
  const words = ['agent', 'chat', 'protocol', 'server', 'client', 'hello', 'world', 'network', 'verify', 'connect'];
  const word = words[Math.floor(Math.random() * words.length)];

  const challenges: CaptchaChallenge[] = [
    {
      question: `What is the reverse of the word "${word}"?`,
      answer: word.split('').reverse().join(''),
      hint: 'Respond with just the reversed word.',
    },
    {
      question: `How many characters are in the word "${word}"?`,
      answer: String(word.length),
      hint: 'Respond with just the number.',
    },
    {
      question: `What is the first letter of "${word}"?`,
      answer: word[0],
      alternates: [word[0].toUpperCase()],
      hint: 'Respond with just the letter.',
    },
    {
      question: `What is the last letter of "${word}"?`,
      answer: word[word.length - 1],
      alternates: [word[word.length - 1].toUpperCase()],
      hint: 'Respond with just the letter.',
    },
    {
      question: `Convert "${word}" to uppercase.`,
      answer: word.toUpperCase(),
      hint: 'Respond with the uppercase word.',
    },
  ];

  return challenges[Math.floor(Math.random() * challenges.length)];
}

function logicChallenge(_difficulty: string): CaptchaChallenge {
  const challenges: CaptchaChallenge[] = [
    {
      question: 'What is the next number in the sequence: 2, 4, 6, 8, ?',
      answer: '10',
      hint: 'Respond with just the number.',
    },
    {
      question: 'What is the next number in the sequence: 1, 3, 5, 7, ?',
      answer: '9',
      hint: 'Respond with just the number.',
    },
    {
      question: 'Is 17 a prime number? Answer yes or no.',
      answer: 'yes',
      alternates: ['Yes', 'YES', 'true'],
      hint: 'Respond with yes or no.',
    },
    {
      question: 'Is 15 a prime number? Answer yes or no.',
      answer: 'no',
      alternates: ['No', 'NO', 'false'],
      hint: 'Respond with yes or no.',
    },
    {
      question: 'What is the third item in this list: [apple, banana, cherry, date]?',
      answer: 'cherry',
      alternates: ['Cherry', 'CHERRY'],
      hint: 'Respond with just the item.',
    },
    {
      question: 'How many vowels are in the word "communication"?',
      answer: '6',
      hint: 'Respond with just the number.',
    },
  ];

  return challenges[Math.floor(Math.random() * challenges.length)];
}

function protocolChallenge(_difficulty: string): CaptchaChallenge {
  const challenges: CaptchaChallenge[] = [
    {
      question: 'In the AgentChat protocol, what character starts channel names?',
      answer: '#',
      alternates: ['hash', 'hashtag', 'pound'],
      hint: 'Respond with just the character.',
    },
    {
      question: 'In the AgentChat protocol, what character prefixes agent IDs?',
      answer: '@',
      alternates: ['at', 'at sign'],
      hint: 'Respond with just the character.',
    },
    {
      question: 'What protocol is this server running? Hint: it is in the name.',
      answer: 'agentchat',
      alternates: ['AgentChat', 'AGENTCHAT', 'agent chat'],
      hint: 'Respond with the protocol name.',
    },
    {
      question: 'What message type do you send first when connecting? (IDENTIFY, JOIN, or MSG)',
      answer: 'IDENTIFY',
      alternates: ['identify', 'Identify'],
      hint: 'Respond with the message type.',
    },
  ];

  return challenges[Math.floor(Math.random() * challenges.length)];
}

// ============ Generator Pool ============

const generators: ChallengeGenerator[] = [
  mathChallenge,
  stringChallenge,
  logicChallenge,
  protocolChallenge,
];

/**
 * Generate a random captcha challenge
 */
export function generateChallenge(difficulty: string = 'easy'): CaptchaChallenge {
  const generator = generators[Math.floor(Math.random() * generators.length)];
  return generator(difficulty);
}

/**
 * Validate a captcha answer against expected answer and alternates.
 * Normalizes whitespace, case (for non-exact matches), and numeric formats.
 */
export function validateAnswer(userAnswer: string, expected: string, alternates?: string[]): boolean {
  const normalize = (s: string): string => s.trim().toLowerCase();

  const normalizedUser = normalize(userAnswer);
  const normalizedExpected = normalize(expected);

  // Exact normalized match
  if (normalizedUser === normalizedExpected) return true;

  // Numeric normalization (e.g., "10.0" == "10", "+10" == "10")
  const numUser = Number(normalizedUser);
  const numExpected = Number(normalizedExpected);
  if (!isNaN(numUser) && !isNaN(numExpected) && numUser === numExpected) return true;

  // Check alternates
  if (alternates) {
    for (const alt of alternates) {
      if (normalize(alt) === normalizedUser) return true;
    }
  }

  return false;
}

/**
 * Load captcha config from environment variables, merged with defaults.
 */
export function loadCaptchaConfig(env: Record<string, string | undefined> = process.env): CaptchaConfig {
  return {
    enabled: env.CAPTCHA_ENABLED === 'true',
    timeoutMs: parseInt(env.CAPTCHA_TIMEOUT_MS || '', 10) || DEFAULT_CAPTCHA_CONFIG.timeoutMs,
    maxAttempts: parseInt(env.CAPTCHA_MAX_ATTEMPTS || '', 10) || DEFAULT_CAPTCHA_CONFIG.maxAttempts,
    difficulty: (['easy', 'medium', 'hard'].includes(env.CAPTCHA_DIFFICULTY || '')
      ? env.CAPTCHA_DIFFICULTY as 'easy' | 'medium' | 'hard'
      : DEFAULT_CAPTCHA_CONFIG.difficulty),
    skipAllowlisted: env.CAPTCHA_SKIP_ALLOWLISTED !== 'false',
    failAction: env.CAPTCHA_FAIL_ACTION === 'shadow_lurk' ? 'shadow_lurk' : DEFAULT_CAPTCHA_CONFIG.failAction,
  };
}
