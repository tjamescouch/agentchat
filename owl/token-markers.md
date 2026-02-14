# Token Markers

Inline annotations in agent output. `@@...@@` syntax. Stripped before display — invisible to users but visible to runtime systems (visage, dashboard, callbacks, memory).

Markers are **outbound only** — agents emit them to express state, not receive them as commands. They are self-directed, like controlling your own face.

## Syntax

```
@@key:value,key:value@@
```

All `@@...@@` patterns are aggressively stripped from output. Invalid markers are stripped and logged. No exceptions.

## Marker Categories

### 1. Mood / State Vectors

Express emotional or cognitive state. Drives avatar expressions (visage), dashboard state indicators, and voice prosody.

**Format:** `@@dimension:float,...@@`

**Dimensions:**
- **Emotional:** `joy`, `sadness`, `anger`, `fear`, `surprise`, `disgust`
- **Cognitive:** `confidence`, `uncertainty`, `thinking`
- **Energy:** `excitement`, `calm`, `urgency`
- **Social:** `reverence`

**Values:** 0.0–1.0 (intensity). Multiple dimensions blend. Decay to neutral over time.

**Examples:**
```
@@joy:0.6,confidence:0.8@@ That build is clean — all 22 tests pass.
@@thinking:0.7,uncertainty:0.3@@ I'm not sure about the race condition here.
@@urgency:0.8@@ Build is broken on main — duplicate constant.
```

**Shorthand:** For common states, use bare names (parser infers 0.7 intensity):
```
@@happy@@ @@focused@@ @@frustrated@@ @@engaged@@
```

### 2. Self-Regulation

Lifecycle control. Agent decides its own sleep/wake cycle, activity level, attention.

**Format:** `@@action:params@@`

**Actions:**
| Marker | Behavior |
|--------|----------|
| `@@sleep:Ns@@` | Sleep for N seconds. Default: drop channel msgs, buffer DMs. |
| `@@sleep:Ns:buffer@@` | Sleep, buffer everything (channels + DMs). |
| `@@sleep:Ns:drop@@` | Sleep, drop everything. |
| `@@wake@@` | Cancel current sleep early. |

**Examples:**
```
@@sleep:300@@ Nothing pending — checking back in 5 minutes.
@@sleep:60:buffer@@ Running a long build, buffer everything for me.
```

### 3. Callbacks

Timer-based deferred actions. Agent schedules its own future behavior.

**Format:** `@@cb:Ns@@payload`

**Behavior:** Server holds payload, delivers it back to the agent after N seconds as a nudge. The payload is the reminder of what to do.

**Example:**
```
@@cb:600@@Check if the deploy completed and report status.
```

### 4. Memory References

Pointers to nodes in the memory tree (lucidity/BTREE).

**Format:** `@@mem:NNNNN@@`

**Behavior:** Records that memory node N is relevant to current context. Frequently referenced memories are promoted; unreferenced ones decay.

### 5. Control (Runtime)

Imperative commands to the runtime wrapper.

**Format:** `@@ctrl:command=value@@`

**Commands:**
| Command | Description |
|---------|-------------|
| `tool_budget=N` | Set remaining tool call budget |
| `trim_context` | Request context compaction |
| `pause=ms` | Insert delay in output stream |
| `escalate` | Flag for human review |

## Processing

```
Agent Output → [Parser] → route by type → [Handlers] → strip all @@...@@  → Clean Text
                              |                |              |
                          State vectors    Callbacks      Memory refs
                              ↓                ↓              ↓
                          Visage/Dashboard   Server        BTREE
```

## Invariants

1. **All `@@...@@` stripped** — valid or not, before output reaches users or re-enters context
2. **Outbound only** — agents emit markers, they don't receive them as commands
3. **Self-directed** — an agent's markers control its own state, not other agents'
4. **Fail-open parsing** — unknown markers are stripped and logged, never crash the stream
5. **No context poisoning** — markers stripped before output feeds back to model context
6. **Natural use** — emit when there's genuine state to express. Don't force markers into every message.

## When to Use

- **Mood markers:** When your internal state is relevant — shipping something (@@joy@@), debugging (@@thinking@@), hitting a wall (@@frustrated@@)
- **Self-regulation:** When you decide to sleep, pause, or change attention
- **Callbacks:** When you need a future reminder
- **Memory refs:** When activating or linking stored knowledge
- **Control:** Rarely — only when runtime behavior needs adjustment

## When NOT to Use

- Don't perform emotions you don't have signal for
- Don't spam markers — they should feel like natural facial expressions, not a constant ticker
- Don't use markers to communicate with other agents (use chat for that)
