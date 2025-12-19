/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Storage } from '@google/gemini-cli-core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import open from 'open';
import process from 'node:process';
import { MessageType, type HistoryItemInfo } from '../types.js';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { theme } from '../semantic-colors.js';

interface SkillInfo {
  name: string;
  description: string;
  location: 'user' | 'project' | 'extension';
  extensionName?: string;
}

/**
 * Scans a directory for SKILL.md files and extracts skill info.
 */
async function scanSkillsDirectory(
  dirPath: string,
  location: 'user' | 'project' | 'extension',
  extensionName?: string,
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(dirPath, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const frontmatter = parseFrontmatter(content);

        if (frontmatter) {
          skills.push({
            name: frontmatter.name || entry.name,
            description: frontmatter.description || 'No description',
            location,
            extensionName,
          });
        }
      } catch {
        // No SKILL.md in this directory, skip
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return skills;
}

/**
 * Simple frontmatter parser for SKILL.md files.
 */
function parseFrontmatter(
  content: string,
): { name?: string; description?: string } | null {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) return null;

  const result: { name?: string; description?: string } = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key === 'name') result.name = value;
    if (key === 'description') result.description = value;
  }

  return result;
}

async function listAction(context: CommandContext): Promise<void> {
  const allSkills: SkillInfo[] = [];

  // User skills
  const userSkillsDir = Storage.getUserSkillsDir();
  const userSkills = await scanSkillsDirectory(userSkillsDir, 'user');
  allSkills.push(...userSkills);

  // Project skills
  const projectRoot =
    context.services.config?.getProjectRoot() || process.cwd();
  const storage = context.services.config?.storage ?? new Storage(projectRoot);
  const projectSkillsDir = storage.getProjectSkillsDir();
  const projectSkills = await scanSkillsDirectory(projectSkillsDir, 'project');
  allSkills.push(...projectSkills);

  // Extension skills
  const extensions = context.services.config?.getExtensions() ?? [];
  for (const ext of extensions.filter((e) => e.isActive)) {
    const extSkillsDir = path.join(ext.path, 'skills');
    const extSkills = await scanSkillsDirectory(
      extSkillsDir,
      'extension',
      ext.name,
    );
    allSkills.push(...extSkills);
  }

  if (allSkills.length === 0) {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `No skills installed.\n\nTo install skills:\n- User skills: ${userSkillsDir}\n- Project skills: ${projectSkillsDir}\n\nRun \`/skills explore\` to learn more about Agent Skills.`,
      },
      Date.now(),
    );
    return;
  }

  // Format skills list
  const lines: string[] = ['Installed Skills:', ''];

  const userSkillsList = allSkills.filter((s) => s.location === 'user');
  if (userSkillsList.length > 0) {
    lines.push('User Skills (global):');
    for (const skill of userSkillsList) {
      lines.push(`  /skill:${skill.name} - ${skill.description}`);
    }
    lines.push('');
  }

  const projectSkillsList = allSkills.filter((s) => s.location === 'project');
  if (projectSkillsList.length > 0) {
    lines.push('Project Skills (local):');
    for (const skill of projectSkillsList) {
      lines.push(`  /skill:${skill.name} - ${skill.description}`);
    }
    lines.push('');
  }

  const extensionSkillsList = allSkills.filter(
    (s) => s.location === 'extension',
  );
  if (extensionSkillsList.length > 0) {
    lines.push('Extension Skills:');
    for (const skill of extensionSkillsList) {
      lines.push(
        `  /skill:${skill.name} - ${skill.description} [${skill.extensionName}]`,
      );
    }
    lines.push('');
  }

  const historyItem: HistoryItemInfo = {
    type: MessageType.INFO,
    text: lines.join('\n'),
    color: theme.text.primary,
  };

  context.ui.addItem(historyItem, Date.now());
}

async function exploreAction(context: CommandContext): Promise<void> {
  const skillsUrl = 'https://agentskills.io';

  if (process.env['NODE_ENV'] === 'test') {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Would open Agent Skills page in your browser: ${skillsUrl} (skipped in test environment)`,
      },
      Date.now(),
    );
  } else if (
    process.env['SANDBOX'] &&
    process.env['SANDBOX'] !== 'sandbox-exec'
  ) {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Learn about Agent Skills at ${skillsUrl}`,
      },
      Date.now(),
    );
  } else {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Opening Agent Skills documentation: ${skillsUrl}`,
      },
      Date.now(),
    );
    try {
      await open(skillsUrl);
    } catch {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Failed to open browser. Learn about Agent Skills at ${skillsUrl}`,
        },
        Date.now(),
      );
    }
  }
}

async function pathsAction(context: CommandContext): Promise<void> {
  const userSkillsDir = Storage.getUserSkillsDir();
  const projectRoot =
    context.services.config?.getProjectRoot() || process.cwd();
  const storage = context.services.config?.storage ?? new Storage(projectRoot);
  const projectSkillsDir = storage.getProjectSkillsDir();

  const lines = [
    'Skills Directories:',
    '',
    `User Skills (global):    ${userSkillsDir}`,
    `Project Skills (local):  ${projectSkillsDir}`,
    '',
    'To add a skill:',
    '1. Create a directory with your skill name',
    '2. Add a SKILL.md file with YAML frontmatter:',
    '   ---',
    '   name: my-skill',
    '   description: What this skill does',
    '   ---',
    '   [Your skill instructions here]',
    '',
    'Skills are invoked as /skill:<name>',
  ];

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: lines.join('\n'),
      color: theme.text.primary,
    },
    Date.now(),
  );
}

const listSkillsCommand: SlashCommand = {
  name: 'list',
  description: 'List installed Agent Skills',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: listAction,
};

const exploreSkillsCommand: SlashCommand = {
  name: 'explore',
  description: 'Open Agent Skills documentation in your browser',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: exploreAction,
};

const pathsSkillsCommand: SlashCommand = {
  name: 'paths',
  description: 'Show skills directory paths and setup instructions',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: pathsAction,
};

export function skillsCommand(): SlashCommand {
  return {
    name: 'skills',
    description: 'Manage Agent Skills (agentskills.io)',
    kind: CommandKind.BUILT_IN,
    autoExecute: false,
    subCommands: [listSkillsCommand, exploreSkillsCommand, pathsSkillsCommand],
    action: (context, args) =>
      // Default to list if no subcommand is provided
      listSkillsCommand.action!(context, args),
  };
}
