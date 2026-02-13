#!/bin/bash
# review.sh — stateless PR review using claude -p
#
# Diffs a branch against main and pipes it to a fresh Claude session
# for unbiased code review. No persistent state, no accumulated context.
#
# Usage:
#   ./review.sh <repo-path> <branch>
#   ./review.sh <repo-path> <branch> --merge   # merge after approval
#   ./review.sh --scan                          # review all agent/* branches
#
# Examples:
#   ./review.sh ~/dev/claude/wormhole/junior/agentchat agent/junior
#   ./review.sh --scan --wormhole ~/dev/claude/wormhole

set -uo pipefail

WORMHOLE_DIR="${HOME}/dev/claude/wormhole"
DO_MERGE=false
SCAN_MODE=false
MODEL="sonnet"

# ── Args ─────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --merge)     DO_MERGE=true; shift ;;
        --scan)      SCAN_MODE=true; shift ;;
        --wormhole)  WORMHOLE_DIR="$2"; shift 2 ;;
        --model)     MODEL="$2"; shift 2 ;;
        -h|--help)   sed -n '2,/^$/s/^# //p' "$0"; exit 0 ;;
        -*)          echo "Unknown option: $1" >&2; exit 1 ;;
        *)           break ;;
    esac
done

# ── Review one branch ────────────────────────────────────────────────────

review_branch() {
    local repo_path="$1"
    local branch="$2"
    local repo_name
    repo_name=$(basename "$repo_path")

    echo "═══════════════════════════════════════════════════════════════"
    echo "REVIEW: ${repo_name} / ${branch}"
    echo "═══════════════════════════════════════════════════════════════"

    # Verify repo exists
    if [[ ! -d "${repo_path}/.git" ]]; then
        echo "ERROR: ${repo_path} is not a git repo"
        return 1
    fi

    # Verify branch exists
    if ! git -c core.hooksPath=/dev/null -C "$repo_path" rev-parse --verify "$branch" &>/dev/null; then
        echo "ERROR: branch '${branch}' not found in ${repo_path}"
        return 1
    fi

    # Get the diff
    local diff
    diff=$(git -c core.hooksPath=/dev/null -C "$repo_path" diff main..."$branch" 2>/dev/null)

    if [[ -z "$diff" ]]; then
        echo "No changes between main and ${branch}."
        return 0
    fi

    # Stats
    local stat
    stat=$(git -c core.hooksPath=/dev/null -C "$repo_path" diff --stat main..."$branch" 2>/dev/null)
    local commits
    commits=$(git -c core.hooksPath=/dev/null -C "$repo_path" log --oneline main.."$branch" 2>/dev/null)

    echo ""
    echo "Commits:"
    echo "$commits"
    echo ""
    echo "Stats:"
    echo "$stat"
    echo ""

    # Build the review prompt
    local prompt
    prompt=$(cat <<'PROMPT'
You are a stateless code reviewer. Review this diff with fresh eyes — no bias, no context about who wrote it. Be thorough but concise.

For each file changed, assess:
1. Correctness — does the logic work?
2. Security — any injection, auth, or data exposure issues?
3. Quality — naming, structure, error handling
4. Tests — are changes tested? Any missing coverage?

At the end, give a verdict:
- APPROVE — good to merge
- REQUEST CHANGES — list specific issues that must be fixed
- COMMENT — minor suggestions, ok to merge as-is

Keep the review under 200 lines. Focus on what matters.

Here are the commits:
PROMPT
)

    # Pipe to claude
    echo "Running review..."
    echo ""

    {
        echo "$prompt"
        echo ""
        echo "$commits"
        echo ""
        echo "Here is the diff:"
        echo ""
        echo "$diff"
    } | claude -p --model "$MODEL" 2>/dev/null

    local review_exit=$?

    if [[ $review_exit -ne 0 ]]; then
        echo "ERROR: claude review failed (exit $review_exit)"
        return 1
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════════════"

    # Merge if requested and review passed
    if [[ "$DO_MERGE" == "true" ]]; then
        echo ""
        echo "Merge requested. Merging ${branch} into main..."
        git -c core.hooksPath=/dev/null -C "$repo_path" checkout main 2>/dev/null
        if git -c core.hooksPath=/dev/null -C "$repo_path" merge --no-ff "$branch" -m "Merge ${branch} into main (reviewed by review.sh)"; then
            echo "MERGED: ${branch} → main"
        else
            echo "MERGE FAILED — resolve conflicts manually"
            git -c core.hooksPath=/dev/null -C "$repo_path" merge --abort 2>/dev/null
            return 1
        fi
    fi
}

# ── Scan mode: find all agent/* branches ─────────────────────────────────

scan_all() {
    echo "Scanning wormhole for agent branches..."
    echo ""

    local found=0

    for agent_dir in "${WORMHOLE_DIR}"/*/; do
        [[ ! -d "$agent_dir" ]] && continue

        # Check agent dir itself and subdirs for git repos
        for repo_dir in "$agent_dir" "${agent_dir}"*/; do
            [[ ! -d "${repo_dir}/.git" ]] && continue

            # Find non-main branches
            local branches
            branches=$(git -C "$repo_dir" branch --format='%(refname:short)' 2>/dev/null | grep -v '^main$' | grep -v '^master$')

            while IFS= read -r branch; do
                [[ -z "$branch" ]] && continue
                review_branch "$repo_dir" "$branch"
                found=$((found + 1))
                echo ""
            done <<< "$branches"
        done
    done

    if [[ $found -eq 0 ]]; then
        echo "No non-main branches found to review."
    else
        echo "Reviewed ${found} branch(es)."
    fi
}

# ── Main ─────────────────────────────────────────────────────────────────

if [[ "$SCAN_MODE" == "true" ]]; then
    scan_all
else
    if [[ $# -lt 2 ]]; then
        echo "Usage: $0 <repo-path> <branch> [--merge]"
        echo "       $0 --scan [--wormhole <path>]"
        exit 1
    fi
    review_branch "$1" "$2"
fi
