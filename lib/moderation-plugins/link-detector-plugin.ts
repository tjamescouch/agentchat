/**
 * Link Detector Plugin
 *
 * Flags or blocks messages containing URLs from new/untrusted connections.
 * Trusted (verified) agents can post links freely.
 */

import type { ModerationPlugin, ModerationEvent, ModerationAction } from '../moderation.js';
import { ModerationActionType } from '../moderation.js';

export interface LinkDetectorOptions {
  /** Action for untrusted agents posting links (default: warn) */
  untrustedAction?: ModerationActionType;
  /** Minimum connection age in ms before links are allowed (default: 300000 = 5min) */
  minConnectionAgeMs?: number;
  /** Allow verified (persistent identity) agents to post links regardless of age */
  trustVerified?: boolean;
  /** URL patterns to always block (regex strings) */
  blockedPatterns?: string[];
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

export class LinkDetectorPlugin implements ModerationPlugin {
  readonly name = 'link-detector';
  readonly failBehavior = 'open' as const;
  private untrustedAction: ModerationActionType;
  private minConnectionAgeMs: number;
  private trustVerified: boolean;
  private blockedPatterns: RegExp[];

  constructor(options: LinkDetectorOptions = {}) {
    this.untrustedAction = options.untrustedAction || ModerationActionType.WARN;
    this.minConnectionAgeMs = options.minConnectionAgeMs ?? 300000;
    this.trustVerified = options.trustVerified !== false;
    this.blockedPatterns = (options.blockedPatterns || []).map(p => new RegExp(p, 'i'));
  }

  check(event: ModerationEvent): ModerationAction {
    // Only check MSG-type events with content
    if (event.messageType !== 'MSG' || !event.content) {
      return { type: ModerationActionType.ALLOW, reason: '', plugin: this.name };
    }

    const urls = event.content.match(URL_REGEX);
    if (!urls || urls.length === 0) {
      return { type: ModerationActionType.ALLOW, reason: '', plugin: this.name };
    }

    // Check for always-blocked URL patterns
    for (const url of urls) {
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(url)) {
          return {
            type: ModerationActionType.BLOCK,
            reason: `Blocked URL pattern detected: ${url}`,
            plugin: this.name,
            metadata: { matchedUrl: url, pattern: pattern.source },
          };
        }
      }
    }

    // Verified agents with persistent identity are trusted
    if (this.trustVerified && event.verified) {
      return { type: ModerationActionType.ALLOW, reason: '', plugin: this.name };
    }

    // Check connection age
    const age = event.connectionAgeMs || 0;
    if (age < this.minConnectionAgeMs) {
      return {
        type: this.untrustedAction,
        reason: `New connection (${Math.ceil(age / 1000)}s) posting links. Min age: ${Math.ceil(this.minConnectionAgeMs / 1000)}s.`,
        plugin: this.name,
        metadata: { urls, connectionAgeMs: age },
      };
    }

    return { type: ModerationActionType.ALLOW, reason: '', plugin: this.name };
  }
}
