"""`/api/bill/todos` — the repo-scoped view of a project's backlog.

The dashboard reaches todos through a session; an agent has only the repo it is sitting
in. Same storage, different key.
"""

import pytest
from fastapi import HTTPException
from tinydb import TinyDB

from lumbergh.routers import bill


@pytest.fixture
def project_db(tmp_path, monkeypatch):
    dbs: dict[str, TinyDB] = {}

    def fake_get_project_db(path):
        key = str(path)
        if key not in dbs:
            dbs[key] = TinyDB(tmp_path / f"{abs(hash(key))}.json")
        return dbs[key]

    monkeypatch.setattr(bill, "get_project_db", fake_get_project_db)
    return dbs


def _repo(tmp_path, name="repo"):
    repo = tmp_path / name
    repo.mkdir()
    return str(repo)


@pytest.mark.usefixtures("project_db")
def test_todos_starts_empty(tmp_path):
    assert bill.bill_todos(repo=_repo(tmp_path)) == {"todos": []}


@pytest.mark.usefixtures("project_db")
def test_add_appends_and_list_reads_it_back(tmp_path):
    repo = _repo(tmp_path)
    added = bill.add_bill_todo(bill.TodoAddBody(repo=repo, text="Fix the graph", description="d"))

    assert added["todo"] == {
        "id": added["todo"]["id"],
        "text": "Fix the graph",
        "done": False,
        "description": "d",
    }
    assert added["todo"]["id"]
    assert added["index"] == 1
    assert bill.bill_todos(repo=repo)["todos"] == [added["todo"]]


@pytest.mark.usefixtures("project_db")
def test_todos_are_scoped_to_their_repo(tmp_path):
    one, two = _repo(tmp_path, "one"), _repo(tmp_path, "two")
    bill.add_bill_todo(bill.TodoAddBody(repo=one, text="only mine"))

    assert bill.bill_todos(repo=two)["todos"] == []
    assert [t["text"] for t in bill.bill_todos(repo=one)["todos"]] == ["only mine"]


@pytest.mark.usefixtures("project_db")
def test_done_ticks_off_the_one_based_index(tmp_path):
    repo = _repo(tmp_path)
    bill.add_bill_todo(bill.TodoAddBody(repo=repo, text="first"))
    bill.add_bill_todo(bill.TodoAddBody(repo=repo, text="second"))

    updated = bill.finish_bill_todo(bill.TodoDoneBody(repo=repo, index=2))

    assert updated["todo"]["text"] == "second"
    assert updated["todo"]["done"] is True
    assert [t["done"] for t in bill.bill_todos(repo=repo)["todos"]] == [False, True]


@pytest.mark.usefixtures("project_db")
def test_done_indexes_the_whole_list_including_finished_items(tmp_path):
    """What `lb todo` prints and what `done <n>` accepts have to be the same numbers."""
    repo = _repo(tmp_path)
    for text in ("first", "second"):
        bill.add_bill_todo(bill.TodoAddBody(repo=repo, text=text))
    bill.finish_bill_todo(bill.TodoDoneBody(repo=repo, index=1))

    assert bill.finish_bill_todo(bill.TodoDoneBody(repo=repo, index=2))["todo"]["text"] == "second"


@pytest.mark.usefixtures("project_db")
def test_done_out_of_range_names_the_valid_range(tmp_path):
    repo = _repo(tmp_path)
    bill.add_bill_todo(bill.TodoAddBody(repo=repo, text="only one"))

    with pytest.raises(HTTPException) as exc:
        bill.finish_bill_todo(bill.TodoDoneBody(repo=repo, index=2))

    assert exc.value.status_code == 400
    assert "1" in exc.value.detail["error"]


@pytest.mark.usefixtures("project_db")
def test_done_on_an_empty_backlog_is_refused(tmp_path):
    with pytest.raises(HTTPException):
        bill.finish_bill_todo(bill.TodoDoneBody(repo=_repo(tmp_path), index=1))


@pytest.mark.usefixtures("project_db")
def test_add_refuses_empty_text(tmp_path):
    with pytest.raises(HTTPException):
        bill.add_bill_todo(bill.TodoAddBody(repo=_repo(tmp_path), text="   "))


@pytest.mark.usefixtures("project_db")
def test_unknown_repo_is_refused_rather_than_silently_creating_a_backlog(tmp_path):
    with pytest.raises(HTTPException) as exc:
        bill.bill_todos(repo=str(tmp_path / "nope"))

    assert exc.value.status_code == 400


@pytest.mark.usefixtures("project_db")
def test_undo_puts_a_finished_item_back(tmp_path):
    repo = _repo(tmp_path)
    bill.add_bill_todo(bill.TodoAddBody(repo=repo, text="ticked by mistake"))
    bill.finish_bill_todo(bill.TodoDoneBody(repo=repo, index=1))

    reopened = bill.undo_bill_todo(bill.TodoDoneBody(repo=repo, index=1))

    assert reopened["todo"]["done"] is False
    assert bill.bill_todos(repo=repo)["todos"][0]["done"] is False


@pytest.mark.usefixtures("project_db")
def test_undo_on_an_open_item_is_harmless(tmp_path):
    repo = _repo(tmp_path)
    bill.add_bill_todo(bill.TodoAddBody(repo=repo, text="never finished"))

    assert bill.undo_bill_todo(bill.TodoDoneBody(repo=repo, index=1))["todo"]["done"] is False


@pytest.mark.usefixtures("project_db")
def test_undo_indexes_the_same_way_done_does(tmp_path):
    repo = _repo(tmp_path)
    for text in ("first", "second"):
        bill.add_bill_todo(bill.TodoAddBody(repo=repo, text=text))
    bill.finish_bill_todo(bill.TodoDoneBody(repo=repo, index=1))
    bill.finish_bill_todo(bill.TodoDoneBody(repo=repo, index=2))

    bill.undo_bill_todo(bill.TodoDoneBody(repo=repo, index=2))

    assert [t["done"] for t in bill.bill_todos(repo=repo)["todos"]] == [True, False]


@pytest.mark.usefixtures("project_db")
def test_undo_out_of_range_names_the_valid_range(tmp_path):
    repo = _repo(tmp_path)
    bill.add_bill_todo(bill.TodoAddBody(repo=repo, text="only one"))

    with pytest.raises(HTTPException) as exc:
        bill.undo_bill_todo(bill.TodoDoneBody(repo=repo, index=9))

    assert exc.value.status_code == 400
    assert "1" in exc.value.detail["error"]
