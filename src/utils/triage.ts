import { DepartmentName, IssueCategory, PriorityLevel, ReportStatus } from '../types/civic';

export interface RoutingRule {
  category: IssueCategory;
  department: DepartmentName;
  slaHours: number;
  defaultPriority: PriorityLevel;
  keywords: string[];
}

export const ROUTING_RULES: Record<IssueCategory, RoutingRule> = {
  pothole: {
    category: 'pothole',
    department: 'Roads & PWD',
    slaHours: 48,
    defaultPriority: 'high',
    keywords: [
      'pothole', 'road', 'asphalt', 'pavement', 'crack', 'sinkhole', 'street', 'bridge',
      'sidewalk', 'footpath', 'गड्ढा', 'सड़क', 'குழி', 'சாலை', 'bache', 'calle', 'nid-de-poule', 'route',
    ],
  },
  garbage: {
    category: 'garbage',
    department: 'Solid Waste Management',
    slaHours: 24,
    defaultPriority: 'medium',
    keywords: [
      'garbage', 'trash', 'waste', 'dump', 'litter', 'bin', 'rubbish', 'smell', 'sanitation',
      'कचरा', 'कूड़ा', 'குப்பை', 'basura', 'residuos', 'déchets', 'ordures',
    ],
  },
  streetlight: {
    category: 'streetlight',
    department: 'Electricity Board',
    slaHours: 24,
    defaultPriority: 'medium',
    keywords: [
      'light', 'streetlight', 'lamp', 'dark', 'pole', 'wire', 'electric', 'power', 'spark',
      'बिजली', 'लाइट', 'खंभा', 'விளக்கு', 'மின்சாரம்', 'luz', 'farola', 'éclairage', 'lampadaire',
    ],
  },
  water: {
    category: 'water',
    department: 'Water Supply & Sewerage',
    slaHours: 12,
    defaultPriority: 'urgent',
    keywords: [
      'water', 'pipe', 'leak', 'burst', 'sewage', 'tap', 'supply', 'contamination', 'main',
      'पानी', 'पाइप', 'रिसाव', 'தண்ணீர்', 'குழாய்', 'agua', 'fuga', 'eau', 'fuite',
    ],
  },
  drainage: {
    category: 'drainage',
    department: 'Stormwater Drainage',
    slaHours: 24,
    defaultPriority: 'high',
    keywords: [
      'drain', 'drainage', 'flood', 'clog', 'manhole', 'gutter', 'stagnant', 'stormwater',
      'नाली', 'जलभराव', 'வடிகால்', 'வெள்ளம்', 'drenaje', 'inundación', 'égout', 'inondation',
    ],
  },
  traffic: {
    category: 'traffic',
    department: 'Traffic Engineering',
    slaHours: 12,
    defaultPriority: 'urgent',
    keywords: [
      'traffic', 'signal', 'crosswalk', 'sign', 'junction', 'intersection', 'jam', 'barrier',
      'ट्रैफिक', 'सिग्नल', 'போக்குவரத்து', 'சிக்னல்', 'tráfico', 'semáforo', 'circulation', 'feu',
    ],
  },
};

export function detectCategoryFromText(text: string): IssueCategory | null {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return null;

  let bestCategory: IssueCategory | null = null;
  let bestScore = 0;

  (Object.keys(ROUTING_RULES) as IssueCategory[]).forEach((cat) => {
    const score = ROUTING_RULES[cat].keywords.reduce((acc, kw) => {
      return normalized.includes(kw) ? acc + 1 : acc;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  });

  return bestCategory;
}

export function getDepartmentForCategory(category: IssueCategory): DepartmentName {
  return ROUTING_RULES[category].department;
}

export function generateTicketId(): string {
  const year = new Date().getFullYear();
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `CVC-${year}-${suffix}`;
}

export function getNextStatus(current: ReportStatus): ReportStatus | null {
  switch (current) {
    case 'submitted':
      return 'acknowledged';
    case 'acknowledged':
      return 'in_progress';
    case 'in_progress':
      return 'resolved';
    case 'resolved':
      return null;
  }
}

export function sanitizeString(value: string, maxLen: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}
