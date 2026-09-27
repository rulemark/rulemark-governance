/**
 * Next calls `register()` once as each server instance starts. The
 * configuration is checked here, so a misconfigured service stops at once with
 * the variable to fix, as the other apps do, rather than failing its first
 * request. Next replaces `process.env.NEXT_RUNTIME` as it compiles, so the
 * Edge build drops the Node-only import.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkConfiguration } = await import('./lib/startup');
    checkConfiguration();
  }
}
