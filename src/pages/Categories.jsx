import { useEffect, useState } from 'react';
import { Plus, Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { useCategories } from '../hooks/useData.js';
import { PageHeader, Segmented, Sheet, Field, useToast, useConfirm } from '../components/ui.jsx';
import Icon, { IconTile, ICONS } from '../components/Icon.jsx';
import * as L from '../services/ledger.js';
import { ACCOUNT_COLORS } from '../services/defaults.js';

const COLORS = [...ACCOUNT_COLORS, '#E8743B', '#DB6FA3', '#3B7DD8', '#8B5CF6'];

export default function Categories() {
  const cats = useCategories();
  const [kind, setKind] = useState('expense');
  const [form, setForm] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  if (!cats) return <div className="skeleton h-64" />;
  const list = cats.all.filter((c) => c.kind === kind);
  const parents = list.filter((c) => !c.parent_id);
  const childrenOf = (id) => list.filter((c) => c.parent_id === id);

  async function remove(c) {
    const ok = await confirm({ title: `Remove ${c.name}?`, message: 'If transactions use this category it will be archived (kept for history, hidden from new entries). Otherwise it is deleted.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    const r = await L.removeCategory(c.id);
    toast(r === 'archived' ? `${c.name} archived — it's still used by past transactions` : `${c.name} deleted`);
  }

  return (
    <div>
      <PageHeader title="Categories" actions={<button className="btn-primary btn-sm" onClick={() => setForm({ kind })}><Plus size={16} /> Add</button>} />
      <div className="max-w-xs mb-4"><Segmented label="Category type" value={kind} onChange={setKind} options={[['expense', 'Expense'], ['income', 'Income']]} /></div>
      <div className="card p-1.5 sm:p-2">
        {parents.map((c) => (
          <div key={c.id}>
            <CatRow c={c} onEdit={() => setForm(c)} onRemove={() => remove(c)} onAddSub={() => setForm({ kind, parent_id: c.id })} />
            {childrenOf(c.id).map((s) => <div key={s.id} className="pl-10"><CatRow c={s} onEdit={() => setForm(s)} onRemove={() => remove(s)} /></div>)}
          </div>
        ))}
      </div>
      <CategoryForm value={form} onClose={() => setForm(null)} parents={parents} />
    </div>
  );
}

function CatRow({ c, onEdit, onRemove, onAddSub }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${c.archived_at ? 'opacity-60' : ''}`}>
      <IconTile name={c.icon} color={c.color} size={36} icon={17} />
      <span className="flex-1 min-w-0 truncate font-medium">{c.name}{c.archived_at && <span className="muted text-[12.5px] font-normal"> · archived</span>}</span>
      {onAddSub && !c.archived_at && <button className="btn-ghost btn-sm hidden sm:inline-flex" onClick={onAddSub}><Plus size={14} /> Sub</button>}
      {c.archived_at
        ? <button className="icon-btn" onClick={() => L.setCategoryArchived(c.id, false)} aria-label={`Unarchive ${c.name}`}><ArchiveRestore size={17} /></button>
        : <button className="icon-btn" onClick={onEdit} aria-label={`Edit ${c.name}`}><Pencil size={17} /></button>}
      {!c.archived_at && <button className="icon-btn" onClick={onRemove} aria-label={`Remove ${c.name}`}><Trash2 size={17} /></button>}
    </div>
  );
}

function CategoryForm({ value, onClose, parents }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  const open = !!value;
  useEffect(() => {
    if (value) { setF({ name: '', icon: 'circle-dashed', color: '#7A809B', parent_id: null, ...value }); setErrors({}); }
  }, [value]);
  const cur = f || {};
  async function save() {
    try {
      await L.saveCategory(cur, value?.id);
      toast(value?.id ? 'Category updated' : 'Category added');
      setF(null); onClose();
    } catch (e) { if (e instanceof L.ValidationError) setErrors(e.fields); else toast('Something went wrong. Please try again.', { tone: 'error' }); }
  }
  return (
    <Sheet open={open} onClose={() => { setF(null); onClose(); }} title={value?.id ? 'Edit category' : cur.parent_id ? 'New subcategory' : 'New category'}
      footer={<button className="btn-primary w-full" onClick={save}>{value?.id ? 'Save changes' : 'Add category'}</button>}>
      <div className="space-y-5">
        <Field label="Name" htmlFor="c-name" error={errors.name}><input id="c-name" data-autofocus className={`input ${errors.name ? 'input-error' : ''}`} value={cur.name || ''} onChange={(e) => setF({ ...cur, name: e.target.value })} /></Field>
        <Field label="Parent category" htmlFor="c-parent">
          <select id="c-parent" className="input" value={cur.parent_id || ''} onChange={(e) => setF({ ...cur, parent_id: e.target.value || null })}>
            <option value="">None (top level)</option>
            {parents.filter((p) => p.id !== value?.id && !p.archived_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Icon">
          <div className="grid grid-cols-8 gap-1.5">
            {Object.keys(ICONS).map((n) => (
              <button key={n} type="button" onClick={() => setF({ ...cur, icon: n })} aria-label={n} aria-pressed={cur.icon === n}
                className={`h-10 rounded-lg flex items-center justify-center ${cur.icon === n ? 'bg-ink text-white dark:bg-white dark:text-ink' : 'hover:bg-ink-50 dark:hover:bg-night-line'}`}><Icon name={n} /></button>
            ))}
          </div>
        </Field>
        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => <button key={c} type="button" onClick={() => setF({ ...cur, color: c })} aria-label={`Color ${c}`} aria-pressed={cur.color === c}
              className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-night-card ${cur.color === c ? 'ring-2 ring-ink dark:ring-white' : ''}`} style={{ background: c }} />)}
          </div>
        </Field>
      </div>
    </Sheet>
  );
}
