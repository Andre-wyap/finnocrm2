// Lead-list navigation context.
//
// The lead detail card's Previous / Next controls walk the same ordered list the
// user was just looking at, and its Back controls return to that list. The list
// pages don't share React state with the detail route, so when a lead row is
// opened we stash the ordered lead IDs plus the originating list path in
// sessionStorage; the card reads them back. Session-scoped so it never outlives
// the tab. (The Leads page remembers its own All/My tab separately — see
// `finno:leadsView` in that page — so Back lands on the right tab.)

const KEY = 'finno:leadNav'

export type LeadNav = {
  ids: string[]
  returnTo: string // path of the list the card was opened from
}

export function setLeadNav(nav: LeadNav): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(nav))
  } catch {
    // sessionStorage can be unavailable (private mode / SSR) — nav just no-ops.
  }
}

export function getLeadNav(): LeadNav {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LeadNav>
      if (Array.isArray(parsed.ids)) {
        return { ids: parsed.ids, returnTo: typeof parsed.returnTo === 'string' ? parsed.returnTo : '' }
      }
    }
  } catch {
    // fall through to default
  }
  return { ids: [], returnTo: '' }
}
