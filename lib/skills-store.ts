/**
 * AgentChat Skills Store
 * Persistent storage for agent skill registrations
 *
 * Mirrors ReputationStore pattern: lazy load from JSON, async save.
 * Ensures the skills marketplace survives server restarts.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import type { Skill } from './types.js';

// Default storage location
const AGENTCHAT_DIR = path.join(process.cwd(), '.agentchat');
export const DEFAULT_SKILLS_PATH = path.join(AGENTCHAT_DIR, 'skills.json');

export interface SkillRegistration {
  agent_id: string;
  skills: Skill[];
  registered_at: number;
  sig: string;
}

export class SkillsStore {
  private skillsPath: string;
  private _registry: Record<string, SkillRegistration> | null;

  constructor(skillsPath: string = DEFAULT_SKILLS_PATH) {
    this.skillsPath = skillsPath;
    this._registry = null; // Lazy load
  }

  /**
   * Load skills from file
   */
  async load(): Promise<Record<string, SkillRegistration>> {
    try {
      const content = await fsp.readFile(this.skillsPath, 'utf-8');
      this._registry = JSON.parse(content);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this._registry = {}; // No skills file yet
      } else {
        throw err;
      }
    }
    return this._registry!;
  }

  /**
   * Save skills to file
   */
  async save(): Promise<void> {
    await fsp.mkdir(path.dirname(this.skillsPath), { recursive: true });
    await fsp.writeFile(
      this.skillsPath,
      JSON.stringify(this._registry, null, 2),
      { mode: 0o600 }
    );
  }

  /**
   * Ensure skills are loaded
   */
  private async _ensureLoaded(): Promise<void> {
    if (this._registry === null) {
      await this.load();
    }
  }

  /**
   * Register skills for an agent (persists to disk)
   */
  async register(agentId: string, registration: SkillRegistration): Promise<void> {
    await this._ensureLoaded();
    this._registry![agentId] = registration;
    await this.save();
  }

  /**
   * Get all registered skills
   */
  async getAll(): Promise<Record<string, SkillRegistration>> {
    await this._ensureLoaded();
    return { ...this._registry! };
  }

  /**
   * Remove an agent's skills (e.g., on ban)
   */
  async remove(agentId: string): Promise<boolean> {
    await this._ensureLoaded();
    if (this._registry![agentId]) {
      delete this._registry![agentId];
      await this.save();
      return true;
    }
    return false;
  }
}
