// Default categories and payee → category hints. Icons are lucide-react names.
export const DEFAULT_CATEGORIES = {
  expense: [
    ['Food', 'utensils', '#E8743B'], ['Transportation', 'bus', '#1C8FD1'], ['Housing', 'home', '#5B66A8'],
    ['Utilities', 'zap', '#C98A0B'], ['Shopping', 'shopping-bag', '#C2417A'], ['Health', 'heart-pulse', '#D6334A'],
    ['Education', 'graduation-cap', '#3B7DD8'], ['Entertainment', 'clapperboard', '#8B5CF6'], ['Subscriptions', 'repeat', '#6D5BD0'],
    ['Personal Care', 'sparkles', '#DB6FA3'], ['Travel', 'plane', '#0E9F9F'], ['Family', 'users', '#B7791F'],
    ['Business', 'briefcase', '#2A3370'], ['Other', 'circle-dashed', '#7A809B']
  ],
  income: [
    ['Salary', 'wallet', '#0E9F6E'], ['Freelance', 'laptop', '#1C8FD1'], ['Business', 'store', '#2A3370'],
    ['Allowance', 'hand-coins', '#0E9F9F'], ['Investment', 'trending-up', '#6D5BD0'], ['Interest', 'percent', '#3B7DD8'],
    ['Gift', 'gift', '#C2417A'], ['Refund', 'undo-2', '#7A809B'], ['Other', 'circle-dashed', '#7A809B']
  ]
};

// Used only until the user's own history teaches better suggestions.
export const PAYEE_HINTS = {
  jollibee: 'Food', mcdonalds: 'Food', "mcdonald's": 'Food', chowking: 'Food', mang: 'Food', greenwich: 'Food', starbucks: 'Food', grabfood: 'Food', foodpanda: 'Food', '7-eleven': 'Food', 'seven eleven': 'Food',
  netflix: 'Subscriptions', spotify: 'Subscriptions', youtube: 'Subscriptions', disney: 'Subscriptions', icloud: 'Subscriptions',
  shell: 'Transportation', petron: 'Transportation', caltex: 'Transportation', grab: 'Transportation', angkas: 'Transportation', jeep: 'Transportation', tricycle: 'Transportation',
  meralco: 'Utilities', maynilad: 'Utilities', 'manila water': 'Utilities', pldt: 'Utilities', globe: 'Utilities', smart: 'Utilities', converge: 'Utilities',
  mercury: 'Health', watsons: 'Personal Care', shopee: 'Shopping', lazada: 'Shopping', sm: 'Shopping', puregold: 'Food'
};

export const ACCOUNT_TYPES = [
  { value: 'cash', label: 'Cash', icon: 'banknote', liability: false },
  { value: 'ewallet', label: 'E-wallet', icon: 'smartphone', liability: false },
  { value: 'bank', label: 'Bank account', icon: 'landmark', liability: false },
  { value: 'savings', label: 'Savings account', icon: 'piggy-bank', liability: false },
  { value: 'investment', label: 'Investment', icon: 'trending-up', liability: false },
  { value: 'credit_card', label: 'Credit card', icon: 'credit-card', liability: true },
  { value: 'loan', label: 'Loan / debt', icon: 'file-text', liability: true },
  { value: 'other', label: 'Other', icon: 'wallet', liability: false }
];
export const isLiabilityType = (t) => !!ACCOUNT_TYPES.find((x) => x.value === t)?.liability;

export const ACCOUNT_COLORS = ['#141B3C', '#0E9F6E', '#1C8FD1', '#6D5BD0', '#C2417A', '#E8743B', '#C98A0B', '#0E9F9F', '#D6334A', '#7A809B'];

export const ACCOUNT_PRESETS = [
  ['Cash', 'cash', '#0E9F6E'], ['GCash', 'ewallet', '#1C8FD1'], ['Maya', 'ewallet', '#0E9F9F'],
  ['BPI', 'bank', '#D6334A'], ['BDO', 'bank', '#2A3370'], ['UnionBank', 'bank', '#E8743B']
];
