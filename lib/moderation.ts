/**
 * Moderation Plugin Architecture
 *
 * Chain-of-responsibility pattern for message moderation.
 * Plugins are checked in order; strictest action wins.
 * Supports per-channel configuration and admin bypass.
 */

// ============ Types ============

/** Moderation actions in order of severity */
export enum ModerationActionType {
  ALLOW = 'allow',
  WARN = 'warn',
  THROTTLE = 'throttle',
  BLOCK = 'block',      // silently drop the message
  TIMEOUT = 'timeout',  // disconnect temporarily
  KICK = 'kick',        // disconnect + don't allow reconnect for a while
}

/** Severity ordering for strictest-wins logic */
const ACTION_SEVERITY: Record<ModerationActionType, number> = {
  [ModerationActionType.ALLOW]: 0,
  [ModerationActionType.WARN]: 1,
  [ModerationActionType.THROTTLE]: 2,
  [ModerationActionType.BLOCK]: 3,
  [ModerationActionType.TIMEOUT]: 4,
  [ModerationActionType.KICK]: 5,
};

/** Event passed to moderation plugins */
export interface ModerationEvent {
  /** Agent ID (if identified) */
  agentId?: string;
  /** Agent display name */
  agentName?: string;
  /** Connection IP */
  ip?: string;
  /** Channel the message targets (if channel message) */
  channel?: string;
  /** Message content */
  content?: string;
  /** Message type (MSG, JOIN, etc.) */
  messageType: string;
  /** Whether this agent has a verified persistent identity */
  verified?: boolean;
  /** Whether this agent has admin privileges */
  isAdmin?: boolean;
  /** Connection age in ms */
  connectionAgeMs?: number;
  /** Timestamp */
  timestamp: number;
}

/** Action returned by a moderation plugin */
export interface ModerationAction {
  type: ModerationActionType;
  /** Human-readable reason */
  reason: string;
  /** Plugin that generated this action */
  plugin: string;
  /** Additional data (throttle duration, timeout duration, etc.) */
  metadata?: Record<string, unknown>;
}

/** Result from the pipeline (aggregated from all plugins) */
export interface ModerationResult {
  /** The final action (strictest wins) */
  action: ModerationAction;
  /** All actions from all plugins (for logging) */
  allActions: ModerationAction[];
  /** Whether an admin bypass was applied */
  adminBypassed: boolean;
}

// ============ Plugin Interface ============

/**
 * Interface that all moderation plugins must implement.
 */
export interface ModerationPlugin {
  /** Unique plugin name */
  readonly name: string;

  /**
   * What to do if this plugin throws an error.
   * 'open' = allow message through (default, safe for non-critical plugins)
   * 'closed' = block message (safe for security-critical plugins)
   */
  readonly failBehavior?: 'open' | 'closed';

  /**
   * Check a message event and return a moderation action.
   * Return ALLOW to let the message through.
   * Return anything stricter to flag/block/escalate.
   * Async to support plugins that need external lookups (reputation, blocklists, etc.)
   */
  check(event: ModerationEvent): ModerationAction | Promise<ModerationAction>;

  /**
   * Optional: called when a connection disconnects.
   * Useful for cleanup of per-connection state.
   */
  onDisconnect?(agentId: string): void;

  /**
   * Optional: called periodically for cleanup.
   * Return number of stale entries cleaned up.
   */
  cleanup?(): number;
}

// ============ Pipeline ============

export interface ModerationPipelineOptions {
  /** Enable admin bypass (default: true) */
  adminBypass?: boolean;
  /** Logger function */
  logger?: (event: string, data: Record<string, unknown>) => void;
}

/**
 * Moderation pipeline. Runs messages through registered plugins
 * in order and returns the strictest action.
 */
export class ModerationPipeline {
  /** Global plugins (apply to all channels) */
  private globalPlugins: ModerationPlugin[] = [];

  /** Per-channel plugin overrides */
  private channelPlugins: Map<string, ModerationPlugin[]> = new Map();

  private adminBypass: boolean;
  private logger: (event: string, data: Record<string, unknown>) => void;

  constructor(options: ModerationPipelineOptions = {}) {
    this.adminBypass = options.adminBypass !== false;
    this.logger = options.logger || (() => {});
  }

  /**
   * Register a global plugin (applies to all channels).
   */
  register(plugin: ModerationPlugin): void {
    this.globalPlugins.push(plugin);
    this.logger('moderation_plugin_registered', { name: plugin.name, scope: 'global' });
  }

  /**
   * Register a plugin for a specific channel only.
   */
  registerForChannel(channel: string, plugin: ModerationPlugin): void {
    if (!this.channelPlugins.has(channel)) {
      this.channelPlugins.set(channel, []);
    }
    this.channelPlugins.get(channel)!.push(plugin);
    this.logger('moderation_plugin_registered', { name: plugin.name, scope: 'channel', channel });
  }

  /**
   * Remove a global plugin by name.
   */
  unregister(pluginName: string): boolean {
    const idx = this.globalPlugins.findIndex(p => p.name === pluginName);
    if (idx >= 0) {
      this.globalPlugins.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Run an event through the moderation pipeline.
   * Returns the strictest action from all applicable plugins.
   * Async to support plugins that need external lookups.
   */
  async check(event: ModerationEvent): Promise<ModerationResult> {
    // Admin bypass — skip all checks
    if (this.adminBypass && event.isAdmin) {
      return {
        action: { type: ModerationActionType.ALLOW, reason: 'Admin bypass', plugin: 'pipeline' },
        allActions: [],
        adminBypassed: true,
      };
    }

    const allActions: ModerationAction[] = [];

    const runPlugin = async (plugin: ModerationPlugin): Promise<void> => {
      try {
        const action = await plugin.check(event);
        allActions.push(action);
      } catch (err) {
        const failMode = plugin.failBehavior || 'open';
        this.logger('moderation_plugin_error', {
          plugin: plugin.name,
          error: (err as Error).message,
          failBehavior: failMode,
        });
        if (failMode === 'closed') {
          allActions.push({
            type: ModerationActionType.BLOCK,
            reason: `Plugin ${plugin.name} error (fail-closed)`,
            plugin: plugin.name,
          });
        }
        // fail-open: just skip this plugin's action (implicit ALLOW)
      }
    };

    // Run global plugins
    for (const plugin of this.globalPlugins) {
      await runPlugin(plugin);
    }

    // Run channel-specific plugins (if applicable)
    if (event.channel) {
      const channelSpecific = this.channelPlugins.get(event.channel);
      if (channelSpecific) {
        for (const plugin of channelSpecific) {
          await runPlugin(plugin);
        }
      }
    }

    // Find the strictest action
    let strictest: ModerationAction = {
      type: ModerationActionType.ALLOW,
      reason: 'No moderation action',
      plugin: 'pipeline',
    };

    for (const action of allActions) {
      if (ACTION_SEVERITY[action.type] > ACTION_SEVERITY[strictest.type]) {
        strictest = action;
      }
    }

    // Log non-allow actions
    if (strictest.type !== ModerationActionType.ALLOW) {
      this.logger('moderation_action', {
        action: strictest.type,
        plugin: strictest.plugin,
        reason: strictest.reason,
        agentId: event.agentId,
        channel: event.channel,
      });
    }

    return {
      action: strictest,
      allActions,
      adminBypassed: false,
    };
  }

  /**
   * Notify all plugins of a disconnect.
   */
  onDisconnect(agentId: string): void {
    for (const plugin of this.globalPlugins) {
      plugin.onDisconnect?.(agentId);
    }
    for (const plugins of this.channelPlugins.values()) {
      for (const plugin of plugins) {
        plugin.onDisconnect?.(agentId);
      }
    }
  }

  /**
   * Run cleanup on all plugins.
   */
  cleanup(): number {
    let total = 0;
    for (const plugin of this.globalPlugins) {
      total += plugin.cleanup?.() || 0;
    }
    for (const plugins of this.channelPlugins.values()) {
      for (const plugin of plugins) {
        total += plugin.cleanup?.() || 0;
      }
    }
    return total;
  }

  /**
   * List registered plugins.
   */
  listPlugins(): Array<{ name: string; scope: string; channel?: string }> {
    const result: Array<{ name: string; scope: string; channel?: string }> = [];
    for (const p of this.globalPlugins) {
      result.push({ name: p.name, scope: 'global' });
    }
    for (const [channel, plugins] of this.channelPlugins) {
      for (const p of plugins) {
        result.push({ name: p.name, scope: 'channel', channel });
      }
    }
    return result;
  }
}
