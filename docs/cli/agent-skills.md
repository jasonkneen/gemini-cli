# Agent Skills

Agent Skills are portable, version-controlled packages of instructions, scripts,
and resources that extend Gemini CLI's capabilities. Skills follow the
[agentskills.io](https://agentskills.io) open standard, making them compatible
with multiple AI agent tools.

## Overview

Skills allow you to:

- Package complex prompts and instructions into reusable units
- Share specialized capabilities across projects and teams
- Install community-created skills from the agentskills.io ecosystem
- Create project-specific skills that are version-controlled with your code

## File locations and precedence

Gemini CLI discovers skills from two primary locations:

1. **User skills (global):** Located in `~/.gemini/skills/`. These skills are
   available in any project you are working on.
2. **Project skills (local):** Located in `<your-project-root>/.gemini/skills/`.
   These skills are specific to the current project and can be checked into
   version control to be shared with your team.

If a skill in the project directory has the same name as a skill in the user
directory, the **project skill will be used.** This allows projects to override
global skills with project-specific versions.

Extensions can also provide skills in their `skills/` directory.

## Directory structure

Each skill is a directory containing a `SKILL.md` file:

```
~/.gemini/skills/
├── code-review/
│   └── SKILL.md
├── git-commit/
│   └── SKILL.md
└── testing/
    ├── SKILL.md
    ├── scripts/
    │   └── setup.sh
    └── references/
        └── best-practices.md
```

## SKILL.md format

Each skill requires a `SKILL.md` file with YAML frontmatter and markdown
instructions.

### Required frontmatter fields

**name**

- 1-64 characters
- Lowercase alphanumeric and hyphens only
- Cannot start or end with a hyphen
- Must match the parent directory name
- Example: `code-review`

**description**

- 1-1024 characters
- Should explain what the skill does and when to use it
- Include keywords that help the AI identify relevant tasks
- Example: "Reviews code for best practices, security issues, and
  maintainability"

### Optional frontmatter fields

**license**

- Specifies skill licensing terms

**compatibility**

- 1-500 characters
- Indicates environment requirements
- Example: "Requires git, docker, and internet access"

**metadata**

- Arbitrary string key-value pairs for additional properties

**allowed-tools**

- Space-delimited list of pre-approved tools the skill can use
- Example: `Bash(git:*) Read Write`

### Example SKILL.md

```markdown
---
name: code-review
description:
  Reviews code changes for best practices, security vulnerabilities, and
  maintainability. Use when reviewing pull requests or before committing code.
license: MIT
compatibility: Requires access to source files
---

# Code Review Skill

You are an expert code reviewer. When reviewing code, follow these guidelines:

## Review Checklist

1. **Code Quality**
   - Check for clear naming conventions
   - Verify proper error handling
   - Look for code duplication

2. **Security**
   - Check for SQL injection vulnerabilities
   - Verify input validation
   - Look for hardcoded credentials

3. **Performance**
   - Identify potential bottlenecks
   - Check for unnecessary computations
   - Verify efficient data structures

## Output Format

Provide your review in the following format:

- Summary (1-2 sentences)
- Issues found (bulleted list with severity)
- Recommendations for improvement
```

## Using skills

Skills are invoked as slash commands with the `skill:` prefix:

```
/skill:code-review Check the changes in src/auth.ts
```

To see all available skills:

```
/skills
```

To see skills directory paths and setup instructions:

```
/skills paths
```

To learn more about the Agent Skills ecosystem:

```
/skills explore
```

## Progressive disclosure

Skills support a progressive disclosure strategy to optimize token usage:

1. **Metadata** (~100 tokens): Name and description loaded at startup for
   command matching
2. **Instructions** (<5000 tokens recommended): Full SKILL.md loaded when the
   skill is activated
3. **Resources**: Additional files in `scripts/`, `references/`, and `assets/`
   directories loaded on-demand

Keep your main SKILL.md under 500 lines. Move detailed content to separate
reference files.

## Creating your first skill

1. Create a directory for your skill:

```bash
mkdir -p ~/.gemini/skills/my-skill
```

2. Create the SKILL.md file:

```bash
cat > ~/.gemini/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: My custom skill that helps with specific tasks
---

# My Custom Skill

Add your instructions here that Gemini will follow when this skill is active.

## Guidelines
- Guideline 1
- Guideline 2

## Examples
- Example usage 1
- Example usage 2
EOF
```

3. Use your skill:

```
/skill:my-skill Help me with my task
```

## Sharing skills

Skills can be shared in several ways:

1. **Project skills**: Add to `.gemini/skills/` and commit to version control
2. **Extensions**: Package skills in a Gemini CLI extension
3. **Community**: Publish to the agentskills.io ecosystem

## Best practices

1. **Clear descriptions**: Write descriptions that help the AI understand when
   to use the skill
2. **Focused scope**: Each skill should do one thing well
3. **Version control**: Store project-specific skills in `.gemini/skills/`
4. **Documentation**: Include examples and edge cases in your skill instructions
5. **Token efficiency**: Keep instructions concise and move detailed references
   to separate files

## Related

- [Custom Commands](./custom-commands.md) - TOML-based custom commands
- [Extensions](../extensions/getting-started-extensions.md) - Package skills and
  more as extensions
- [agentskills.io](https://agentskills.io) - Agent Skills specification and
  ecosystem
