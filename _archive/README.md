# Archive

Superseded artifacts kept for history only. Nothing here should be installed or used.

- `qa-skill-minimal/` - an early minimal-variant QA skill (frontmatter `name: qa-skill-minimal`).
  It was one experimental arm during the prior redesign. It is NOT the maintained skill and must
  not be installed, because a stray `name: qa-skill-minimal` in the skills path can confuse users
  into installing the wrong thing.

The maintained, current skill is `qa-skill/` at the repo root. Install that one:

```
copy qa-skill/            -> ~/.config/opencode/skills/qa-skill/
copy qa-skill/agents/*.md -> ~/.config/opencode/agents/    (qa.md, qa-facet.md)
```

See the repo root `README.md` and `qa-skill/README.md` for usage.
