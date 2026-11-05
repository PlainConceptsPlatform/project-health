# Publishing

Ask one question first: who opens it? A dashboard nobody reads is a pipeline and a hosting bill.
For many teams the honest first release is option 4.

## 1. An existing Project Health instance

Only when the repository is on GitHub. The facets are picked up with no integration code: the
consumer reads `engineering-excellence-<facet>` artifacts from the configured branch. What the
instance needs is one entry in `projects.json`, added by whoever runs it.

## 2. Your own instance, from the template

Only when the repository is on GitHub. Copy `PlainConceptsPlatform/Project-Health`, add a token,
turn on Pages, and the same collection runs against your projects. Keep it private: delivery metrics
name real people.

## 3. A static site from committed JSON, any host

The web reads `data/index.json` and `data/<id>/<yyyy-mm>.json` at build time and needs nothing else:

```bash
PROJECT_HEALTH_CONFIG_DIR=<dir with projects.json and config/> \
PROJECT_HEALTH_DATA_DIR=<dir with data/> pnpm web:build
```

The export lands in `web/out/` and can be served by Azure Static Web Apps, an internal nginx, GitHub
Pages, or a laptop. A build with no collected data is valid and shows empty states, which is how you
check the wiring before the first collection.

The repository supplies the engineering cards; `delivery`, `agents` and `contributors` are required
keys in the month document but may each be `{ "available": false, "reason": "..." }`. An honest
absence is a supported state, and a zero is not a substitute.

## 4. No dashboard

The facets stay in the repository and the gates do the work. This is often the right first release,
and it is the only option that needs nothing outside the repository.

## What does not exist yet

On a non-GitHub host, nothing writes `data/<id>/<yyyy-mm>.json`. The collector speaks the GitHub API,
and the store that would let any pipeline append a sample does not exist. Until it does, option 3
means writing that file yourself, and the rules the collector applies are:

- one sample per commit, oldest first, deduplicated to the latest run attempt;
- the newest sample keeps its full detail, older samples keep scope totals only;
- samples already stored are merged, never refetched.

Do not promise a live dashboard on a non-GitHub host. Say which of the four options the team has,
and what remains to build for the rest.
