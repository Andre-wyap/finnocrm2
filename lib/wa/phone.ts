export function normalizeWhatsAppNumber(input: string): string | null {
  const digits = input.trim().replace(/\D/g, '')
  if (!digits) return null
  return digits.startsWith('0') ? `60${digits.slice(1)}` : digits
}

export function whatsappChatUrl(input: string): string | null {
  const number = normalizeWhatsAppNumber(input)
  return number ? `https://wa.me/${number}` : null
}
