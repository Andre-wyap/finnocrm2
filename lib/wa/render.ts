type TemplateValues = {
  full_name?: string | null
  agent_name?: string | null
  state?: string | null
  product_interest?: string[] | null
}

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi

export function renderWhatsAppTemplate(
  body: string,
  values: TemplateValues
): { text: string; unknownPlaceholders: string[] } {
  const fullName = values.full_name?.trim() ?? ''
  const known: Record<string, string> = {
    full_name: fullName,
    first_name: fullName.split(/\s+/)[0] ?? '',
    agent_name: values.agent_name?.trim() ?? '',
    state: values.state?.trim() ?? '',
    product_interest: (values.product_interest ?? [])
      .map((item) => item.replaceAll('_', ' '))
      .join(', '),
  }
  const unknown = new Set<string>()
  const text = body.replace(PLACEHOLDER_RE, (_match, rawName: string) => {
    const name = rawName.toLowerCase()
    if (!(name in known)) {
      unknown.add(name)
      return ''
    }
    return known[name]
  })
  return { text, unknownPlaceholders: [...unknown] }
}

export const WA_TEMPLATE_PLACEHOLDERS = [
  '{{full_name}}',
  '{{first_name}}',
  '{{agent_name}}',
  '{{state}}',
  '{{product_interest}}',
] as const
