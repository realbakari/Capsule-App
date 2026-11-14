# Running one prompt on several agents

Different agents solve the same task in different ways. Capsule can send one
prompt to two, three or four agents at once, let each work in its own copy of
the project, and show you what came back side by side so you can keep the
best result.

## Start a comparison

In a new conversation in a project that uses Git, choose **Run on…** in the
row under the composer. Pick two to four agents. You can pick the same agent
more than once and give each a different model, to compare models of one
agent. Leave the model empty to use that agent's default.

An agent that cannot start right now (not installed, not signed in, or its
Gateway is offline) is listed but cannot be picked, and says why.

Write the prompt, attach files if you like, and press send. The send button
says **Run on 3 agents** while agents are picked. To go back to a single
agent, press the **×** next to **Run on 3 agents**.

You can also start from the command palette with **Run on several agents…**.

Each agent gets its own conversation, named after the prompt and the agent,
with its own worktree and branch. The agents work at the same time and never
share a session or a folder, even when you picked the same agent twice.

## Compare

Compare opens beside the conversation when the run starts. You can reopen it
from the **Compare** button on the comparison's row in the sidebar, from
**More** in the titlebar, or with **Compare candidates** in the command palette.

Each agent has a card with:

- where it is (starting, working, needs you, done, failed) and how long it took,
- how many files it changed and how many lines it added and removed, measured
  against the branch it started from,
- whether its checks passed, when the turn was checked,
- the tokens or cost the agent reported, or "Not reported" when it reports none,
- the start of its final reply, or why it failed.

**Open thread** goes to that agent's conversation. **View diff** opens Review on
that agent's worktree, showing everything on its branch.

**Same file** shows one file at a time, as each agent changed it, next to each
other. The file list puts files that several agents changed first.

If one agent fails or stops to ask for approval, the others carry on. Approve
it from its conversation, or ignore it and compare the rest.

## Keep one

Press **Keep this one** on the card you prefer. Capsule applies that agent's
changes to your project folder, the same as **Apply to local checkout**. If the
project folder has changed in the same places, you get the conflict dialog,
with **Open Review**, **Ask the agent to resolve** and **Undo apply**.

Undoing the apply also undoes the choice, so you can keep a different one.

## Set the others aside

Once you have kept one, Compare offers **Set aside the others…**. After you
confirm, the other agents' conversations are archived and their worktrees are
removed from disk. Their files are saved first. To bring one back, restore its
conversation from the archive: its worktree comes back on its branch with its
files as they were.

## Rate replies and see your results

Every finished reply has a thumbs up and thumbs down. Press one again to clear
it. Ratings and the comparisons you kept add up, per agent and model, in
**Your results**, which you can find in **Usage**, and as a hint next to each
agent in **Run on…**.

Your results are kept on this computer and are never sent anywhere.

## On another device

A paired device can see comparisons, the Compare surface and your results.
Starting a comparison, keeping one, setting the others aside and rating are
only available on the computer running Capsule.
