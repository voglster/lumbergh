import type { GraphCommit, GraphData } from '../diff/types'

/** What the API can send back for a graph request. */
export type GraphResponse =
  | ({ unchanged: true; version: string } & Partial<GraphData>)
  | (GraphData & { reset?: true })
  | ({
      delta: true
      version: string
      added: GraphCommit[]
      /** Explicit ordering, sent only when `keep` cannot describe the change. */
      order?: string[]
      /** Shorthand: the new list is `added` followed by this many of the ones we hold. */
      keep?: number
      /** Current badges, by commit. Commits absent from this map have none. */
      refs: Record<string, GraphCommit['refs']>
      /** Commits not yet pushed; everything else is. Sent when it is the shorter list. */
      unpushed?: string[]
      /** Commits that are pushed; everything else is not. Sent when *it* is the shorter list. */
      pushed?: string[]
    } & Omit<GraphData, 'commits' | 'version'>)

/**
 * `shortHash` is not sent — it is a duplicate of data already in `hash`, on a
 * payload where hashes are random hex and survive gzip at full price.
 */
function withShortHash(commits: GraphCommit[]): GraphCommit[] {
  for (const commit of commits) commit.shortHash = commit.hash.slice(0, 7)
  return commits
}

/**
 * Re-stamp the two per-commit fields that can change without the commit doing so.
 *
 * A branch badge belongs to whichever commit the branch currently points at, and
 * `pushed` flips underneath a commit that was already drawn. Carrying either one
 * over from the previous graph leaves a badge stranded on every commit that was
 * ever a tip, which is what made `dev` appear four times on one screen.
 */
function refreshVolatile(
  commits: GraphCommit[],
  refs: Record<string, GraphCommit['refs']>,
  unpushed: string[] | undefined,
  pushed: string[] | undefined
): GraphCommit[] {
  // Only the minority list is sent, so whichever arrived names the exceptions.
  const listed = new Set(pushed ?? unpushed ?? [])
  const listedArePushed = pushed !== undefined
  for (const commit of commits) {
    commit.refs = refs[commit.hash] ?? []
    commit.pushed = listed.has(commit.hash) === listedArePushed
  }
  return commits
}

/**
 * Fold a response into the graph the client is already holding.
 *
 * Returns the graph to render and whether the cursor survived. A `false` cursor
 * means the next poll must ask for a full keyframe — either the server sent a
 * delta we cannot apply, or applying it produced a graph that disagrees with
 * the order the server described. Both are cheap to recover from and dangerous
 * to paper over, so they degrade to a re-fetch rather than to a wrong graph.
 */
export function applyGraphResponse(
  previous: GraphData | null,
  response: GraphResponse
): { graph: GraphData | null; cursorValid: boolean } {
  if ('unchanged' in response && response.unchanged) {
    return { graph: previous, cursorValid: true }
  }

  if ('delta' in response && response.delta) {
    if (!previous) return { graph: previous, cursorValid: false }

    const { delta: _delta, added, order, keep, refs, unpushed, pushed, ...rest } = response
    // Without the badge map we cannot tell a moved branch from a stale one.
    // Re-seeding is cheap; guessing would strand badges or erase them all.
    if (!refs) return { graph: previous, cursorValid: false }
    withShortHash(added)

    if (order === undefined) {
      if (keep === undefined || keep > previous.commits.length) {
        return { graph: previous, cursorValid: false }
      }
      const commits = refreshVolatile(
        [...added, ...previous.commits.slice(0, keep)],
        refs,
        unpushed,
        pushed
      )
      return { graph: { ...previous, ...rest, commits }, cursorValid: true }
    }

    const byHash = new Map(previous.commits.map((commit) => [commit.hash, commit]))
    for (const commit of added) byHash.set(commit.hash, commit)
    const merged = order.map((hash) => byHash.get(hash)).filter((c): c is GraphCommit => !!c)
    if (merged.length !== order.length) {
      return { graph: previous, cursorValid: false }
    }
    const commits = refreshVolatile(merged, refs, unpushed, pushed)
    return { graph: { ...previous, ...rest, commits }, cursorValid: true }
  }

  const keyframe = response as GraphData
  withShortHash(keyframe.commits)
  return { graph: keyframe, cursorValid: true }
}

/**
 * The two tokens a poll offers so the server can answer "nothing new": an HTTP
 * ETag and the delta cursor.
 *
 * They are held together because they have to be dropped together. Keeping the
 * ETag while asking for a keyframe leaves the request answerable with a 304,
 * which is how a "refresh" button ends up doing nothing at all.
 */
export class GraphCursor {
  private etag = ''
  private version = ''

  headers(): Record<string, string> {
    return this.etag ? { 'If-None-Match': this.etag } : {}
  }

  sinceParam(): string {
    return this.version ? `&since=${this.version}` : ''
  }

  /**
   * Take up the tokens of a response that has been folded into the graph.
   * A cursor that could not be applied is dropped, so the next poll asks for a
   * full keyframe instead of another delta against a version we never reached.
   */
  advance(etag: string | null, version: string | undefined, cursorValid: boolean): void {
    this.etag = etag || ''
    this.version = cursorValid ? (version ?? '') : ''
  }

  reset(): void {
    this.etag = ''
    this.version = ''
  }
}
