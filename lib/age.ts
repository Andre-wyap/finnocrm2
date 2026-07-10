// Insurance "age nearest birthday" (ANB) from a date of birth.
//
// Ported verbatim from the agency's n8n formula: take the completed age, then
// round UP by one year if the next birthday is 6 months away or less. This is
// the age insurers actually rate on, which can be one year above the person's
// calendar age. Returns null for a missing/unparseable DOB.
export function insuranceAge(dobString: string | null | undefined): number | null {
  if (!dobString) return null
  const birthDate = new Date(dobString)
  if (Number.isNaN(birthDate.getTime())) return null

  const today = new Date()

  // Base (calendar-year) age
  let age = today.getFullYear() - birthDate.getFullYear()

  // Next birthday — if it has already passed this year, it's next year;
  // otherwise the completed age is one less than the year difference.
  const nextBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate())
  if (today > nextBirthday) {
    nextBirthday.setFullYear(today.getFullYear() + 1)
  } else {
    age--
  }

  const monthsUntilNext =
    (nextBirthday.getFullYear() - today.getFullYear()) * 12 +
    (nextBirthday.getMonth() - today.getMonth())

  return monthsUntilNext <= 6 ? age + 1 : age
}
