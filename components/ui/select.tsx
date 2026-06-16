'use client'

import { SelectHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className, id, children, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label htmlFor={selectId} className="text-sm font-medium text-text-primary">
            {label}
          </label>
        ) : null}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'h-11 w-full rounded-button border border-border bg-surface-base px-3 text-sm text-text-primary',
            'focus:outline-none focus:border-finno-500 focus:ring-3 focus:ring-finno-500/15',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-red-400',
            className
          )}
          {...props}
        >
          {children}
        </select>
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
      </div>
    )
  }
)
Select.displayName = 'Select'

export { Select }
