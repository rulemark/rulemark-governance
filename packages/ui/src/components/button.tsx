import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@rulemark/ui/lib/utils';

// shadcn's base-nova button, restyled to the Rulemark spec (open question 8):
// hover, active and disabled take the spec's own states, not a faded colour,
// and focus is the base layer's Rulemark outline, not a ring. Sized to the
// foundations (open questions 10 and 11): control heights, side padding,
// label text and the control radius; `xs`, which the spec doesn't name,
// stays below it for tight spots.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-control border border-transparent bg-clip-padding text-label whitespace-nowrap transition-all select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:text-disabled-fg aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active disabled:bg-disabled',
        // Rulemark's secondary button. Its background has no utility of its
        // own (`secondary` is shadcn's soft fill), so it's read directly.
        outline:
          'border-secondary-border bg-(--rm-secondary) text-secondary-fg hover:bg-secondary-hover active:bg-secondary-active aria-expanded:bg-secondary-hover disabled:bg-disabled',
        // shadcn's soft fill, which the Rulemark spec has no button for.
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground disabled:bg-disabled',
        ghost:
          'hover:bg-ghost-hover hover:text-fg aria-expanded:bg-ghost-hover aria-expanded:text-fg',
        // Subtle at rest, solid on hover: the spec's danger-subtle pair, then
        // its danger, danger-fg and danger-hover.
        destructive:
          'bg-danger-subtle text-danger-subtle-fg hover:bg-danger hover:text-danger-fg active:bg-danger-hover disabled:bg-disabled',
        link: 'text-link underline-offset-4 hover:text-link-hover hover:underline',
      },
      size: {
        default:
          'h-control gap-1.5 px-control-x has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-label-sm in-data-[slot=button-group]:rounded-control has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-control-sm gap-1 px-control-x text-label-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-control-lg gap-1.5 px-control-x has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        icon: 'size-control',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-control [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-control-sm',
        'icon-lg': 'size-control-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
