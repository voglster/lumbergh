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


class AmendInput(BaseModel):
    """Input for amending a git commit."""

    message: str | None = None


class CheckoutInput(BaseModel):
    """Input for checking out a git branch."""

    branch: str
    reset_to: str | None = None


class CreateBranchInput(BaseModel):
    """Input for creating a branch at a specific commit."""

    name: str
    start_point: str | None = None


class BranchTargetInput(BaseModel):
    """Input specifying a target branch for fast-forward or rebase."""

    branch: str


class ResetToInput(BaseModel):
    """Input for resetting to a specific commit."""

    hash: str
    mode: str = "hard"  # "hard" | "soft"


class RewordInput(BaseModel):
    """Input for rewording a commit message."""

    hash: str
    message: str


class TodoItem(BaseModel):
    """A single todo item."""

    text: str
    done: bool
    description: str | None = None


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


class WorktreeConfig(BaseModel):
    """Configuration for creating a worktree session."""

    parent_repo: str  # Path to parent git repository
    branch: str  # Branch name to checkout/create
    reset_to: str | None = None  # If set, reset branch to this commit after checkout
    create_branch: bool = False
    base_branch: str | None = None


class CreateSessionRequest(BaseModel):
    """Request to create a new tmux session."""

    name: str = ""  # Auto-derived from workdir if empty
    workdir: str | None = None  # Required for direct, ignored for worktree
    description: str = ""
    mode: Literal["direct", "worktree"] = "direct"
    worktree: WorktreeConfig | None = None
    init_repo: bool = False  # Create dir + git init if it doesn't exist
    agent_provider: str | None = None  # Override global default agent provider


class SessionUpdate(BaseModel):
    """Request to update session metadata."""

    displayName: str | None = None  # noqa: N815 - API field name
    description: str | None = None
    paused: bool | None = None
    agentProvider: str | None = None  # noqa: N815 - API field name


class TodoMoveRequest(BaseModel):
    """Request to move a todo between sessions."""

    target_session: str
    todo_index: int


class CherryPickInput(BaseModel):
    """Input for cherry-picking a commit."""

    hash: str


class RevertFileInput(BaseModel):
    """Input for reverting a single file."""

    path: str


class DeleteBranchInput(BaseModel):
    """Input for deleting a git branch."""

    branch: str
    delete_remote: bool = False


class StatusSummaryInput(BaseModel):
    """Input for generating a status summary."""

    text: str
