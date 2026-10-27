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

/** Dropdown / list labels for every loggable body region. Order matches the old zone map. */
export const BODY_PART_OPTIONS: ReadonlyArray<{ value: BodyPart; label: string }> = [
  { value: 'head', label: 'Head' },
  { value: 'neck', label: 'Neck' },
  { value: 'left-shoulder', label: 'Left Shoulder' },
  { value: 'right-shoulder', label: 'Right Shoulder' },
  { value: 'left-upper-arm', label: 'Left Upper Arm' },
  { value: 'right-upper-arm', label: 'Right Upper Arm' },
  { value: 'left-forearm', label: 'Left Forearm' },
  { value: 'right-forearm', label: 'Right Forearm' },
  { value: 'left-hand', label: 'Left Hand' },
  { value: 'right-hand', label: 'Right Hand' },
  { value: 'chest', label: 'Chest' },
  { value: 'abdomen', label: 'Abdomen' },
  { value: 'back-upper', label: 'Upper Back' },
  { value: 'back-lower', label: 'Lower Back' },
  { value: 'left-hip', label: 'Left Hip' },
  { value: 'right-hip', label: 'Right Hip' },
  { value: 'left-thigh', label: 'Left Thigh' },
  { value: 'right-thigh', label: 'Right Thigh' },
  { value: 'left-knee', label: 'Left Knee' },
  { value: 'right-knee', label: 'Right Knee' },
  { value: 'left-calf', label: 'Left Calf' },
  { value: 'right-calf', label: 'Right Calf' },
  { value: 'left-ankle', label: 'Left Ankle' },
  { value: 'right-ankle', label: 'Right Ankle' },
  { value: 'left-foot', label: 'Left Foot' },
  { value: 'right-foot', label: 'Right Foot' },
];

export function bodyPartLabel(bodyPart: BodyPart): string {
  return BODY_PART_OPTIONS.find(option => option.value === bodyPart)?.label ?? bodyPart;
}
