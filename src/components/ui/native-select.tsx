import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Box metrics shared by the sizer span and the select overlay, so the
 *  sizer's width is exactly the select's rendered width. */
const BOX_METRICS = 'h-9 px-3 py-2 pr-9 text-sm'

/** Options as a flat list — callers naturally hoist the option list
 *  into a variable (a single Fragment child), which Children.toArray
 *  does not flatten on its own. Fragments may nest; recursion handles
 *  any depth at trivial cost. */
function optionChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap(child =>
    React.isValidElement(child) && child.type === React.Fragment
      ? optionChildren((child.props as { children?: React.ReactNode }).children)
      : [child]
  )
}

function NativeSelect({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<'select'>) {
  // A native select sizes itself to its WIDEST option, so a short
  // selection ("English" inside a "Follow System"-sized box) leaves a
  // gap on the right that comes and goes with the language (user
  // report). The invisible sizer span below carries the SELECTED
  // option's label instead, pinning the box to a snug fit for every
  // selection; the real select overlays it absolutely.
  const selected = optionChildren(children).find(
    child =>
      React.isValidElement(child) &&
      (child.props as { value?: unknown }).value === value
  )
  const sizer =
    selected && React.isValidElement(selected)
      ? ((selected.props as { children?: React.ReactNode }).children ??
        '\u00a0')
      : '\u00a0'

  return (
    <div
      className="group/native-select relative w-fit has-[select:disabled]:opacity-50"
      data-slot="native-select-wrapper"
    >
      <span
        aria-hidden="true"
        data-slot="native-select-sizer"
        className={cn('invisible block whitespace-nowrap', BOX_METRICS)}
      >
        {sizer}
      </span>
      <select
        data-slot="native-select"
        className={cn(
          'border-input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 dark:hover:bg-input/50 absolute inset-0 w-full min-w-0 appearance-none rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed',
          BOX_METRICS,
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
          className
        )}
        value={value}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 opacity-50 select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({ ...props }: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" {...props} />
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn(className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
