"""
Notes router - Todo list and Scratchpad endpoints.
Stores data in ~/.config/lumbergh/projects/{hash}.json (outside of git).
"""

import hashlib
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tinydb import TinyDB

router = APIRouter(prefix="/api", tags=["notes"])

# Project root (parent of backend/)
PROJECT_ROOT = Path(__file__).parent.parent.parent

# Database setup - store in ~/.config/lumbergh/projects/
CONFIG_DIR = Path.home() / ".config" / "lumbergh"
PROJECTS_DIR = CONFIG_DIR / "projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

# Each project gets its own db file
PROJECT_HASH = hashlib.md5(str(PROJECT_ROOT.resolve()).encode()).hexdigest()[:12]
db = TinyDB(PROJECTS_DIR / f"{PROJECT_HASH}.json")


# --- Models ---

class TodoItem(BaseModel):
    text: str
    done: bool


class TodoList(BaseModel):
    todos: list[TodoItem]


class ScratchpadContent(BaseModel):
    content: str


# --- Todo Endpoints ---

# Use TinyDB tables for cleaner separation
todos_table = db.table("todos")
scratchpad_table = db.table("scratchpad")


@router.get("/todos")
async def get_todos():
    """Get all todo items."""
    try:
        all_todos = todos_table.all()
        if all_todos:
            return {"todos": all_todos[0].get("items", [])}
        return {"todos": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/todos")
async def save_todos(todo_list: TodoList):
    """Save todo items."""
    try:
        todos = [{"text": t.text, "done": t.done} for t in todo_list.todos]
        todos_table.truncate()
        todos_table.insert({"items": todos})
        return {"todos": todos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Scratchpad Endpoints ---

@router.get("/scratchpad")
async def get_scratchpad():
    """Get scratchpad content."""
    try:
        all_content = scratchpad_table.all()
        if all_content:
            return {"content": all_content[0].get("content", "")}
        return {"content": ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scratchpad")
async def save_scratchpad(data: ScratchpadContent):
    """Save scratchpad content."""
    try:
        scratchpad_table.truncate()
        scratchpad_table.insert({"content": data.content})
        return {"content": data.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
