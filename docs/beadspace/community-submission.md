# Beadspace — Community Tools Submission

## COMMUNITY_TOOLS.md Entry

For the **Web UIs** section:

```markdown
- **[Beadspace](https://github.com/cameronsjo/beadspace)** - Drop-in GitHub Pages dashboard with triage suggestions, priority/status breakdowns, and searchable issue table. Single HTML file, zero build dependencies, auto-deploys via GitHub Action. Built by [@cameronsjo](https://github.com/cameronsjo). (HTML/CSS/JS)
```

---

## Discussion #276 Post

### Beadspace — a drop-in dashboard for GitHub Pages

Built this to scratch my own itch: I wanted a quick way to scan open issues and spot misprioritized work without leaving the browser.

**What it does:**

- Dashboard with stats, active issues sorted by priority, and auto-generated triage suggestions (flags stale P0/P1s, low-priority bugs, plan-worthy items without descriptions)
- Searchable/sortable issues table with status filters
- Pure CSS charts — no Chart.js, no D3, no external JS dependencies

**How it works:**

- Single `index.html` that fetches `issues.json` at load time
- GitHub Action converts `.beads/issues.jsonl` to JSON array and deploys to Pages
- Edit the HTML directly to customize — no build step needed

**Drop-in recipe:**

```bash
mkdir -p docs/beadspace
curl -sL https://raw.githubusercontent.com/cameronsjo/beadspace/main/index.html > docs/beadspace/index.html
curl -sL https://raw.githubusercontent.com/cameronsjo/beadspace/main/workflows/beadspace.yml > .github/workflows/beadspace.yml
bd export | jq -s '.' > docs/beadspace/issues.json
gh api repos/{owner}/{repo}/pages -X POST -f "build_type=workflow"
```

Includes a `CLAUDE.md` so Claude (or any AI assistant) can customize the dashboard — covers the issue schema, CSS variables, and how to add views/panels.

**Repo:** https://github.com/cameronsjo/beadspace
**Live example:** https://cameronsjo.github.io/llm-council/

Inspired by [@mattbeane](https://github.com/mattbeane)'s [beads-viz-prototype](https://github.com/mattbeane/beads-viz-prototype) — took the "single HTML file from bd export" concept and rebuilt it as a dynamic triage dashboard.
