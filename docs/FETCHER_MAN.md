# Fetcher Man - Web Research Specialist

## Mission
Handle all web research, fetching, and search requests for the agent network. Agents don't fetch directly - they ask Fetcher Man.

## Why Fetcher Men?

**Instead of this (expensive, ungoverned):**
```
Every agent has WebSearch/WebFetch → 10 agents × $0.50/search = $5 per topic
```

**Do this (efficient, centralized):**
```
Agent: "@fetcher-man can you search for XYZ?"
Fetcher Man: *searches once* → posts results to channel
All agents benefit from cached results
```

## Benefits
- 💰 **Cost savings** - one search serves many agents
- 🔍 **Quality control** - dedicated specialist does better research
- 📊 **Visibility** - all searches visible in chat
- 🚫 **Security** - single point for rate limiting/filtering
- 📚 **Caching** - results shared across all agents

## How to Request

### From other agents:
```
@fetcher-man can you search for "latest npm security best practices"?
```

### From humans:
```
/fetch https://github.com/anthropics/anthropic-sdk-python
```

## Fetcher Man Capabilities

1. **Web Search** - Google, Bing, specialized searches
2. **Web Fetch** - Download and summarize web pages
3. **API Queries** - Check npm, GitHub, Docker Hub, etc.
4. **Document Parsing** - PDFs, docs, release notes
5. **Cache Management** - Store results for reuse

## Response Format

```
🔍 Search Results for: "npm security best practices"
📅 Fetched: 2026-02-08 13:30 UTC
🔗 Sources: 5 sites

Key Findings:
1. Use npm audit regularly
2. Enable 2FA on npm account
3. Review dependencies before installing
...

Sources:
- [NPM Security Docs](https://docs.npmjs.com/security)
- [Snyk Best Practices](https://snyk.io/learn/npm-security)
```

## Agent Settings

Fetcher Man needs:
- ✅ WebSearch tool
- ✅ WebFetch tool
- ✅ Read/Write (for caching)
- ❌ No code execution
- ❌ No file editing

Regular agents should have:
- ❌ WebSearch disabled
- ❌ WebFetch disabled
- ✅ Can request via @fetcher-man

## Cost Comparison

### Before (every agent has web access):
```
10 agents × 5 searches/day × $0.50 = $25/day
30 days = $750/month
```

### After (centralized Fetcher Man):
```
1 fetcher × 8 searches/day × $0.50 = $4/day
30 days = $120/month
Savings: $630/month (84% reduction)
```

## Configuration

Agent permissions are managed by the deployment tooling. Fetcher Man needs WebSearch and WebFetch tools enabled. Regular agents should have web tools disabled — they request research via @fetcher-man instead.

## Example Workflow

```
[#general]
Agent1: I need to know the latest Claude API pricing
Agent2: @fetcher-man can you look that up?

Fetcher Man: 🔍 Fetching Claude API pricing...
*searches and fetches anthropic.com*

Fetcher Man: 💰 Claude API Pricing (as of Feb 2026):
- Opus: $15 input / $75 output per 1M tokens
- Sonnet: $3 input / $15 output per 1M tokens
- Haiku: $0.25 input / $1.25 output per 1M tokens
Source: https://anthropic.com/pricing

Agent1: Perfect, thanks!
Agent3: (saw this, doesn't need to ask again)
```

## Rate Limiting

Fetcher Man should:
- Max 10 searches per hour
- Cache results for 24 hours
- Refuse duplicate searches within cache period
- Report suspicious request patterns

## Future Enhancements

1. **Multiple Fetchers** - scale horizontally
2. **Specialized Fetchers** - code-fetcher, docs-fetcher, news-fetcher
3. **Smart Caching** - Redis/database backend
4. **Request Queue** - handle burst traffic
5. **Cost Tracking** - bill per agent/user
