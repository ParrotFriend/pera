import {
  Utensils, Bus, House, Zap, ShoppingBag, HeartPulse, GraduationCap, Clapperboard, Repeat, Sparkles, Plane, Users,
  Briefcase, CircleDashed, Wallet, Laptop, Store, HandCoins, TrendingUp, Percent, Gift, Undo2, Banknote, Smartphone,
  Landmark, PiggyBank, CreditCard, FileText, Coffee, Car, Fuel, Baby, Dog, Dumbbell, Music, Gamepad2, Shirt, Wifi, Phone, Book
} from 'lucide-react';

// Curated set keeps the bundle small (no import of the whole icon library).
export const ICONS = {
  utensils: Utensils, bus: Bus, home: House, zap: Zap, 'shopping-bag': ShoppingBag, 'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap, clapperboard: Clapperboard, repeat: Repeat, sparkles: Sparkles, plane: Plane, users: Users,
  briefcase: Briefcase, 'circle-dashed': CircleDashed, wallet: Wallet, laptop: Laptop, store: Store, 'hand-coins': HandCoins,
  'trending-up': TrendingUp, percent: Percent, gift: Gift, 'undo-2': Undo2, banknote: Banknote, smartphone: Smartphone,
  landmark: Landmark, 'piggy-bank': PiggyBank, 'credit-card': CreditCard, 'file-text': FileText, coffee: Coffee, car: Car,
  fuel: Fuel, baby: Baby, dog: Dog, dumbbell: Dumbbell, music: Music, gamepad: Gamepad2, shirt: Shirt, wifi: Wifi, phone: Phone, book: Book
};

export default function Icon({ name, size = 18, className = '', ...rest }) {
  const C = ICONS[name] || CircleDashed;
  return <C size={size} className={className} aria-hidden="true" {...rest} />;
}

/** Colored rounded tile used for categories and accounts. */
export function IconTile({ name, color = '#7A809B', size = 40, icon = 18 }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-xl" style={{ width: size, height: size, background: `${color}1f`, color }}>
      <Icon name={name} size={icon} />
    </span>
  );
}
