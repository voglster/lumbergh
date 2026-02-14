"""
Notes router - Todo list, Scratchpad, and Prompt Templates endpoints.
Stores data in ~/.config/lumbergh/projects/{hash}.json (outside of git).
"""

import hashlib
import uuid
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

# Global database for cross-project data
global_db = TinyDB(CONFIG_DIR / "global.json")


# --- Models ---

class TodoItem(BaseModel):
    text: str
    done: bool


class TodoList(BaseModel):
    todos: list[TodoItem]


class ScratchpadContent(BaseModel):
    content: str


class PromptTemplate(BaseModel):
    id: str
    name: str       # Short name for button
    prompt: str     # Full prompt text


class PromptTemplateList(BaseModel):
    templates: list[PromptTemplate]


# --- Todo Endpoints ---

# Use TinyDB tables for cleaner separation
todos_table = db.table("todos")
scratchpad_table = db.table("scratchpad")
prompts_table = db.table("prompts")
global_prompts_table = global_db.table("prompts")


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


# --- Prompt Templates Endpoints ---

@router.get("/prompts")
async def get_prompts():
    """Get project-specific prompt templates."""
    try:
        all_prompts = prompts_table.all()
        if all_prompts:
            return {"templates": all_prompts[0].get("items", [])}
        return {"templates": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prompts")
async def save_prompts(template_list: PromptTemplateList):
    """Save project-specific prompt templates (for reorder/bulk update)."""
    try:
        templates = [{"id": t.id, "name": t.name, "prompt": t.prompt} for t in template_list.templates]
        prompts_table.truncate()
        prompts_table.insert({"items": templates})
        return {"templates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/global/prompts")
async def get_global_prompts():
    """Get global prompt templates."""
    try:
        all_prompts = global_prompts_table.all()
        if all_prompts:
            return {"templates": all_prompts[0].get("items", [])}
        return {"templates": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/global/prompts")
async def save_global_prompts(template_list: PromptTemplateList):
    """Save global prompt templates (for reorder/bulk update)."""
    try:
        templates = [{"id": t.id, "name": t.name, "prompt": t.prompt} for t in template_list.templates]
        global_prompts_table.truncate()
        global_prompts_table.insert({"items": templates})
        return {"templates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prompts/{template_id}/copy-to-global")
async def copy_prompt_to_global(template_id: str):
    """Copy a project template to global, remove from project."""
    try:
        # Get project templates
        all_prompts = prompts_table.all()
        project_templates = all_prompts[0].get("items", []) if all_prompts else []

        # Find the template to copy
        template_to_copy = None
        remaining_templates = []
        for t in project_templates:
            if t["id"] == template_id:
                template_to_copy = t
            else:
                remaining_templates.append(t)

        if not template_to_copy:
            raise HTTPException(status_code=404, detail="Template not found")

        # Add to global with new ID
        global_all = global_prompts_table.all()
        global_templates = global_all[0].get("items", []) if global_all else []
        new_template = {
            "id": str(uuid.uuid4()),
            "name": template_to_copy["name"],
            "prompt": template_to_copy["prompt"]
        }
        global_templates.append(new_template)

        # Save both
        global_prompts_table.truncate()
        global_prompts_table.insert({"items": global_templates})

        prompts_table.truncate()
        prompts_table.insert({"items": remaining_templates})

        return {"success": True, "template": new_template}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/global/prompts/{template_id}/copy-to-project")
async def copy_global_prompt_to_project(template_id: str):
    """Copy a global template to project (keeps both)."""
    try:
        # Get global templates
        global_all = global_prompts_table.all()
        global_templates = global_all[0].get("items", []) if global_all else []

        # Find the template to copy
        template_to_copy = None
        for t in global_templates:
            if t["id"] == template_id:
                template_to_copy = t
                break

        if not template_to_copy:
            raise HTTPException(status_code=404, detail="Template not found")

        # Add to project with new ID
        all_prompts = prompts_table.all()
        project_templates = all_prompts[0].get("items", []) if all_prompts else []
        new_template = {
            "id": str(uuid.uuid4()),
            "name": template_to_copy["name"],
            "prompt": template_to_copy["prompt"]
        }
        project_templates.append(new_template)

        # Save project templates
        prompts_table.truncate()
        prompts_table.insert({"items": project_templates})

        return {"success": True, "template": new_template}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
