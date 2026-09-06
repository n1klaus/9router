# v2 subagent gates (AGENTS Step 3) — all GREEN

- **Agent A clean solve**: GREEN — all 3 legs + guard-after-normalize ordering derivable from problem_description.txt alone; derived fix matched solution.patch exactly.
- **Agent B fairness**: GREEN — 19 assertions across 7 tests: 16 MENTIONED + 3 INFERABLE = 19; 0 UNFAIR.
- **Agent C cheating**: GREEN — delete-all-markers fails test 2 (0 vs 1); wrap-only fails test 1 (5 vs ≤4); guard-first fails tests 2+6 (bare objects unwrapped).
- **Agent D difficulty**: GREEN — 2 modules, 5 pipeline stages, non-trivial (strip-before-count ordering; naive 3-line wrap fails test 6).

# Four-state matrix (local worktree + Docker 9router-challenge:v2)
| State | Patches | Mode | Result |
| A | test only | new | 7 tests, 7 failures, exit 1 |
| B | test+solution | new | 7 tests, 0 failures, exit 0 |
| C | test+solution | base | 59 tests, 0 failures, exit 0 |
| D | test only | base | 59 tests, 0 failures, exit 0 (suites identical to C) |

# Deviations from plan (documented)
- Step 5 widening REVERTED: translator-request-normalization.test.js fails 4/8 at true base 4eda76e2 (pre-existing collapseTextParts behavior); test.sh base set stays at v1's 4 green suites. Advisory-confirmed.
- @versions/v2/Dockerfile initially copied the app Dockerfile; restored to the Olympus challenge Dockerfile (identical to v1) in 97db2822.
