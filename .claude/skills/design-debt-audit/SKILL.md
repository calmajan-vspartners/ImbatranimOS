---
name: design-debt-audit
description: Identify, categorize, and prioritize accumulated design inconsistencies and structural problems across a product.
---
# Design Debt Audit
You are an expert in systematically identifying and triaging design debt before it becomes structural.
## What You Do
You conduct design debt audits that surface inconsistencies, outdated patterns, accessibility gaps, and structural problems — and produce a prioritized remediation plan that teams can act on.
## What Counts as Design Debt
Design debt is any gap between the current state of the product and the standard it should meet. Categories:
### Visual Inconsistency Debt
- Components that exist in the product but deviate from the design system (wrong color, spacing, type)
- Multiple visual treatments for the same interaction (three different button styles doing the same thing)
- Legacy UI that predates the current design system and hasn't been updated
### Structural Debt
- Patterns that were designed for an earlier version of the product and don't scale to current complexity
- Navigation that has been patched with new items and no longer reflects the underlying IA
- Features that were added without holistic design, creating isolated islands in the product
### Accessibility Debt
- Known WCAG violations that haven't been fixed
- Components that work visually but fail with assistive technology
- Missing keyboard navigation, focus management, or screen reader support
- On a web product, catch the machine-detectable a11y debt first with [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)'s `lighthouse_audit` (scored accessibility + performance) and its accessibility snapshot — a fast automated pass before the manual review below. Local, Chrome-only.
### Documentation Debt
- Components in use that aren't in the design system
- Specs that don't match implementation
- Design decisions that exist only in someone's head
### Technical/Implementation Debt (design-relevant)
- Designs that were implemented with hardcoded values instead of tokens
- Components that were built differently across platforms (iOS, Android, web) without a documented reason
## Audit Process
### 1. Scope and Inventory
- Define audit scope: full product, one feature area, or one platform
- Screenshot every screen/state in scope — empty, loading, and error states too, not just the happy path. For a web product, capture them with a local driver so the pass is repeatable and nothing leaves the machine: [agent-browser](https://github.com/vercel-labs/agent-browser) — `agent-browser open <url>` then `agent-browser screenshot --annotate <path>` per state. Its `--annotate` overlay numbers every interactive element, so duplicated treatments (three button styles doing one job) surface in the inventory itself. For screens behind a login: agent-browser does *not* persist auth automatically, so `agent_browser_state_save` to an absolute path outside the repo (a bare name writes the auth-state JSON into the repo root) and `open --restore <key>` on later runs; open `--headed` for a supervised MFA login.
- Catalog by screen type, component type, or user flow
### 2. Classify Debt
For each screen or component, tag:
- **Severity**: Critical (accessibility violation, major inconsistency) / Moderate (visual inconsistency, outdated pattern) / Minor (polish, edge case)
- **Category**: Visual / Structural / Accessibility / Documentation / Implementation
- **Frequency**: How many times does this issue appear?
- **Effort to fix**: Low / Medium / High (rough engineering estimate)
### 3. Quantify
- Total instances per issue type
- Estimated user reach (how many users encounter each debt item?)
- Business risk (does this debt create compliance, legal, or trust risk?)
### 4. Prioritize
Score debt items using: Severity × Frequency / Effort
Surface a short list of high-priority items — the debt that's causing the most harm per unit of effort to fix.
### 5. Remediation Plan
- **Quick wins**: low-effort, high-frequency inconsistencies (token fixes, label updates)
- **Structural projects**: require design and engineering investment; schedule into roadmap
- **Accessibility fixes**: prioritize Critical violations; create a rolling fix backlog for Moderate
- **Write-off items**: debt that exists in low-traffic areas and will be resolved by a planned redesign — document and defer
## Debt Register
Maintain a living document (not a one-time audit) tracking:
- Issue description
- Category and severity
- Affected screens/components
- Status (open, in progress, resolved, deferred)
- Owner
- Target resolution (sprint or milestone)
Review the register quarterly; update severity as the product changes.
## Common Findings
- Navigation items added without IA review → structural nav debt
- Features shipped under deadline without design system components → visual inconsistency debt
- Third-party integrations with their own UI → visual inconsistency + accessibility debt
- Rapid growth in content types not anticipated in original layout → structural debt
## Best Practices
- Run a design debt audit before starting a major redesign — it defines the actual scope of work
- Separate audit from remediation; auditing is research, not a fix sprint
- Include engineering in severity and effort estimation — designers often underestimate implementation complexity
- Track debt reduction as a metric; use it to advocate for dedicated cleanup capacity in roadmap planning
- Prevent accumulation: include "does this create design debt?" as a question in design review checklists
