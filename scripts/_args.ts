/** Tiny argv helpers for the CLI scripts: `--flag`, `--key value` / `--key=value`, and positionals. */
export interface Args {
  flags: Set<string>
  values: Map<string, string>
  positional: string[]
}

export function parseArgs(argv: readonly string[] = process.argv.slice(2), valued: readonly string[] = []): Args {
  const out: Args = { flags: new Set(), values: new Map(), positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out.positional.push(a)
      continue
    }
    const [k, v] = a.slice(2).split('=', 2)
    if (v !== undefined) out.values.set(k, v)
    else if (valued.includes(k) && i + 1 < argv.length) out.values.set(k, argv[++i])
    else out.flags.add(k)
  }
  return out
}
