"""The project backlog, addressed by identity rather than by position.

A todo's position is not a name for it. The dashboard sorts unfinished todos to the top
on load, `lb todo add` appends to the stored order, and neither writes the other's order
back — so a position means one todo to the browser and another to the store. Anything
that acts on a single todo (launching it as a worker, moving it to another project) goes
through ``find`` with an id, so it acts on the todo the caller meant.

Ids are backfilled on read: a backlog written before this existed gets ids the first time
it is opened, and keeps them.
"""

import uuid


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _with_ids(rows: list[dict]) -> tuple[list[dict], bool]:
    seen: set[str] = set()
    out: list[dict] = []
    changed = False
    for row in rows:
        todo_id = row.get("id")
        # A duplicated id is as unusable as a missing one — two rows answering to the
        # same name put us back to guessing which was meant.
        if not todo_id or todo_id in seen:
            todo_id = _new_id()
            changed = True
        seen.add(todo_id)
        out.append({**row, "id": todo_id})
    return out, changed


def load(table) -> list[dict]:
    """Every todo in the project, each carrying a stable id."""
    from lumbergh.db_utils import get_single_document_items, save_single_document_items

    rows, changed = _with_ids(get_single_document_items(table))
    if changed:
        save_single_document_items(table, rows)
    return rows


def save(table, rows: list[dict]) -> list[dict]:
    """Persist the backlog, minting ids for rows that arrived without one."""
    from lumbergh.db_utils import save_single_document_items

    stamped, _ = _with_ids(rows)
    save_single_document_items(table, stamped)
    return stamped


def find(rows: list[dict], todo_id: str) -> dict | None:
    return next((row for row in rows if row.get("id") == todo_id), None)


def index_of(rows: list[dict], todo_id: str) -> int | None:
    return next((i for i, row in enumerate(rows) if row.get("id") == todo_id), None)
