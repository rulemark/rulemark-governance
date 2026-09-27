import { Lockup } from '@rulemark/ui/components/logo';
import Link from 'next/link';

import { ThemeToggle } from './theme-toggle';

/** The app's header: the lockup, home, and the theme toggle. */
export function SiteHeader() {
  return (
    <header className="h-header border-b border-nav-border bg-nav text-nav-fg">
      <div className="mx-auto flex h-full max-w-page items-center justify-between px-gutter">
        <Link href="/" aria-label="Rulemark, home" className="rounded-control">
          <Lockup className="h-7" />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
