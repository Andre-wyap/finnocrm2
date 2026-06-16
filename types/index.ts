// ─── Enums ────────────────────────────────────────────────────────────────────

export type Role = 'agent' | 'subadmin' | 'admin'
export type LeadStatus = 'unassigned' | 'lead' | 'potential' | 'closed' | 'issued' | 'lost'
export type Gender = 'male' | 'female'
export type SmokingStatus = 'smoker' | 'non_smoker'
export type Product = 'medical' | 'critical_illness' | 'life' | 'personal_accident'
export type ActivityType =
  | 'remark'
  | 'call'
  | 'status_change'
  | 'field_change'
  | 'assignment'
  | 'follow_up'

// ─── Tables ───────────────────────────────────────────────────────────────────

export interface Team {
  id: string
  name: string
  subadmin_id: string
  created_at: string
}

export interface Profile {
  id: string
  firebase_uid: string
  full_name: string
  email: string
  phone: string | null
  role: Role
  team_id: string | null
  is_active: boolean
  created_at: string
}

export interface Lead {
  id: string
  full_name: string
  date_of_birth: string | null
  gender: Gender | null
  smoking_status: SmokingStatus | null
  mobile: string
  email: string | null
  state: string | null
  source: string
  product_interest: Product[]
  status: LeadStatus
  assigned_agent_id: string | null
  assigned_by: string | null
  assigned_at: string | null
  case_size: number | null
  next_follow_up_at: string | null
  possible_duplicate: boolean
  raw_payload: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Activity {
  id: string
  lead_id: string
  user_id: string
  type: ActivityType
  content: string | null
  field_name: string | null
  old_value: string | null
  new_value: string | null
  follow_up_at: string | null
  created_at: string
}
