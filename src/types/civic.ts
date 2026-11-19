export type AgeMode = 'standard' | 'senior' | 'youth';

export type LanguageCode = 'en' | 'hi' | 'ta' | 'es' | 'fr';

export type IssueCategory =
  | 'pothole'
  | 'garbage'
  | 'streetlight'
  | 'water'
  | 'drainage'
  | 'traffic';

export type DepartmentName =
  | 'Roads & PWD'
  | 'Solid Waste Management'
  | 'Electricity Board'
  | 'Water Supply & Sewerage'
  | 'Stormwater Drainage'
  | 'Traffic Engineering';

export type PriorityLevel = 'low' | 'medium' | 'high' | 'urgent';

export type ReportStatus = 'submitted' | 'acknowledged' | 'in_progress' | 'resolved';

export interface CivicReport {
  id: string;
  ticketId: string;
  authorUid: string;
  authorDisplayName: string;
  title: string;
  description: string;
  category: IssueCategory;
  department: DepartmentName;
  priority: PriorityLevel;
  status: ReportStatus;
  lat: number;
  lng: number;
  incidentLocation: string;
  photoUrl: string;
  isPublic: boolean;
  upvotesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportActivityItem {
  id: string;
  reportId: string;
  actorUid: string;
  actorName: string;
  fromStatus: 'none' | ReportStatus;
  toStatus: ReportStatus;
  note: string;
  isReportPublic: boolean;
  createdAt: Date;
}

export interface UserPreferences {
  uid: string;
  displayName: string;
  ageMode: AgeMode;
  preferredLang: LanguageCode;
}
