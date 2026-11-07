# FunLink — Technical Gaps and Approval Register

These are bounded prerequisites, not permission to expand product scope.

| ID | Unknown / gap | Required resolution | Blocks |
|---|---|---|---|
| GAP-001 | Exact production short-link hostname | Confirm the hostname under the FunLink domain before DNS/SSL setup | Phase 07 |
| GAP-002 | Exact font family/font files | Provide source assets or approve measured screenshot-derived substitute | UI implementation fidelity |
| GAP-003 | Exact design color tokens | Inspect original assets or extract tokens from original screenshots and approve | UI implementation fidelity |
| GAP-004 | Screenshot files not yet committed as repo fixtures | Add the two exact reference images to approved docs/design-reference paths | Visual regression tests |
| GAP-005 | Live prices and quotas for each plan | Confirm production prices, click/link/domain quotas, billing periods and Enterprise handling | Phase 12–14 |
| GAP-006 | VNPay merchant configuration | Supply sandbox/production credentials through secure GitHub/VPS secrets; never commit secrets | Phase 13 |
| GAP-007 | Email provider and sender identity | Decide and approve before authentication email implementation | Phase 03 |
| GAP-008 | VPS production topology and domain routing | Confirm hostnames, OS/runtime and deployment target before production deployment | Phase 17 |
| GAP-009 | Legal pages and business contact data | Supply approved legal entity, contact and policy content | Phase 15 |

Do not guess or silently resolve these gaps. Raise a focused approval request only when the relevant Phase reaches the dependency.
