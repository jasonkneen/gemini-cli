/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';

let homeDir: string | undefined;

/**
 * A cached version of os.homedir().
 *
 * @return The user's home directory.
 */
export function getHomeDir(): string {
  if (homeDir === undefined) {
    homeDir = os.homedir();
  }
  return homeDir;
}
