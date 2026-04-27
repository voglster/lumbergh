import subprocess
from unittest.mock import MagicMock, patch

import pytest

from lumbergh.routers.sessions import _kill_pane_children, _list_pane_children


@patch("lumbergh.routers.sessions.IS_WINDOWS", True)
@patch("subprocess.run")
def test_kill_pane_children_windows(mock_run):
    """Verify taskkill is called correctly on Windows."""
    pane_pid = "1234"
    
    # Mock success
    mock_run.return_value = MagicMock(returncode=0)
    
    _kill_pane_children(pane_pid)
    
    # Check that taskkill was called
    mock_run.assert_called_once()
    args, kwargs = mock_run.call_args
    cmd = args[0]
    
    assert cmd == ["taskkill", "/F", "/T", "/PID", "1234"]
    assert kwargs["encoding"] == "utf-8"
    assert kwargs["errors"] == "replace"


@patch("lumbergh.routers.sessions.IS_WINDOWS", False)
@patch("subprocess.run")
def test_kill_pane_children_unix(mock_run):
    """Verify pkill is called correctly on Unix."""
    pane_pid = "1234"
    
    # Mock success
    mock_run.return_value = MagicMock(returncode=0)
    
    _kill_pane_children(pane_pid)
    
    # Check that pkill was called
    mock_run.assert_called_once()
    args, kwargs = mock_run.call_args
    cmd = args[0]
    
    assert cmd == ["pkill", "-TERM", "-P", "1234"]
    assert kwargs["encoding"] == "utf-8"
    assert kwargs["errors"] == "replace"


@patch("lumbergh.routers.sessions.IS_WINDOWS", True)
@patch("subprocess.run")
def test_list_pane_children_windows_multiple(mock_run):
    """Verify PowerShell parsing for multiple children."""
    import json
    mock_run.return_value = MagicMock(
        returncode=0,
        stdout=json.dumps([
            {"ProcessId": 5001, "Caption": "cmd.exe"},
            {"ProcessId": 5002, "Caption": "powershell.exe"}
        ])
    )
    
    children = _list_pane_children("1234")
    assert len(children) == 2
    assert children[0] == {"pid": 5001, "command": "cmd.exe"}
    assert children[1] == {"pid": 5002, "command": "powershell.exe"}


@patch("lumbergh.routers.sessions.IS_WINDOWS", True)
@patch("subprocess.run")
def test_list_pane_children_windows_single(mock_run):
    """Verify PowerShell parsing for a single child (dict result)."""
    import json
    mock_run.return_value = MagicMock(
        returncode=0,
        stdout=json.dumps({"ProcessId": 5001, "Caption": "cmd.exe"})
    )
    
    children = _list_pane_children("1234")
    assert len(children) == 1
    assert children[0] == {"pid": 5001, "command": "cmd.exe"}


@patch("lumbergh.routers.sessions.IS_WINDOWS", True)
@patch("subprocess.run")
def test_list_pane_children_windows_empty(mock_run):
    """Verify PowerShell parsing for no children."""
    mock_run.return_value = MagicMock(returncode=0, stdout="")
    children = _list_pane_children("1234")
    assert children == []


@patch("lumbergh.routers.sessions.IS_WINDOWS", True)
@patch("subprocess.run")
def test_kill_pane_children_invalid_pid(mock_run):
    """Verify no call is made for invalid PID."""
    _kill_pane_children("not-a-pid")
    mock_run.assert_not_called()
    
    _kill_pane_children("")
    mock_run.assert_not_called()
    
    _kill_pane_children(None)
    mock_run.assert_not_called()
