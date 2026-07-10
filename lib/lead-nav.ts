// Lead-list navigation ordering.
//
// The lead detail page has "Previous" / "Next" controls that walk the same
// ordered list the user was just looking at. The list pages don't share React
// state with the detail route, so when a lead row is opened we stash the
// currently-rendered ordered lead IDs in sessionStorage; the detail page reads
// them back to find the neighbours. Session-scoped so it never outlives the tab.

const KEY = 'finno:leadNav'

export function setLeadNav(ids: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // sessionStorage can be unavailable (private mode / SSR) — nav just no-ops.
  }
}

export function getLeadNav(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}
