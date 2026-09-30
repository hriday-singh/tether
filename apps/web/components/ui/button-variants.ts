import { cva, type VariantProps } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-ui select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground font-medium hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-border bg-transparent hover:bg-accent hover:text-accent-foreground',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'relative h-6 rounded-md px-2 text-micro after:absolute after:-inset-2.5 after:content-[""]',
        sm: 'relative h-7 rounded-lg px-2.5 text-caption after:absolute after:-inset-2 after:content-[""]',
        md: 'h-9 rounded-xl px-3.5 text-body',
        lg: 'h-11 rounded-xl px-5 text-body',
        icon: 'size-9 rounded-xl',
        'icon-sm': 'relative size-7 rounded-lg after:absolute after:-inset-2 after:content-[""]',
        'icon-xs': 'relative size-6 rounded-md after:absolute after:-inset-2.5 after:content-[""]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
