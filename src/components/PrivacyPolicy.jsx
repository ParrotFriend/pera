import { Sheet } from './ui.jsx';

// ✏️ Fill these in before sharing the app with other people.
export const PRIVACY = {
  operator: 'Jonnebert Zarco',          // who runs this app (you)
  contactEmail: 'your-email@example.com', // where users can send privacy requests
  lastUpdated: 'October 1, 2026'
};

const H = ({ children }) => <h3 className="text-[15px] font-semibold mt-5 mb-1.5 font-sans">{children}</h3>;

/** Plain-language privacy notice that matches what the app actually does. */
export function PrivacyPolicy() {
  return (
    <div className="text-[14px] leading-relaxed space-y-2">
      <p className="muted text-[13px]">Last updated: {PRIVACY.lastUpdated}</p>
      <p>Pera is a personal budget app run by <strong>{PRIVACY.operator}</strong>. This notice explains what information the app keeps, why, and what you can do about it, in line with the Philippine Data Privacy Act of 2012 (RA 10173).</p>

      <H>What we collect</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Account:</strong> your email address and password. Passwords are stored only as a secure hash by our login provider; nobody can read them.</li>
        <li><strong>Your financial records:</strong> the accounts, transactions, categories, budgets, bills, recurring items, utang records and names of people you enter. Only what you type in.</li>
        <li><strong>App settings:</strong> currency, theme, notification choices, and your time zone (so reminders arrive at the right time).</li>
        <li><strong>Device details:</strong> a simple device label such as “Android app” in your activity log, and, if you turn on notifications, a technical address that lets us send them to that device.</li>
      </ul>
      <p>We do <strong>not</strong> collect your location, contacts, bank passwords, or card numbers, and Pera does not connect to your bank or e-wallet.</p>

      <H>Why we use it</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>To show your balances, budgets, reports and reminders.</li>
        <li>To keep your data in sync across your own devices and back it up in the cloud.</li>
        <li>To send the reminders you turned on (bills, utang, budgets, low balance).</li>
        <li>To let you sign in and reset your password.</li>
      </ul>
      <p>We do not sell your data, show ads, or use analytics or tracking tools.</p>

      <H>Where it is stored</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>On your device</strong>, so the app works offline.</li>
        <li><strong>In our cloud database (Supabase)</strong>, protected so that each person can only read their own records.</li>
        <li>The app itself is served by <strong>Vercel</strong>. Login emails are sent through our email provider.</li>
        <li>If you turn on notifications, the reminder text (for example a bill name and amount) passes through your phone or browser’s push service (Google, Apple or Mozilla) to reach your device.</li>
      </ul>
      <p>These providers may store data on servers outside the Philippines. Data is always sent over encrypted connections (HTTPS).</p>

      <H>How long we keep it</H>
      <p>We keep your records while your account exists. Items you delete go to Trash and can be restored; “Delete forever” erases their details. If you ask us to delete your account, we remove your data from our database within 30 days, except where the law requires us to keep something.</p>

      <H>Your rights</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>See and get a copy:</strong> Settings → Backup my data (full JSON copy) or export transactions as CSV.</li>
        <li><strong>Correct:</strong> edit any record in the app.</li>
        <li><strong>Delete:</strong> delete records yourself, or email us to delete your whole account.</li>
        <li><strong>Object or withdraw consent:</strong> turn off notifications anytime, or stop using the app and ask us to delete your data.</li>
        <li>You may also file a complaint with the National Privacy Commission (privacy.gov.ph).</li>
      </ul>

      <H>Security</H>
      <p>We use encrypted connections, per-user access rules in the database, and hashed passwords. No system is perfectly secure; if a breach affecting your data happens, we will inform you and the National Privacy Commission as the law requires. Keep your password private and sign out on shared devices.</p>

      <H>Contact</H>
      <p>Questions or requests: <a className="underline" href={`mailto:${PRIVACY.contactEmail}`}>{PRIVACY.contactEmail}</a></p>
      <p className="muted text-[12.5px] pt-2">We may update this notice. If the change is important, we will tell you in the app.</p>
    </div>
  );
}

export function PrivacySheet({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="Privacy Policy" wide
      footer={<button className="btn-primary w-full" onClick={onClose}>Close</button>}>
      <PrivacyPolicy />
    </Sheet>
  );
}