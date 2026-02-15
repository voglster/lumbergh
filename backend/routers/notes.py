"""
Notes router - Todo list, Scratchpad, and Prompt Templates endpoints.
Stores data in ~/.config/lumbergh/projects/{hash}.json (outside of git).
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException

from db_utils import (
    get_global_db,
    get_project_db,
    get_single_document_items,
    save_single_document_items,
)
from models import PromptTemplateList, ScratchpadContent, TodoList

router = APIRouter(prefix="/api", tags=["notes"])

# Project root (parent of backend/)
PROJECT_ROOT = Path(__file__).parent.parent.parent

# Get project-specific database
db = get_project_db(PROJECT_ROOT)
global_db = get_global_db()

# Use TinyDB tables for cleaner separation
todos_table = db.table("todos")
scratchpad_table = db.table("scratchpad")
prompts_table = db.table("prompts")
global_prompts_table = global_db.table("prompts")


# --- Todo Endpoints ---


@router.get("/todos")
async def get_todos():
    """Get all todo items."""
    try:
        todos = get_single_document_items(todos_table)
        return {"todos": todos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/todos")
async def save_todos(todo_list: TodoList):
    """Save todo items."""
    try:
        todos = [{"text": t.text, "done": t.done} for t in todo_list.todos]
        save_single_document_items(todos_table, todos)
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
        templates = get_single_document_items(prompts_table)
        return {"templates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prompts")
async def save_prompts(template_list: PromptTemplateList):
    """Save project-specific prompt templates (for reorder/bulk update)."""
    try:
        templates = [
            {"id": t.id, "name": t.name, "prompt": t.prompt} for t in template_list.templates
        ]
        save_single_document_items(prompts_table, templates)
        return {"templates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/global/prompts")
async def get_global_prompts():
    """Get global prompt templates."""
    try:
        templates = get_single_document_items(global_prompts_table)
        return {"templates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/global/prompts")
async def save_global_prompts(template_list: PromptTemplateList):
    """Save global prompt templates (for reorder/bulk update)."""
    try:
        templates = [
            {"id": t.id, "name": t.name, "prompt": t.prompt} for t in template_list.templates
        ]
        save_single_document_items(global_prompts_table, templates)
        return {"templates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prompts/{template_id}/copy-to-global")
async def copy_prompt_to_global(template_id: str):
    """Copy a project template to global, remove from project."""
    try:
        project_templates = get_single_document_items(prompts_table)

        template_to_copy = None
        remaining_templates = []
        for t in project_templates:
            if t["id"] == template_id:
                template_to_copy = t
            else:
                remaining_templates.append(t)

        if not template_to_copy:
            raise HTTPException(status_code=404, detail="Template not found")

        global_templates = get_single_document_items(global_prompts_table)
        new_template = {
            "id": str(uuid.uuid4()),
            "name": template_to_copy["name"],
            "prompt": template_to_copy["prompt"],
        }
        global_templates.append(new_template)

        save_single_document_items(global_prompts_table, global_templates)
        save_single_document_items(prompts_table, remaining_templates)

        return {"success": True, "template": new_template}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/global/prompts/{template_id}/copy-to-project")
async def copy_global_prompt_to_project(template_id: str):
    """Copy a global template to project (keeps both)."""
    try:
        global_templates = get_single_document_items(global_prompts_table)

        template_to_copy = None
        for t in global_templates:
            if t["id"] == template_id:
                template_to_copy = t
                break

        if not template_to_copy:
            raise HTTPException(status_code=404, detail="Template not found")

        project_templates = get_single_document_items(prompts_table)
        new_template = {
            "id": str(uuid.uuid4()),
            "name": template_to_copy["name"],
            "prompt": template_to_copy["prompt"],
        }
        project_templates.append(new_template)

        save_single_document_items(prompts_table, project_templates)

        return {"success": True, "template": new_template}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
