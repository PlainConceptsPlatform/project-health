# The adoption record

Write `project-health/ADOPTION.md` in the repository during the form and keep it current during the
build. It is three things at once: the person's answers, the step list the agent works through, and
the resume point for the next session, model or colleague. When it exists on load, read it, say
where it stopped, and continue from the first step that is not done instead of starting the form
again (ask only the questions it has no answer for).

Copy this, in the person's language:

```markdown
# Project Health adoption

Started <yyyy-mm-dd> by <agent and model>. Skill: pc-engineering-adoption.

## Answers

| # | Question | Answer |
| --- | --- | --- |
| 1 | CI platform | Azure DevOps |
| 2 | Web | Yes |
| 3 | Where the web lives | Local only |
| 3b | Look | Project Health palette (decided by the agent) |
| 4 | Cadence | Daily, at night |
| 5 | Pillars | Engineering; DORA (pending: no collector for Azure DevOps) |
| 6 | Engineering scope | Everything the standard proposes |
| 7 | Context | .NET 8 + Next 15, `dotnet test` / `pnpm test`, main, pool `Default` (self-hosted), data in `project-health/` on main |

## Pinned sources

- Producer: PlainConceptsPlatform/agentic-workflows @ <sha>, vendored by rule <1 or 2>
- Project Health web and facet-store: PlainConceptsPlatform/project-health @ <sha>

## Steps

- [x] 1. Form answered and plan confirmed
- [ ] 2. Producer vendored
- [ ] 3. First facet written locally and validated
- [ ] 4. Data folder and first month file
- [ ] 5. Web running locally, seen by the person
- [ ] 6. CI publishes facets from the default branch
- [ ] 7. Collection pipeline commits the month files
- [ ] 8. Deployment pipeline (or: not needed, local only)
- [ ] 9. Verified against a real run, including one deliberate failure

## Modules

| Module | State | Evidence or reason |
| --- | --- | --- |
| coverage | installed | `project-health/data/<id>/<yyyy-mm>.json`, run <link> |
| mutation | not producible | no Stryker in the repository |

## Pending

- DORA on Azure DevOps: no collector. The web shows it as not available with the reason.
```

A step is ticked only with its evidence next to it (a path, a run link, a screenshot), never because
the file that should do it exists.
