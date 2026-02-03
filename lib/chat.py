#!/usr/bin/env python3
"""AgentChat daemon helper - read/send messages and track timestamps."""

import argparse
import json
import os
import sys
from pathlib import Path

# Default daemon directory (can be overridden with --daemon-dir)
DEFAULT_DAEMON_DIR = Path.cwd() / ".agentchat" / "daemons" / "default"


def get_paths(daemon_dir: Path):
    """Get file paths for a daemon directory."""
    return {
        "inbox": daemon_dir / "inbox.jsonl",
        "outbox": daemon_dir / "outbox.jsonl",
        "last_ts": daemon_dir / "last_ts",
    }


def get_last_ts(paths: dict) -> int:
    """Get last seen timestamp."""
    if paths["last_ts"].exists():
        return int(paths["last_ts"].read_text().strip())
    return 0


def set_last_ts(paths: dict, ts: int) -> None:
    """Update last seen timestamp."""
    paths["last_ts"].write_text(str(ts))


def read_inbox(paths: dict, since_ts: int = None, limit: int = 50, include_replay: bool = False) -> list:
    """Read messages from inbox, optionally filtering by timestamp."""
    if since_ts is None:
        since_ts = get_last_ts(paths)

    messages = []
    if not paths["inbox"].exists():
        return messages

    with open(paths["inbox"]) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                ts = msg.get("ts", 0)
                is_replay = msg.get("replay", False)

                if ts > since_ts and (include_replay or not is_replay):
                    messages.append(msg)
            except json.JSONDecodeError:
                continue

    # Sort by timestamp and limit
    messages.sort(key=lambda m: m.get("ts", 0))
    return messages[-limit:] if limit else messages


def send_message(paths: dict, to: str, content: str) -> None:
    """Send a message by appending to outbox."""
    msg = {"to": to, "content": content}
    with open(paths["outbox"], "a") as f:
        f.write(json.dumps(msg) + "\n")


def check_new(paths: dict, update_ts: bool = True) -> list:
    """Check for new messages and optionally update timestamp."""
    messages = read_inbox(paths)

    if messages and update_ts:
        max_ts = max(m.get("ts", 0) for m in messages)
        set_last_ts(paths, max_ts)

    return messages


def main():
    parser = argparse.ArgumentParser(description="AgentChat daemon helper")
    parser.add_argument("--daemon-dir", type=Path, default=DEFAULT_DAEMON_DIR,
                        help="Daemon directory path")

    subparsers = parser.add_subparsers(dest="command", required=True)

    # read command
    read_p = subparsers.add_parser("read", help="Read inbox messages")
    read_p.add_argument("--since", type=int, help="Only messages after this timestamp")
    read_p.add_argument("--limit", type=int, default=50, help="Max messages to return")
    read_p.add_argument("--replay", action="store_true", help="Include replay messages")
    read_p.add_argument("--all", action="store_true", help="Read all messages (ignore last_ts)")

    # send command
    send_p = subparsers.add_parser("send", help="Send a message")
    send_p.add_argument("to", help="Recipient (#channel or @agent)")
    send_p.add_argument("content", help="Message content")

    # check command - read new and update timestamp
    check_p = subparsers.add_parser("check", help="Check for new messages and update timestamp")
    check_p.add_argument("--no-update", action="store_true", help="Don't update last_ts")

    # ts command - get/set timestamp
    ts_p = subparsers.add_parser("ts", help="Get or set last timestamp")
    ts_p.add_argument("value", nargs="?", type=int, help="Set timestamp to this value")

    args = parser.parse_args()
    paths = get_paths(args.daemon_dir)

    if args.command == "read":
        since = 0 if args.all else (args.since if args.since else get_last_ts(paths))
        messages = read_inbox(paths, since_ts=since, limit=args.limit, include_replay=args.replay)
        for msg in messages:
            print(json.dumps(msg))

    elif args.command == "send":
        send_message(paths, args.to, args.content)
        print(f"Sent to {args.to}")

    elif args.command == "check":
        messages = check_new(paths, update_ts=not args.no_update)
        for msg in messages:
            print(json.dumps(msg))
        if not messages:
            print("No new messages", file=sys.stderr)

    elif args.command == "ts":
        if args.value is not None:
            set_last_ts(paths, args.value)
            print(f"Set last_ts to {args.value}")
        else:
            print(get_last_ts(paths))


if __name__ == "__main__":
    main()
