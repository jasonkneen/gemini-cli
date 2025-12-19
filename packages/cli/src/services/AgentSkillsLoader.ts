/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import { z } from 'zod';
import type { Config } from '@google/gemini-cli-core';
import { Storage } from '@google/gemini-cli-core';
import type { ICommandLoader } from './types.js';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from '../ui/commands/types.js';
import { CommandKind } from '../ui/commands/types.js';

interface SkillDirectory {
  path: string;
  extensionName?: string;
  extensionId?: string;
}

/**
 * Defines the Zod schema for the SKILL.md frontmatter.
 * Based on the agentskills.io specification.
 */
const SkillFrontmatterSchema = z.object({
  name: z
    .string({
      required_error: "The 'name' field is required in skill frontmatter.",
      invalid_type_error: "The 'name' field must be a string.",
    })
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Name must be lowercase alphanumeric with hyphens, cannot start/end with hyphen',
    ),
  description: z
    .string({
      required_error:
        "The 'description' field is required in skill frontmatter.",
      invalid_type_error: "The 'description' field must be a string.",
    })
    .min(1)
    .max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string()).optional(),
  'allowed-tools': z.string().optional(),
});

// Type is inferred from schema but not directly used
type _SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * Parses YAML frontmatter from a SKILL.md file.
 * Frontmatter is delimited by --- at the start and end.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} | null {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const [, frontmatterStr, body] = match;

  // Simple YAML-like parser for the frontmatter
  // Handles key: value pairs (single-line only for simplicity)
  const frontmatter: Record<string, unknown> = {};
  const lines = frontmatterStr.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim();
    let value = trimmed.substring(colonIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Discovers and loads Agent Skills from SKILL.md files in both the
 * user's global skills directory and the current project's directory.
 *
 * Skills follow the agentskills.io specification:
 * - Each skill is a directory containing a SKILL.md file
 * - SKILL.md has YAML frontmatter with name and description
 * - The markdown body contains instructions for the AI
 *
 * This loader is responsible for:
 * - Recursively scanning skill directories.
 * - Parsing and validating SKILL.md files.
 * - Adapting valid skills into executable SlashCommand objects.
 * - Handling file system errors and malformed files gracefully.
 */
export class AgentSkillsLoader implements ICommandLoader {
  private readonly projectRoot: string;
  private readonly folderTrustEnabled: boolean;
  private readonly isTrustedFolder: boolean;

  constructor(private readonly config: Config | null) {
    this.folderTrustEnabled = !!config?.getFolderTrust();
    this.isTrustedFolder = !!config?.isTrustedFolder();
    this.projectRoot = config?.getProjectRoot() || process.cwd();
  }

  /**
   * Loads all skills from user, project, and extension directories.
   * Returns skills in order: user -> project -> extensions (alphabetically).
   *
   * @param signal An AbortSignal to cancel the loading process.
   * @returns A promise that resolves to an array of all loaded SlashCommands.
   */
  async loadCommands(signal: AbortSignal): Promise<SlashCommand[]> {
    if (this.folderTrustEnabled && !this.isTrustedFolder) {
      return [];
    }

    const allCommands: SlashCommand[] = [];
    const globOptions = {
      nodir: true,
      dot: true,
      signal,
      follow: true,
    };

    // Load skills from each directory
    const skillDirs = this.getSkillDirectories();
    for (const dirInfo of skillDirs) {
      try {
        // Find all SKILL.md files in the skills directory
        const files = await glob('*/SKILL.md', {
          ...globOptions,
          cwd: dirInfo.path,
        });

        const commandPromises = files.map((file) =>
          this.parseAndAdaptSkill(
            path.join(dirInfo.path, file),
            dirInfo.path,
            dirInfo.extensionName,
            dirInfo.extensionId,
          ),
        );

        const commands = (await Promise.all(commandPromises)).filter(
          (cmd): cmd is SlashCommand => cmd !== null,
        );

        allCommands.push(...commands);
      } catch (error) {
        if (
          !signal.aborted &&
          (error as { code?: string })?.code !== 'ENOENT'
        ) {
          console.error(
            `[AgentSkillsLoader] Error loading skills from ${dirInfo.path}:`,
            error,
          );
        }
      }
    }

    return allCommands;
  }

  /**
   * Get all skill directories in order for loading.
   * User skills -> Project skills -> Extension skills
   */
  private getSkillDirectories(): SkillDirectory[] {
    const dirs: SkillDirectory[] = [];

    const storage = this.config?.storage ?? new Storage(this.projectRoot);

    // 1. User skills (global)
    dirs.push({ path: Storage.getUserSkillsDir() });

    // 2. Project skills (local, can override user skills)
    dirs.push({ path: storage.getProjectSkillsDir() });

    // 3. Extension skills (processed last to detect all conflicts)
    if (this.config) {
      const activeExtensions = this.config
        .getExtensions()
        .filter((ext) => ext.isActive)
        .sort((a, b) => a.name.localeCompare(b.name));

      const extensionSkillDirs = activeExtensions.map((ext) => ({
        path: path.join(ext.path, 'skills'),
        extensionName: ext.name,
        extensionId: ext.id,
      }));

      dirs.push(...extensionSkillDirs);
    }

    return dirs;
  }

  /**
   * Parses a single SKILL.md file and transforms it into a SlashCommand object.
   * @param filePath The absolute path to the SKILL.md file.
   * @param baseDir The root skills directory for name calculation.
   * @param extensionName Optional extension name for extension skills.
   * @param extensionId Optional extension ID for extension skills.
   * @returns A promise resolving to a SlashCommand, or null if the file is invalid.
   */
  private async parseAndAdaptSkill(
    filePath: string,
    baseDir: string,
    extensionName?: string,
    extensionId?: string,
  ): Promise<SlashCommand | null> {
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      console.error(
        `[AgentSkillsLoader] Failed to read file ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }

    const parsed = parseFrontmatter(fileContent);
    if (!parsed) {
      console.error(
        `[AgentSkillsLoader] Failed to parse frontmatter in ${filePath}: No valid frontmatter found`,
      );
      return null;
    }

    const { frontmatter, body } = parsed;

    const validationResult = SkillFrontmatterSchema.safeParse(frontmatter);
    if (!validationResult.success) {
      console.error(
        `[AgentSkillsLoader] Skipping invalid skill file: ${filePath}. Validation errors:`,
        validationResult.error.flatten(),
      );
      return null;
    }

    const skillDef = validationResult.data;

    // Get the skill directory name from the file path
    const skillDir = path.dirname(filePath);
    const skillDirName = path.basename(skillDir);

    // Verify skill directory name matches the name in frontmatter
    if (skillDirName !== skillDef.name) {
      console.warn(
        `[AgentSkillsLoader] Warning: Skill directory '${skillDirName}' doesn't match frontmatter name '${skillDef.name}' in ${filePath}`,
      );
    }

    // Use the frontmatter name as the command name
    const commandName = `skill:${skillDef.name}`;

    // Build description with extension prefix if applicable
    let description = skillDef.description;
    if (extensionName) {
      description = `[${extensionName}] ${description}`;
    }

    // Store the skill body (instructions) for use in the action
    const skillInstructions = body.trim();

    return {
      name: commandName,
      description,
      kind: CommandKind.SKILL,
      extensionName,
      extensionId,
      action: async (
        context: CommandContext,
        _args: string,
      ): Promise<SlashCommandActionReturn> => {
        // Build the prompt with skill instructions
        const userArgs = context.invocation?.args?.trim() || '';

        // Construct the final prompt
        let prompt = `You are using the "${skillDef.name}" skill.\n\n`;
        prompt += `## Skill Instructions\n\n${skillInstructions}\n\n`;

        if (userArgs) {
          prompt += `## User Request\n\n${userArgs}\n`;
        }

        return {
          type: 'submit_prompt',
          content: [{ text: prompt }],
        };
      },
    };
  }
}
