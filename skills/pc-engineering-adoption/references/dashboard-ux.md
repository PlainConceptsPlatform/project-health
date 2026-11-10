# Dashboard UX

When the person asks for a site, the experience is Project Health's. The identity (colours, logo,
typeface) is theirs. Do not invent a layout; reproduce this one, and change only the tokens.

The reference is the running site, <https://plainconceptsplatform.github.io/project-health/>, and its
source under `web/src/views` and `web/src/shared/ui` in the Project Health repository. Open it before
you design anything, and open your result next to it before you call it done.

## What is fixed

**Structure**
- An overview page with one row per project, then a page per project with tabs.
- A project's tab lives in the URL hash, so a link opens on the right tab. The first tab is the plain
  URL.
- Charts are small and sit beside the number they explain, not on a canvas of their own.

**Honesty**
- A metric that cannot be measured shows *Not available* with its reason. **Never a zero**, never a
  blank.
- Samples are labelled as samples and totals as totals. Planned and not-yet-collected states have
  their own words.
- A number that needs a definition has an info button next to its label, reachable by keyboard, that
  says what it means and what it is not.

**Status**
- Colour is never the only signal: a dot comes with a word, and an icon or a hatch carries the
  meaning where a colour would.
- Enforcement mode (blocking, threshold, policy) is a neutral icon with a tooltip, because a red
  badge on every blocking row reads as a failure.

**Surface**
- Compact cards, tables for comparison, sober type, no gradients or decoration that carries no
  information.
- Light and dark themes, both legible, with a toggle in the header.
- Usable at phone width, with no horizontal scroll except a timeline that is meant to scroll.
- Every interactive element is a real button or link with an accessible name.

## What the person chooses

Colours as CSS variables, defined in one place, with the dark values redefined beside them:
background, foreground, muted, border, primary, accent, and the status colours (good, warning, bad).
Component code never contains a hex value.

How to take them, in this order:

1. **Nothing given**: Project Health's palette. It ships as `@plainconceptsplatform/ui-theme`.
2. **A brand**: ask for a URL, a logo, hex values or a brand guide. Extract primary, background, text
   and one accent, plus the typeface. Show the values back and let them correct them. Do not copy a
   logo or wordmark you were not given.
3. **A site as inspiration**: take the palette and the mood from it, never its layout or its content.
4. **By hand**: ask for primary and accent, derive the rest.

**Contrast is checked, not assumed.** Body text meets 4.5:1 on its background in both themes. A brand
colour that fails is adjusted for text and kept as-is for fills. Status colours stay distinguishable
from the brand's primary: a brand whose primary is red must not make every control read as an error.

## Before you say it is done

Open the built site in a browser at desktop and phone width, in both themes, and check:

- [ ] The overview and one project page render; a project with no data shows reasons, not zeros.
- [ ] Every tab opens from its URL hash.
- [ ] Info buttons open by keyboard.
- [ ] Text contrast holds in dark mode, on the real page and not only in the token file.
- [ ] No horizontal scroll at 375px.
- [ ] It looks like the same product as Project Health in a different coat of paint.
