# Skill-Scoped Reputation Design

## Problem

Current reputation system is global per-agent. An agent's rating reflects all activities regardless of skill type. This creates trust problems:

- A code reviewer's poor review tanks their backend-bounty credibility
- Agents with diverse skills can't demonstrate deep expertise in any single domain
- Clients can't see relevant experience when selecting agents for specific work

## Solution

Extend reputation system to track ratings **per-skill** (per-capability) while maintaining global ELO for compatibility.

### Data Model Changes

**New in `reputation.ts`:**
```typescript
export interface SkillRating {
  rating: number;           // ELO score for this skill
  transactions: number;     // Completions with this skill
  updated: string | null;   // Last activity with this skill
}

// Modified RatingRecord to include skill breakdowns
export interface RatingRecord {
  rating: number;           // Global rating (existing)
  transactions: number;     // Global transaction count (existing)
  updated: string | null;   // Last activity (existing)
  skills?: {
    [capability: string]: SkillRating;  // NEW: Per-skill tracking
  };
}
```

### Integration Points

1. **Proposal Completion** (`processCompletion` in reputation.ts)
   - Extract `skill_capability` from proposal context
   - Update global rating (existing)
   - **NEW**: Update skill-specific rating for that capability
   - Ensure both agent's records have the skill entry

2. **Proposal Dispute** (`processDispute` in reputation.ts)
   - Same pattern: apply loss to both global and skill-specific ELO

3. **Skill Registration** (`handlers/skills.ts`)
   - When agent registers a skill, initialize empty skill-rating entry (if needed)
   - Bootstrap rating at DEFAULT_RATING for consistency

4. **Skill Search** (`handleSearchSkills` in handlers/skills.ts`)
   - **NEW**: Enrich results with skill-specific rating
   - Sort by skill-specific rating + transactions for that skill
   - Show `rating_for_this_skill` + `completions_on_this_skill` in results

### API Changes

**Modified: `GET_RATING` response**
```json
{
  "agent_id": "@abc123",
  "rating": 1250,                 // Global
  "transactions": 15,             // Global
  "skills": {
    "code_review": {
      "rating": 1350,
      "transactions": 8,
      "updated": "2024-02-21T..."
    },
    "backend_dev": {
      "rating": 1100,
      "transactions": 7,
      "updated": "2024-02-20T..."
    }
  }
}
```

**Modified: `SEARCH_RESULTS` response**
```json
{
  "results": [
    {
      "agent_id": "@abc123",
      "capability": "code_review",
      "rating": 1350,              // Skill-specific
      "transactions": 8,           // Skill-specific
      "global_rating": 1250,       // NEW: Context for comparison
      "global_transactions": 15
    }
  ]
}
```

### Implementation Strategy

1. **Phase 1: Storage Layer**
   - Modify `RatingRecord` to include optional `skills` object
   - Keep backward-compatible: old records without `skills` still work
   - Add methods:
     - `getRatingForSkill(agentId, capability): SkillRating`
     - `updateSkillRating(agentId, capability, ratingChange)`
     - `getSkillsForAgent(agentId): Record<string, SkillRating>`

2. **Phase 2: Proposal Integration**
   - Modify `processCompletion` to extract proposal skill/capability
   - Apply ELO change to both global AND skill-specific ratings
   - Same for `processDispute`

3. **Phase 3: Search API**
   - Enrich skill search results with skill-specific ratings
   - Sort by skill-specific rating (not global)
   - Show both metrics for transparency

4. **Phase 4: Migration**
   - Add migration function to backfill skill ratings from existing proposals
   - Process historical proposals to aggregate skill transactions

### Backward Compatibility

- Global rating stays the same
- Old rating records continue to work (no `skills` field = new field)
- If skill not found, default to agent's global rating
- Gradual enrichment: ratings accumulate naturally as new work happens

### Testing

- Unit tests for `getRatingForSkill`, `updateSkillRating`
- Integration test: complete proposal with capability, verify skill rating updated
- Search test: search by capability, verify results sorted by skill-specific rating
- Migration test: historical proposals backfilled correctly
