# Skills

A skill is a short, step-by-step workflow that SAM, the assistant inside SEO Pilot, follows when a task matches it. SEO Pilot ships built-in skills (site audit, keyword research, competitor analysis and more), and your workspace can add its own.

Skills use the open [Agent Skills](https://agentskills.io) format: a `SKILL.md` file with a `name`, a `description` saying when to use it, and markdown steps. So a skill you write in SEO Pilot also works in Claude Code, Codex and other agents, and the other way round.

Open a project, then **AI Tools** → **Skills**.

## Create a skill

1. Press **New skill**.
2. **Name**: lowercase letters, digits and single hyphens, for example `weekly-content-check`. It can't reuse a built-in skill's name.
3. **When to use it**: one line. SAM reads it to decide when the skill fits, so say what it does and when.
4. **Instructions**: the steps, in order, in Markdown. Name the tools SAM should use and the shape of the answer you want.
5. Press **Create skill**. It is on straight away.

To change a built-in skill, open it and press **Duplicate to edit**. You get your own copy to change; the built-in one stays as it is.

From the row menu you can **Edit**, **Turn off** or **Turn on**, **Schedule**, **Download SKILL.md** and **Delete**. Deleting asks first, and also deletes the skill's schedules. Reports it already wrote stay.

**Who sees it:** your skills belong to your workspace. Everyone in the workspace can use and edit them in every project. Other workspaces never see them, and SAM never uses another workspace's skills.

**Limits:** 50 skills per workspace, 1,024 characters for the description and 20,000 for the instructions. SAM loads a skill's text only when a task needs it.

**Safety:** a skill is instructions for SAM, not code. It can't change SAM's own rules: SAM still asks before paid work and stays inside the project. The app shows skill text as plain Markdown and never runs HTML from it.

## Save a skill from a SAM chat

When SAM has just done something you'll want again, say so: "save this as a skill". SAM writes the steps as a **draft** and gives you a link to it.

A draft does nothing until you open it on the Skills page, read it, edit anything that's off and press **Turn on**. This is on purpose: text SAM read on a web page can never turn itself into standing instructions.

## Use skills in Claude Code, Codex and other agents

**Download:** open any skill, built-in or your own, and press **Download SKILL.md**. Put the file in a folder named after the skill:

```sh
# Claude Code (this project only; use ~/.claude/skills for every project)
mkdir -p .claude/skills/weekly-content-check
mv ~/Downloads/SKILL.md .claude/skills/weekly-content-check/

# Codex
mkdir -p ~/.codex/skills/weekly-content-check
mv ~/Downloads/SKILL.md ~/.codex/skills/weekly-content-check/
```

Or keep the folder in a Git repository and install it with `npx skills add <owner>/<repo>`.

**Over MCP:** agents connected to SEO Pilot's MCP server can call `list_skills` to see the built-in skills and your workspace's skills that are on, and `get_skill` to fetch one as a `SKILL.md`. Drafts and skills that are off are not served.

## Run a skill on a schedule

Any skill that is on can run by itself for the project you're in, and save its answer as a report.

1. On the Skills page, open the row menu and press **Schedule**.
2. Switch it **On**, choose **Daily** or **Weekly** (and the day), the hour and your timezone.
3. Press **Save schedule**.

Schedules are off until you switch them on. At the chosen hour SAM runs the skill in a new chat, without asking questions. Its final answer is saved under **Reports**, and the Skills page links to the report and to the chat. If something stops a run, the page says why.

**Needs AI:** a schedule only runs when SEO Pilot has AI set up: your own AI engine or an OpenRouter key (see [Choose how AI runs](AI_ENGINE.md)). Without one the schedule shows **Needs AI** and skips its runs until you set it up.

**Cost:** a scheduled run is an ordinary SAM chat. On the hosted service it uses credits like any chat. On your own server with your own AI engine there are no credits to spend. With an OpenRouter key you pay OpenRouter per use. Paid research tools (DataForSEO) cost what they cost in chat, and a scheduled run won't start new paid tracking or large batches; it lists them as recommendations instead.

The schedule runs as the person who saved it. If they leave the workspace, it turns itself off.
