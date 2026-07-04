export type BodyPart = 
  | 'head' | 'neck' | 'chest' | 'abdomen' 
  | 'left-shoulder' | 'right-shoulder'
  | 'left-upper-arm' | 'right-upper-arm'
  | 'left-forearm' | 'right-forearm'
  | 'left-hand' | 'right-hand'
  | 'left-hip' | 'right-hip'
  | 'left-thigh' | 'right-thigh'
  | 'left-knee' | 'right-knee'
  | 'left-calf' | 'right-calf'
  | 'left-ankle' | 'right-ankle'
  | 'left-foot' | 'right-foot'
  | 'back-upper' | 'back-lower';

export type StatusType = 'injury' | 'illness' | 'disease';

export type Severity = 'minor' | 'moderate' | 'severe' | 'critical';

export interface BodyStatus {
  id: string;
  bodyPart: BodyPart;
  type: StatusType;
  severity: Severity;
  name: string; // e.g., "Shoulder strain", "Headache", "Flu"
  description: string;
  startDate: Date;
  estimatedRecoveryDays?: number;
  notes?: string;
  color: string; // Color for visual indicator
  impactsActions?: string[]; // Actions affected (e.g., ['workout', 'coding'])
  xpPenalty?: number; // % reduction (e.g., 20 = -20% XP for affected actions)
}

export interface BodyPartLocation {
  bodyPart: BodyPart;
  x: number; // % from left (0-100)
  y: number; // % from top (0-100)
  label: string;
}
