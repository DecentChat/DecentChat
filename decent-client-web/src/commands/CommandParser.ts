/**
 * CommandParser — Slash command system for DecentChat
 * 
 * All commands are client-side. No server involved.
 * Type / in the compose box to see available commands.
 */

export interface CommandResult {
  /** Output text to display (as system message) */
  output?: string;
  /** HTML output (for rich display) */
  html?: string;
  /** Whether to suppress sending as a regular message */
  handled: boolean;
  /** Error message */
  error?: string;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  category: 'identity' | 'workspace' | 'channel' | 'media' | 'network' | 'debug';
  execute: (args: string[], rawArgs: string) => Promise<CommandResult> | CommandResult;
}

export type CommandHandler = CommandDef['execute'];

export class CommandParser {
  private commands = new Map<string, CommandDef>();

  /**
   * Register a command
   */
  register(def: CommandDef): void {
    this.commands.set(def.name, def);
    if (def.aliases) {
      for (const alias of def.aliases) {
        this.commands.set(alias, def);
      }
    }
  }

  /**
   * Check if input is a slash command
   */
  isCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  /**
   * Parse and execute a command
   */
  async execute(input: string): Promise<CommandResult> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { handled: false };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);
    const rawArgs = trimmed.slice(1 + name.length).trim();

    // Special: /help
    if (name === 'help') {
      return this.help(args[0]);
    }

    const cmd = this.commands.get(name);
    if (!cmd) {
      return {
        handled: true,
        error: `Unknown command: /${name}. Type /help for available commands.`,
      };
    }

    try {
      return await cmd.execute(args, rawArgs);
    } catch (err) {
      return {
        handled: true,
        error: `Command /${name} failed: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Get all commands (for autocomplete)
   */
  getAllCommands(): CommandDef[] {
    // Deduplicate (aliases point to same def)
    const seen = new Set<CommandDef>();
    const result: CommandDef[] = [];
    for (const def of this.commands.values()) {
      if (!seen.has(def)) {
        seen.add(def);
        result.push(def);
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get commands matching a prefix (for autocomplete)
   */
  autocomplete(prefix: string): CommandDef[] {
    const lower = prefix.toLowerCase();
    return this.getAllCommands().filter(
      cmd => cmd.name.startsWith(lower) || cmd.aliases?.some(a => a.startsWith(lower))
    );
  }

  /**
   * Generate help text
   */
  private help(commandName?: string): CommandResult {
    if (commandName) {
      const cmd = this.commands.get(commandName.toLowerCase());
      if (!cmd) {
        return { handled: true, error: `Unknown command: /${commandName}` };
      }
      return {
        handled: true,
        output: `/${cmd.name} — ${cmd.description}\nUsage: ${cmd.usage}${cmd.aliases ? `\nAliases: ${cmd.aliases.map(a => '/' + a).join(', ')}` : ''}`,
      };
    }

    const categories: Record<string, CommandDef[]> = {};
    for (const cmd of this.getAllCommands()) {
      if (!categories[cmd.category]) categories[cmd.category] = [];
      categories[cmd.category].push(cmd);
    }

    const categoryNames: Record<string, string> = {
      identity: '🔐 Identity & Security',
      workspace: '🏠 Workspace',
      channel: '💬 Channel',
      media: '📎 Media & Storage',
      network: '🌐 Network',
      debug: '🔧 Debug',
    };

    let output = '━━━ DecentChat Commands ━━━\n';
    for (const [cat, cmds] of Object.entries(categories)) {
      output += `\n${categoryNames[cat] || cat}\n`;
      for (const cmd of cmds) {
        output += `  /${cmd.name.padEnd(14)} ${cmd.description}\n`;
      }
    }
    output += '\nType /help <command> for details.';

    return { handled: true, output };
  }
}
