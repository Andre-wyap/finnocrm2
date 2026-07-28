// ─── Enums ────────────────────────────────────────────────────────────────────

export type Role = 'agent' | 'team_leader' | 'subadmin' | 'admin'
export type LeadStatus = 'unassigned' | 'lead' | 'approach' | 'follow_up' | 'potential' | 'closed' | 'issued' | 'lost'
export type Gender = 'male' | 'female'
export type SmokingStatus = 'smoker' | 'non_smoker'
export type Product = 'medical' | 'critical_illness' | 'life' | 'personal_accident'
export type ActivityType =
  | 'remark'
  | 'call'
  | 'status_change'
  | 'field_change'
  | 'assignment'
  | 'archive'
  | 'restore'
  | 'wa_message'
export type WaInstanceStatus = 'disconnected' | 'connecting' | 'connected'
export type WaJobStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled'

// ─── Tables ───────────────────────────────────────────────────────────────────

export interface Team {
  id: string
  name: string
  subadmin_id: string
  created_at: string
}

export interface TeamSource {
  id: string
  team_id: string
  source: string
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
  wa_enabled: boolean
  created_at: string
}

export interface WaInstance {
  id: string
  profile_id: string
  instance_name: string
  status: WaInstanceStatus
  phone_number: string | null
  connected_at: string | null
  created_at: string
  updated_at: string
}

export interface WaMedia {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: string
  created_at: string
}

export interface WaTemplate {
  id: string
  name: string
  body: string
  media_id: string | null
  media_file_name: string | null
  media_mime_type: string | null
  media_size_bytes: number | null
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface WaJob {
  id: string
  lead_id: string
  template_id: string
  sender_profile_id: string
  run_at: string
  status: WaJobStatus
  attempts: number
  last_error: string | null
  sent_at: string | null
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
  team_id: string | null
  product_interest: Product[]
  status: LeadStatus
  assigned_agent_id: string | null
  assigned_by: string | null
  assigned_at: string | null
  case_size: number | null
  possible_duplicate: boolean
  archived_at: string | null
  archived_by: string | null
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
  created_at: string
}
