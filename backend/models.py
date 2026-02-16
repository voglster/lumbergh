"""
Shared Pydantic models for the Lumbergh backend.
"""

from typing import Literal

from pydantic import BaseModel


class TmuxCommand(BaseModel):
    """A tmux window navigation command."""

    command: Literal["next-window", "prev-window", "new-window"]


class SendInput(BaseModel):
    """Input for sending text to a terminal session."""

    text: str
    send_enter: bool = True


class CommitInput(BaseModel):
    """Input for creating a git commit."""

    message: str


class CheckoutInput(BaseModel):
    """Input for checking out a git branch."""

    branch: str


class TodoItem(BaseModel):
    """A single todo item."""

    text: str
    done: bool


class TodoList(BaseModel):
    """A list of todo items."""

    todos: list[TodoItem]


class ScratchpadContent(BaseModel):
    """Content for the scratchpad."""

    content: str


class PromptTemplate(BaseModel):
    """A reusable prompt template."""

    id: str
    name: str  # Short name for button
    prompt: str  # Full prompt text


class PromptTemplateList(BaseModel):
    """A list of prompt templates."""

    templates: list[PromptTemplate]


class CreateSessionRequest(BaseModel):
    """Request to create a new tmux session."""

    name: str
    workdir: str
    description: str = ""


class SessionUpdate(BaseModel):
    """Request to update session metadata."""

    displayName: str | None = None
