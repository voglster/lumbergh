"""
Tests for db_utils module.
"""

from db_utils import (
    get_single_document_items,
    get_single_document_value,
    save_single_document_items,
    save_single_document_value,
)


class TestGetSingleDocumentItems:
    def test_returns_empty_list_when_empty(self, mock_tinydb):
        table = mock_tinydb.table("test")
        result = get_single_document_items(table)
        assert result == []

    def test_returns_items(self, mock_tinydb):
        table = mock_tinydb.table("test")
        table.insert({"items": [{"id": 1}, {"id": 2}]})

        result = get_single_document_items(table)
        assert len(result) == 2
        assert result[0]["id"] == 1

    def test_custom_key(self, mock_tinydb):
        table = mock_tinydb.table("test")
        table.insert({"todos": [{"text": "task1"}]})

        result = get_single_document_items(table, key="todos")
        assert len(result) == 1
        assert result[0]["text"] == "task1"


class TestSaveSingleDocumentItems:
    def test_saves_items(self, mock_tinydb):
        table = mock_tinydb.table("test")
        items = [{"id": 1}, {"id": 2}, {"id": 3}]

        result = save_single_document_items(table, items)

        assert result == items
        assert get_single_document_items(table) == items

    def test_overwrites_existing(self, mock_tinydb):
        table = mock_tinydb.table("test")

        # Save initial items
        save_single_document_items(table, [{"id": 1}])

        # Save new items
        new_items = [{"id": 2}, {"id": 3}]
        save_single_document_items(table, new_items)

        result = get_single_document_items(table)
        assert result == new_items

    def test_custom_key(self, mock_tinydb):
        table = mock_tinydb.table("test")
        items = [{"text": "task1"}]

        save_single_document_items(table, items, key="todos")

        result = get_single_document_items(table, key="todos")
        assert result == items


class TestGetSingleDocumentValue:
    def test_returns_default_when_empty(self, mock_tinydb):
        table = mock_tinydb.table("test")
        result = get_single_document_value(table, "content", default="")
        assert result == ""

    def test_returns_value(self, mock_tinydb):
        table = mock_tinydb.table("test")
        table.insert({"content": "hello world"})

        result = get_single_document_value(table, "content")
        assert result == "hello world"

    def test_returns_none_when_key_missing(self, mock_tinydb):
        table = mock_tinydb.table("test")
        table.insert({"other_key": "value"})

        result = get_single_document_value(table, "content")
        assert result is None


class TestSaveSingleDocumentValue:
    def test_saves_value(self, mock_tinydb):
        table = mock_tinydb.table("test")

        save_single_document_value(table, "content", "hello world")

        result = get_single_document_value(table, "content")
        assert result == "hello world"

    def test_overwrites_existing(self, mock_tinydb):
        table = mock_tinydb.table("test")

        save_single_document_value(table, "content", "first")
        save_single_document_value(table, "content", "second")

        result = get_single_document_value(table, "content")
        assert result == "second"
