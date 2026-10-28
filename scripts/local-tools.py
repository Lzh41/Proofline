#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把本机 localhost 看板登记进 Proofline 的「工具」页。

用法：
    python scripts/local-tools.py list
    python scripts/local-tools.py add --name "xx 看板" --url "http://127.0.0.1:8801/dashboard.html" \
        --category 评测 --description "它看什么" --launch "python serve.py" --cwd "G:\\proj"
    python scripts/local-tools.py remove --id local-tool-8801
    python scripts/local-tools.py remove --url "http://127.0.0.1:8801/dashboard.html"

行为说明：
    1. 直接改 SQLite 里 app_state.snapshot_json 的 localTools 数组，其余字段原样保留。
    2. 库里还没有 localTools 字段时（用户没打开过 0.1.17），先用
       src/data/localToolSeeds.json 的清单铺底，再追加新条目——否则应用加载时
       会因为「字段已存在」而跳过内置清单，用户会莫名少掉六条工具。
    3. Proofline 正在运行时拒绝写入：应用只在启动时读一次快照，运行期间的保存
       会把内存里的旧列表写回库，脚本刚加的东西会被抹掉。
    4. 每次写入前把原 snapshot_json 备份到数据库同目录，只保留最近 3 份。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

APP_EXE = "proofline.exe"
# macOS 上进程名是 .app 里的可执行文件名（Proofline），没有 .exe 后缀。
APP_PROCESS_NAME = "Proofline"
SEED_FILE = Path(__file__).resolve().parent.parent / "src" / "data" / "localToolSeeds.json"


def data_roots() -> list[Path]:
    """应用数据目录的候选父目录：Windows 是 %LOCALAPPDATA%，macOS 是 ~/Library/Application Support。

    Rust 侧用的是 dirs::data_local_dir()，两边正好对应这两个位置。
    """
    roots: list[Path] = []
    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        roots.append(Path(local))
    if sys.platform == "darwin":
        roots.append(Path.home() / "Library" / "Application Support")
    return roots


def find_database() -> Path | None:
    candidates: list[Path] = []
    env_dir = os.environ.get("PROOFLINE_DATA_DIR", "").strip()
    if env_dir:
        candidates += [Path(env_dir) / "proofline.sqlite", Path(env_dir) / "xiti.sqlite"]
    for root in data_roots():
        candidates += [
            root / "Proofline" / "proofline.sqlite",
            root / "Xiti" / "xiti.sqlite",
        ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def app_is_running() -> bool:
    if sys.platform == "darwin":
        try:
            result = subprocess.run(
                ["pgrep", "-x", APP_PROCESS_NAME],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except Exception:
            return False
        return result.returncode == 0
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {APP_EXE}", "/NH"],
            capture_output=True,
            text=True,
            encoding="gbk",
            errors="replace",
            timeout=10,
        )
    except Exception:
        return False
    return APP_EXE in (result.stdout or "").lower()


def load_seeds() -> list[dict]:
    rows = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    now = int(time.time() * 1000)
    return [{**row, "origin": "seed", "createdAt": now, "updatedAt": now} for row in rows]


def normalize_url(value: str) -> str:
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return value.strip().lower()
    host = (parsed.hostname or "").lower()
    port = f":{parsed.port}" if parsed.port else ""
    path = (parsed.path or "/").rstrip("/") or "/"
    return f"{parsed.scheme}://{host}{port}{path}".lower()


def port_from_url(value: str) -> int | None:
    try:
        port = urlparse(value).port
    except ValueError:
        return None
    return port if port else None


def open_snapshot(database: Path) -> tuple[sqlite3.Connection, dict]:
    connection = sqlite3.connect(str(database))
    row = connection.execute("SELECT snapshot_json FROM app_state WHERE id = 1").fetchone()
    if not row:
        connection.close()
        raise SystemExit(
            "库里还没有数据快照（app_state 空表）。先打开一次 Proofline 让它初始化，再回来登记。"
        )
    return connection, json.loads(row[0])


def backup_snapshot(database: Path, raw: str) -> None:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = database.with_name(f"{database.name}.snapshot-bak-{stamp}.json")
    target.write_text(raw, encoding="utf-8")
    stale = sorted(database.parent.glob(f"{database.name}.snapshot-bak-*.json"))
    for path in stale[:-3]:
        path.unlink(missing_ok=True)


def save(connection: sqlite3.Connection, snapshot: dict, raw_before: str, database: Path) -> None:
    backup_snapshot(database, raw_before)
    snapshot["updatedAt"] = int(time.time() * 1000)
    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    with connection:
        connection.execute(
            "UPDATE app_state SET snapshot_json = ?, updated_at = ? WHERE id = 1",
            (payload, int(time.time() * 1000)),
        )


def read_tools(snapshot: dict) -> tuple[list[dict], bool]:
    """返回 (工具列表, 库里原本是否已有该字段)。"""
    if "localTools" not in snapshot:
        return load_seeds(), False
    tools = snapshot.get("localTools")
    return (tools if isinstance(tools, list) else []), True


def command_add(args: argparse.Namespace) -> int:
    database = find_database()
    if not database:
        print("找不到 Proofline 数据库，先打开一次应用。", file=sys.stderr)
        return 2
    if app_is_running() and not args.force:
        print(
            "Proofline 正在运行，先完全退出再登记：应用启动时只读一次快照，"
            "运行期间保存会用内存里的旧列表覆盖这次写入。",
            file=sys.stderr,
        )
        return 3

    connection, snapshot = open_snapshot(database)
    raw_before = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    tools, existed = read_tools(snapshot)
    seeded = False
    if not existed:
        seeded = True

    url = args.url.strip()
    if not url.startswith(("http://", "https://")):
        print("地址要以 http:// 或 https:// 开头。", file=sys.stderr)
        return 4

    port = args.port if args.port is not None else port_from_url(url)
    key = normalize_url(url)
    existing = next((item for item in tools if normalize_url(str(item.get("url", ""))) == key), None)
    now = int(time.time() * 1000)

    tool = {
        "id": args.id or (existing or {}).get("id") or f"local-tool-{port or uuid.uuid4().hex[:8]}",
        "name": args.name.strip(),
        "category": (args.category or "其他").strip(),
        "description": (args.description or "").strip(),
        "url": url,
        "origin": (existing or {}).get("origin") or "manual",
        "createdAt": (existing or {}).get("createdAt") or now,
        "updatedAt": now,
    }
    if port:
        tool["port"] = int(port)
    if args.launch and args.launch.strip():
        tool["launchCommand"] = args.launch.strip()
    if args.cwd and args.cwd.strip():
        tool["workingDirectory"] = args.cwd.strip()
    # 更新已有条目时不要把手动置顶弄丢：只有显式 --unpin 才取消。
    if getattr(args, "pin", False):
        tool["pinned"] = True
    elif not getattr(args, "unpin", False) and (existing or {}).get("pinned"):
        tool["pinned"] = True

    if existing:
        tools = [tool if item is existing else item for item in tools]
        action = "已更新"
    else:
        tools = [tool, *tools]
        action = "已登记"

    snapshot["localTools"] = tools
    save(connection, snapshot, raw_before, database)
    connection.close()

    if seeded:
        print("库里原本没有工具清单，已用内置清单铺底。")
    print(f"{action}：{tool['name']}  ->  {url}")
    print(f"条目 id：{tool['id']}    数据库：{database}")
    print("重启 Proofline 就能在「工具」页看到。")
    return 0


def command_remove(args: argparse.Namespace) -> int:
    database = find_database()
    if not database:
        print("找不到 Proofline 数据库。", file=sys.stderr)
        return 2
    if app_is_running() and not args.force:
        print("Proofline 正在运行，先完全退出再改。", file=sys.stderr)
        return 3

    connection, snapshot = open_snapshot(database)
    raw_before = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    tools, existed = read_tools(snapshot)
    if not existed:
        connection.close()
        print("库里还没有工具清单，没什么可删的。")
        return 0

    key = normalize_url(args.url) if args.url else None
    kept = [
        item for item in tools
        if not (item.get("id") == args.id or (key and normalize_url(str(item.get("url", ""))) == key))
    ]
    if len(kept) == len(tools):
        connection.close()
        print("没找到匹配的条目，什么都没改。")
        return 0

    snapshot["localTools"] = kept
    save(connection, snapshot, raw_before, database)
    connection.close()
    print(f"已移除 {len(tools) - len(kept)} 条，剩 {len(kept)} 条。")
    return 0


def command_list(_: argparse.Namespace) -> int:
    database = find_database()
    if not database:
        print("找不到 Proofline 数据库，先打开一次应用。", file=sys.stderr)
        return 2
    connection, snapshot = open_snapshot(database)
    tools, existed = read_tools(snapshot)
    connection.close()

    origin = "库里的清单" if existed else "库中尚无清单，以下为内置种子"
    print(f"数据库：{database}")
    print(f"来源：{origin}    共 {len(tools)} 条")
    for tool in tools:
        port = tool.get("port", "-")
        print(f"  [{port}] {tool.get('name')}  <{tool.get('url')}>  id={tool.get('id')}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="登记本机看板到 Proofline 工具页")
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="新增或按地址更新一条")
    add.add_argument("--name", required=True)
    add.add_argument("--url", required=True)
    add.add_argument("--port", type=int, default=None)
    add.add_argument("--category", default="其他")
    add.add_argument("--description", default="")
    add.add_argument("--launch", default="")
    add.add_argument("--cwd", default="")
    add.add_argument("--id", default=None)
    add.add_argument("--pin", action="store_true", help="置顶")
    add.add_argument("--unpin", action="store_true", help="取消置顶")
    add.add_argument("--force", action="store_true", help="应用在运行时也照写（不推荐）")
    add.set_defaults(func=command_add)

    remove = sub.add_parser("remove", help="按 id 或地址移除")
    remove.add_argument("--id", default=None)
    remove.add_argument("--url", default=None)
    remove.add_argument("--force", action="store_true")
    remove.set_defaults(func=command_remove)

    listing = sub.add_parser("list", help="看看现在都登记了什么")
    listing.set_defaults(func=command_list)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
