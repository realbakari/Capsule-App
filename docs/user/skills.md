# Skills

A skill is a written procedure — a `SKILL.md` file — that you attach to a
conversation so the agent follows it. Type `$` in the composer to attach one.

## Finding skills

**Library → Browse GitHub** lists skills read live from the repositories that
publish them. Names come from the repository, descriptions from each skill's
own file. No account or key is needed.

The list is cached, because GitHub allows a limited number of anonymous
requests per hour for your whole machine. If a refresh fails, Capsule keeps
showing the last catalog it loaded and says why it could not update, rather
than showing you an empty page. **Refresh** forces a new fetch.

## skills.sh

Optional. skills.sh requires a Vercel OIDC token on every request, so Capsule
reads GitHub unless you add one in **Settings → Skills**. With a token, its
results appear first and carry install counts. If the token is rejected — they
expire roughly every 12 hours — the directory says so.

## Installing

Installing fetches the skill's text and stores it with the skill. If that text
cannot be read, Capsule does not install it: a skill without its procedure
would attach to a conversation and do nothing.
