'use client'

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'accent' | 'outline' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-sans font-semibold rounded-button',
        'transition-all duration-200 ease-out cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' && 'h-9 px-4 text-sm',
        size === 'md' && 'h-11 px-6 text-sm',
        size === 'lg' && 'h-12 px-8 text-base',
        variant === 'primary' &&
          'bg-finno-500 text-white hover:bg-finno-800 hover:shadow-md focus-visible:ring-finno-500',
        variant === 'accent' &&
          'bg-teal-500 text-white hover:bg-teal-600 hover:shadow-md focus-visible:ring-teal-500',
        variant === 'outline' &&
          'border border-finno-500 text-finno-500 bg-transparent hover:bg-finno-500/5 focus-visible:ring-finno-500',
        variant === 'ghost' &&
          'text-text-secondary bg-transparent hover:bg-black/5 focus-visible:ring-border',
        className
      )}
      {...props}
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      ) : null}
      {children}
    </button>
  )
)

Button.displayName = 'Button'

export { Button }
export type { ButtonProps }
