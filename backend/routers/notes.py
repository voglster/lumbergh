"""
Notes router - Global prompt templates endpoints.
Project-specific prompts are now handled via session-scoped endpoints in sessions.py.
"""

from fastapi import APIRouter, HTTPException

from db_utils import (
    get_global_db,
    get_single_document_items,
    save_single_document_items,
)
from models import PromptTemplateList

router = APIRouter(prefix="/api", tags=["notes"])

# Global database for shared templates
global_db = get_global_db()
global_prompts_table = global_db.table("prompts")


# --- Global Prompt Templates Endpoints ---


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
