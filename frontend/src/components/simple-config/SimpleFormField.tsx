/**
 * SimpleFormField -- Renders the appropriate input component based on a SimpleFieldDef.
 *
 * Supports: text, ip, cidr, number, boolean, select, password field types.
 * Includes label, required indicator, help text, and error display.
 */

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SimpleFieldDef } from '@/lib/simpleConfigSchema'

interface SimpleFormFieldProps {
  field: SimpleFieldDef
  value: string
  onChange: (value: string) => void
  error?: string
}

export function SimpleFormField({ field, value, onChange, error }: SimpleFormFieldProps) {
  const [showPassword, setShowPassword] = useState(false)

  const fieldId = `simple-field-${field.key}`

  return (
    <div className="space-y-1.5">
      {field.type !== 'boolean' && (
        <Label htmlFor={fieldId} className="text-sm text-text-primary">
          {field.label}
          {field.required && <span className="text-error ml-0.5">*</span>}
        </Label>
      )}

      {/* Text / IP / CIDR */}
      {(field.type === 'text' || field.type === 'ip' || field.type === 'cidr') && (
        <Input
          id={fieldId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="h-8 text-sm"
        />
      )}

      {/* Number */}
      {field.type === 'number' && (
        <Input
          id={fieldId}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="h-8 text-sm"
        />
      )}

      {/* Boolean */}
      {field.type === 'boolean' && (
        <div className="flex items-center gap-2">
          <Checkbox
            id={fieldId}
            checked={value === 'true' || value === 'yes'}
            onCheckedChange={(checked) =>
              onChange(checked ? 'true' : 'false')
            }
          />
          <Label htmlFor={fieldId} className="text-sm text-text-primary cursor-pointer">
            {field.label}
          </Label>
        </div>
      )}

      {/* Select */}
      {field.type === 'select' && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={fieldId} className="h-8 text-sm">
            <SelectValue placeholder={field.placeholder ?? 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Password */}
      {field.type === 'password' && (
        <div className="relative">
          <Input
            id={fieldId}
            type={showPassword ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="h-8 text-sm pr-9"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-0 top-0 h-8 w-8 p-0"
          >
            {showPassword ? (
              <EyeOff className="h-3.5 w-3.5 text-text-muted" />
            ) : (
              <Eye className="h-3.5 w-3.5 text-text-muted" />
            )}
          </Button>
        </div>
      )}

      {field.help && (
        <p className="text-xs text-text-muted">{field.help}</p>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  )
}
