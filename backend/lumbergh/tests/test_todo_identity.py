"""Todos are addressed by a stable id, never by their position in the list.

The dashboard shows unfinished todos first; the store keeps them in the order they were
written, and `lb todo add` appends. Those two orders diverge the moment a todo is added
after an older one was completed, and every endpoint that took a position then acted on
a different todo than the one under the cursor — silently, in the case of a move.
"""

from tinydb import TinyDB

from lumbergh import todos as todo_store
from lumbergh.db_utils import get_single_document_items


def _table(tmp_path, items, name="p.json"):
    db = TinyDB(tmp_path / name)
    table = db.table("todos")
    table.insert({"items": items})
    return table


def test_reading_gives_every_todo_an_id(tmp_path):
    table = _table(tmp_path, [{"text": "first", "done": False}, {"text": "second", "done": True}])

    rows = todo_store.load(table)

    assert all(row["id"] for row in rows)
    assert rows[0]["id"] != rows[1]["id"]


def test_backfilled_ids_are_written_back_so_they_survive_the_next_read(tmp_path):
    table = _table(tmp_path, [{"text": "first", "done": False}])

    first = todo_store.load(table)

    assert todo_store.load(table)[0]["id"] == first[0]["id"]
    assert get_single_document_items(table)[0]["id"] == first[0]["id"]


def test_an_id_survives_reordering(tmp_path):
    table = _table(tmp_path, [{"text": "first", "done": False}, {"text": "second", "done": False}])
    rows = todo_store.load(table)

    todo_store.save(table, list(reversed(rows)))

    assert [row["text"] for row in todo_store.load(table)] == ["second", "first"]
    assert todo_store.load(table)[1]["id"] == rows[0]["id"]


def test_find_picks_the_todo_by_id_not_by_where_it_sits(tmp_path):
    table = _table(tmp_path, [{"text": "first", "done": False}, {"text": "second", "done": False}])
    rows = todo_store.load(table)

    assert todo_store.find(rows, rows[1]["id"])["text"] == "second"
    assert todo_store.find(rows, "nothing-like-this") is None
