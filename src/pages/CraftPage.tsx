import PageHeader from '../components/PageHeader';
import CraftCountTab from './CraftCountTab';

export default function CraftPage() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      <PageHeader title="Крафт" sub="подсчёт и создание карт" />
      <div style={{ flex: 1, minHeight: 0 }}><CraftCountTab /></div>
    </div>
  );
}
