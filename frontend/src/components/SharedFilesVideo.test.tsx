/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import SharedFiles from './SharedFiles'

const files = [{ name: 'clip.mp4', size: 5326671, modified: Date.now() / 1000 }]

function renderPanel() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ files }) })))
  const { container } = render(<SharedFiles />)
  return container
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SharedFiles video rendering', () => {
  it('shows a poster frame instead of the generic file icon', async () => {
    const container = renderPanel()

    await waitFor(() => expect(screen.getByText('clip.mp4')).toBeTruthy())

    const thumb = container.querySelector('video')
    expect(thumb?.getAttribute('src')).toContain('/shared/files/clip.mp4/content')
    expect(thumb?.getAttribute('preload')).toBe('metadata')
  })

  it('opens a player when the row is clicked', async () => {
    const container = renderPanel()

    await waitFor(() => expect(screen.getByText('clip.mp4')).toBeTruthy())
    screen.getByText('clip.mp4').click()

    await waitFor(() => {
      const player = [...container.querySelectorAll('video')].find((v) => v.hasAttribute('controls'))
      expect(player?.getAttribute('src')).toContain('/shared/files/clip.mp4/content')
    })
  })
})
