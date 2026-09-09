import React from 'react'
import { Trash2 } from 'lucide-react'

import { confirmHardReset, resetMenuEntries } from './resetMenu'
import type { ResetMode } from './resetMenu'
import type { GraphWorktree } from '../diff/types'

export type BranchMenuItem = {
  key: string
  label: React.ReactNode
  onClick: () => void
  danger?: boolean
  separator?: boolean
}

export type DeleteBranchTarget = {
  name: string
  local: boolean
  remote: boolean
  worktree?: GraphWorktree
}

export type MenuBranchInfo = {
  name: string
  local: boolean
  remote: boolean
  commitHash: string
  commitShortHash: string
  x: number
  y: number
}

export function buildBranchMenuItems(
  menuBranch: MenuBranchInfo,
  isCurrent: boolean,
  hasUnpushed: boolean | undefined,
  handleBranchCheckout: () => void,
  handleBranchPush: () => void,
  handleResetTo: (hash: string, mode: ResetMode) => void,
  setDeleteBranchConfirm: (v: DeleteBranchTarget | null) => void,
  setMenuBranch: (v: MenuBranchInfo | null) => void,
  heldByWorktree?: GraphWorktree
): BranchMenuItem[] {
  const items: BranchMenuItem[] = []
  if (heldByWorktree) {
    // git refuses to check out a branch another worktree holds, so offering
    // Checkout here only buys an error. Say who has it instead — the session
    // name if one is attached, else the directory, which is what you would go
    // looking for.
    const holder = heldByWorktree.sessionName ?? heldByWorktree.path.split('/').slice(-2).join('/')
    items.push({
      key: 'held-by-worktree',
      label: `Checked out in ${holder}`,
      onClick: () => setMenuBranch(null),
    })
  } else if (!isCurrent) {
    items.push({ key: 'checkout', label: 'Checkout', onClick: handleBranchCheckout })
  }
  if (hasUnpushed && menuBranch.local) {
    items.push({ key: 'push', label: 'Push', onClick: handleBranchPush })
  }
  if (!menuBranch.local && menuBranch.remote) {
    const target = `${menuBranch.name} (${menuBranch.commitShortHash})`
    items.push(
      ...resetMenuEntries(
        () => {
          if (!confirmHardReset(target)) return
          handleResetTo(menuBranch.commitHash, 'hard')
        },
        () => {
          if (!confirm(`Reset current branch to ${target}?`)) return
          handleResetTo(menuBranch.commitHash, 'soft')
        }
      )
    )
  }
  if (!isCurrent) {
    items.push({
      key: 'delete',
      separator: true,
      danger: true,
      label: (
        <>
          <Trash2 size={14} />
          Delete branch
        </>
      ),
      onClick: () => {
        setDeleteBranchConfirm({
          name: menuBranch.name,
          local: menuBranch.local,
          remote: menuBranch.remote,
          // git will refuse the delete while this tree holds the branch; the
          // confirmation offers to remove it rather than reporting the refusal.
          worktree: heldByWorktree,
        })
        setMenuBranch(null)
      },
    })
  }
  return items
}
